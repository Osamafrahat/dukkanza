// Subscription list/detail status semantics + create/renew guards.
//
// Why this file exists: nothing auto-writes `status` when end_date passes,
// so the API computes an effective status (read-side). Three behaviors are
// easy to regress silently:
//   1. a row flagged 'active' past its end date must read AND filter as
//      'expired' (the old SQL-side .eq('status') could never see it);
//   2. manual create must reject a second live subscription for the same
//      customer+plan (the POS /quick route always had this guard);
//   3. renew must record the caller's payment method instead of the old
//      hardcoded 'cash'.

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon'

// ---------------------------------------------------------------------------
// Table-scripted supabase mock (same harness as customersOverview.test.js)
// ---------------------------------------------------------------------------

const queues = new Map()
const insertCalls = []
const selectCalls = []

function enqueue(table, ...results) {
  if (!queues.has(table)) queues.set(table, [])
  queues.get(table).push(...results)
}
function nextResult(table) {
  const q = queues.get(table)
  if (q && q.length > 0) return q.shift()
  return { data: null, error: null }
}

function makeFrom(table) {
  const chain = {}
  for (const m of ['eq', 'in', 'order', 'limit', 'range', 'gte', 'lte', 'neq', 'or', 'update']) {
    chain[m] = jest.fn(() => chain)
  }
  // Recorded so tests can pin the join shape (select strings).
  chain.select = jest.fn((...args) => {
    selectCalls.push({ table, args })
    return chain
  })
  chain.insert = jest.fn((payload) => {
    insertCalls.push({ table, payload })
    return chain
  })
  chain.delete = jest.fn(() => chain)
  chain.single = jest.fn(() => Promise.resolve(nextResult(table)))
  chain.maybeSingle = jest.fn(() => Promise.resolve(nextResult(table)))
  chain.then = (resolve, reject) => Promise.resolve(nextResult(table)).then(resolve, reject)
  return chain
}

const fromSpy = jest.fn((table) => makeFrom(table))

jest.unstable_mockModule('../db/supabase.js', () => ({
  default: { from: fromSpy },
  supabaseStorage: { from: (table) => makeFrom(table) },
  withTimeout: (p) => p,
}))

// Renew/quick/payment routes post journal entries through the accounting
// engine; mocked out so no ledger writes escape into the mock.
jest.unstable_mockModule('../services/accountingEngine.js', () => ({
  postSubscriptionPaymentJournal: jest.fn().mockResolvedValue(undefined),
}))

const { default: subscriptionsRouter } = await import('../routes/subscriptions.js')

const app = express()
app.use(express.json())

// Stand in for index.js's authenticateToken + setTenantContext mounts.
const asUser = (req, _res, next) => {
  req.user = { id: 1, tenantId: 1, role: 'MANAGER', permissions: [] }
  next()
}
app.use('/api/subscriptions', asUser, subscriptionsRouter)

beforeEach(() => {
  queues.clear()
  insertCalls.length = 0
  selectCalls.length = 0
  jest.clearAllMocks()
})

describe('GET /subscriptions/payments/all — embedded join shape', () => {
  it('exposes plan_id and service_id on the embedded subscription', async () => {
    enqueue('subscription_payments', {
      data: [{ id: 1, amount: 100, subscription: { id: 7, plan_id: 5, service_id: 9, status: 'active' } }],
      error: null,
    })

    const res = await request(app).get('/api/subscriptions/payments/all')

    expect(res.status).toBe(200)
    expect(res.body[0].subscription.plan_id).toBe(5)
    expect(res.body[0].subscription.service_id).toBe(9)
    // The join itself must keep selecting service_id — the service detail
    // drawer aggregates collected revenue from this field.
    const paymentSelect = selectCalls.find((c) => c.table === 'subscription_payments')
    expect(paymentSelect.args[0]).toContain('service_id')
  })
})

const PAST = '2000-01-01'
const FUTURE = '2099-01-01'

