// Customers header overview.
//
// Why this file exists: GET /customers/overview feeds the Customers page
// header cards and sits BEFORE /:id (a param route that would otherwise
// swallow "overview"). Two things are easy to regress silently:
//   1. refunded orders must never count as sales;
//   2. outstanding credit counts only UNPAID credit sales (pending,
//      partial, overdue) — a fully paid one contributes 0 remaining and
//      an archived 'paid' row must not be queried into the sum at all.

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon'

// ---------------------------------------------------------------------------
// Table-scripted supabase mock (same harness as suppliersDetail.test.js)
// ---------------------------------------------------------------------------

const queues = new Map()

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
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'range', 'gte', 'lte', 'neq', 'or', 'update', 'insert', 'delete']) {
    chain[m] = jest.fn(() => chain)
  }
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

const { default: customersRouter } = await import('../routes/customers.js')

const app = express()
app.use(express.json())

// Stand in for index.js's authenticateToken + activityLogger mounts.
const asUser = (req, _res, next) => {
  req.user = { id: 1, tenantId: 1, role: 'MANAGER' }
  req.branchId = null
  req.logActivity = jest.fn()
  next()
}
app.use('/api/customers', asUser, customersRouter)

beforeEach(() => {
  queues.clear()
  jest.clearAllMocks()
})

const callsFor = (table) => fromSpy.mock.calls.filter((c) => c[0] === table).length

describe('GET /customers/overview', () => {
  it('sums non-refunded orders from the last 30 days plus unpaid credit', async () => {
    enqueue('orders', {
      data: [
        { total: 100, is_refunded: false },
        { total: 50, is_refunded: false },
        { total: 999, is_refunded: true },
      ],
      error: null,
    })
    enqueue('credit_sales', {
      data: [
        { remaining_amount: 40, status: 'pending' },
        { remaining_amount: 25, status: 'partial' },
        { remaining_amount: 35, status: 'overdue' },
      ],
      error: null,
    })

    const res = await request(app).get('/api/customers/overview')

    expect(res.status).toBe(200)
    // 100 + 50 — the refunded order never counts.
    expect(res.body.sales_30d).toBe(150)
    expect(res.body.outstanding_credit).toBe(100)
  })

  it('answers zeros when there is no recent sales and no open credit', async () => {
    enqueue('orders', { data: [], error: null })
    enqueue('credit_sales', { data: [], error: null })

    const res = await request(app).get('/api/customers/overview')

    expect(res.status).toBe(200)
    expect(res.body.sales_30d).toBe(0)
    expect(res.body.outstanding_credit).toBe(0)
  })

  it('reaches the literal route instead of the /:id param route', async () => {
    enqueue('orders', { data: [], error: null })
    enqueue('credit_sales', { data: [], error: null })

    // If /:id won the match, this would 400 ("Invalid customer ID") or
    // 404 ("Customer not found") instead of answering the aggregates.
    const res = await request(app).get('/api/customers/overview')

    expect(res.status).toBe(200)
    // The row fetch for /:id never happens.
    expect(callsFor('customers')).toBe(0)
  })
})