describe('GET /subscriptions — effective status', () => {
  it('reports active rows past their end date as expired', async () => {
    enqueue('subscriptions', {
      data: [
        { id: 1, status: 'active', end_date: FUTURE },
        { id: 2, status: 'active', end_date: PAST },
        { id: 3, status: 'past_due', end_date: PAST },
        { id: 4, status: 'cancelled', end_date: FUTURE },
        { id: 5, status: 'active', end_date: null },
      ],
      error: null,
    })

    const res = await request(app).get('/api/subscriptions')

    expect(res.status).toBe(200)
    expect(res.body.map((s) => [s.id, s.status])).toEqual([
      [1, 'active'],
      [2, 'expired'],
      // past_due is a billing flag, not a termination — it survives.
      [3, 'past_due'],
      [4, 'cancelled'],
      // No end date means no auto-expiry.
      [5, 'active'],
    ])
  })

  it('filters ?status= against the computed value, not the stored one', async () => {
    enqueue('subscriptions', {
      data: [
        { id: 1, status: 'active', end_date: FUTURE },
        { id: 2, status: 'active', end_date: PAST },
        { id: 3, status: 'expired', end_date: PAST },
      ],
      error: null,
    })

    const expired = await request(app).get('/api/subscriptions?status=expired')
    expect(expired.status).toBe(200)
    // The stale 'active'-but-past-end row (2) joins the stored-expired one (3).
    expect(expired.body.map((s) => s.id).sort()).toEqual([2, 3])

    enqueue('subscriptions', {
      data: [
        { id: 1, status: 'active', end_date: FUTURE },
        { id: 2, status: 'active', end_date: PAST },
        { id: 3, status: 'expired', end_date: PAST },
      ],
      error: null,
    })

    const active = await request(app).get('/api/subscriptions?status=active')
    expect(active.body.map((s) => s.id)).toEqual([1])
  })

  it('applies the same computation on GET /:id', async () => {
    enqueue('subscriptions', { data: { id: 9, status: 'active', end_date: PAST }, error: null })

    const res = await request(app).get('/api/subscriptions/9')

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('expired')
  })
})

describe('POST /subscriptions — duplicate guard', () => {
  const body = { customer_id: 1, plan_id: 5, start_date: '2026-01-01', billing_amount: 100 }

  it('409s when the customer already has a live sub for this plan', async () => {
    enqueue('subscriptions', {
      data: [{ id: 42, plan_id: 5, service_id: null, status: 'active', end_date: FUTURE }],
      error: null,
    })

    const res = await request(app).post('/api/subscriptions').send(body)

    expect(res.status).toBe(409)
    expect(res.body.existing_subscription_id).toBe(42)
    expect(insertCalls).toHaveLength(0)
  })

  it('allows the create when the existing sub already ended', async () => {
    enqueue('subscriptions', {
      data: [{ id: 42, plan_id: 5, service_id: null, status: 'active', end_date: PAST }],
      error: null,
    })
    enqueue('subscriptions', {
      data: { id: 100, ...body, status: 'active' },
      error: null,
    })

    const res = await request(app).post('/api/subscriptions').send(body)

    expect(res.status).toBe(201)
    expect(res.body.id).toBe(100)
    expect(insertCalls).toHaveLength(1)
  })
})

describe('PATCH /subscriptions/:id/renew — payment method', () => {
  const subRow = { id: 7, status: 'active', billing_amount: 500, plan: { billing_cycle: 'monthly', duration_months: 1 } }

  it('records the caller-chosen method instead of hardcoded cash', async () => {
    enqueue('subscriptions', { data: subRow, error: null })
    enqueue('subscriptions', { data: { id: 7, status: 'active' }, error: null })
    enqueue('subscription_payments', { data: { id: 77 }, error: null })

    const res = await request(app).patch('/api/subscriptions/7/renew').send({ payment_method: 'card' })

    expect(res.status).toBe(200)
    const payment = insertCalls.find((c) => c.table === 'subscription_payments')
    expect(payment).toBeTruthy()
    expect(payment.payload.payment_method).toBe('card')
  })

  it('defaults to cash when no method is given', async () => {
    enqueue('subscriptions', { data: subRow, error: null })
    enqueue('subscriptions', { data: { id: 7, status: 'active' }, error: null })
    enqueue('subscription_payments', { data: { id: 78 }, error: null })

    const res = await request(app).patch('/api/subscriptions/7/renew').send({})

    expect(res.status).toBe(200)
    const payment = insertCalls.find((c) => c.table === 'subscription_payments')
    expect(payment.payload.payment_method).toBe('cash')
  })

  it('rejects an unknown payment method', async () => {
    const res = await request(app).patch('/api/subscriptions/7/renew').send({ payment_method: 'bitcoin' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid payment method')
    expect(insertCalls).toHaveLength(0)
  })
})
