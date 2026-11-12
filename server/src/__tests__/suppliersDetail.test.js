// Suppliers detail + header overview.
//
// Why this file exists: GET /suppliers/:id grew from a bare row into the
// data source of the detail drawer — AP balance, lifetime stats, AP aging
// buckets, products and recent POs/payments — and GET /suppliers/overview
// feeds the header cards. Two things are easy to regress silently:
//   1. the aging walk — it must treat credits as bills and debits as
//      payments (liability balances are credit-positive), consume oldest
//      first, and bucket by the BILL's date, not the payment's;
//   2. cancelled orders — they may never count as purchases anywhere.

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon'

// ---------------------------------------------------------------------------
// Table-scripted supabase mock (same harness as payments.test.js)
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
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'range', 'gte', 'lte', 'neq', 'update', 'insert', 'delete']) {
    chain[m] = jest.fn(() => chain)
  }
  chain.single = jest.fn(() => Promise.resolve(nextResult(table)))
  chain.maybeSingle = jest.fn(() => Promise.resolve(nextResult(table)))
  chain.then = (resolve, reject) => Promise.resolve(nextResult(table)).then(resolve, reject)
  return chain
}

// Accounts resolve BY the code each query filters on (2010-S9 style codes).
const ACCOUNTS = {
  '20101': { id: 22, code: '20101', account_type: 'liability', balance: 90 },
}

function makeAccountsFrom() {
  const chain = {}
  for (const m of ['select', 'in', 'order', 'limit', 'range', 'gte', 'lte', 'neq', 'insert', 'update', 'delete']) {
    chain[m] = jest.fn(() => chain)
  }
  const codes = []
  chain.eq = jest.fn((col, val) => {
    if (col === 'code') codes.push(val)
    return chain
  })
  const result = () => ({ data: ACCOUNTS[codes[codes.length - 1]] ?? null, error: null })
  chain.single = jest.fn(() => Promise.resolve(result()))
  chain.maybeSingle = jest.fn(() => Promise.resolve(result()))
  chain.then = (resolve, reject) => Promise.resolve(result()).then(resolve, reject)
  return chain
}

const fromSpy = jest.fn((table) => (table === 'accounts' ? makeAccountsFrom() : makeFrom(table)))

jest.unstable_mockModule('../db/supabase.js', () => ({
  default: { from: fromSpy },
  supabaseStorage: { from: (table) => makeFrom(table) },
  withTimeout: (p) => p,
}))

const { default: suppliersRouter } = await import('../routes/suppliers.js')

const app = express()
app.use(express.json())

// Stand in for index.js's authenticateToken + activityLogger mounts.
const asUser = (req, _res, next) => {
  req.user = { id: 1, tenantId: 1, role: 'MANAGER' }
  req.branchId = null
  req.logActivity = jest.fn()
  next()
}
app.use('/api/suppliers', asUser, suppliersRouter)

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

beforeEach(() => {
  queues.clear()
  jest.clearAllMocks()
})

const callsFor = (table) => fromSpy.mock.calls.filter((c) => c[0] === table).length

// ---------------------------------------------------------------------------
// GET /suppliers/overview
// ---------------------------------------------------------------------------

describe('GET /suppliers/overview', () => {
  it('sums non-cancelled POs created in the last 30 days', async () => {
    enqueue('purchase_orders', {
      data: [
        { total: 100, status: 'received' },
        { total: 50, status: 'draft' },
        { total: 999, status: 'cancelled' },
      ],
      error: null,
    })

    const res = await request(app).get('/api/suppliers/overview')

    expect(res.status).toBe(200)
    // 100 + 50 — the cancelled order never counts.
    expect(res.body.purchases_30d).toBe(150)
  })

  it('answers 0 when nothing was ordered', async () => {
    enqueue('purchase_orders', { data: [], error: null })

    const res = await request(app).get('/api/suppliers/overview')

    expect(res.status).toBe(200)
    expect(res.body.purchases_30d).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// GET /suppliers/:id — enriched detail
// ---------------------------------------------------------------------------

function primeDetail() {
  enqueue('suppliers', {
    data: { id: 9, tenant_id: 1, name: 'Acme', account_code: '20101', phone: '+201012345678' },
    error: null,
  })
  // Newest first, as the route orders it. The cancelled row is newest but
  // must fall out of the stats while staying in the recent list.
  enqueue('purchase_orders', {
    data: [
      { id: 31, order_number: 'PO-31', status: 'cancelled', total: 999, created_at: daysAgo(1) },
      { id: 30, order_number: 'PO-30', status: 'received', total: 100, created_at: daysAgo(2) },
      { id: 29, order_number: 'PO-29', status: 'draft', total: 50, created_at: daysAgo(9) },
    ],
    error: null,
  })
  enqueue('payments', {
    data: [
      { id: 50, payment_number: 'PAY-50', payment_type: 'outbound', method: 'cash', amount: 60, payment_date: daysAgo(1) },
      { id: 51, payment_number: 'PAY-51', payment_type: 'outbound', method: 'cash', amount: 10, payment_date: daysAgo(5) },
    ],
    error: null,
  })
  enqueue('products', {
    data: [
      { id: 7, name: 'Gadget', sku: 'G-1', price: 10, cost_price: 6, stock_quantity: 3, is_active: true },
      { id: 8, name: 'Widget', sku: 'W-1', price: 20, cost_price: 12, stock_quantity: 5, is_active: true },
    ],
    error: null,
  })
  // AP journal: two bills (credits) then one payment (debit).
  enqueue('journal_entry_lines', {
    data: [
      { id: 1, entry_id: 100, debit: 0, credit: 100 },
      { id: 2, entry_id: 101, debit: 0, credit: 50 },
      { id: 3, entry_id: 102, debit: 60, credit: 0 },
    ],
    error: null,
  })
  enqueue('journal_entries', {
    data: [
      { id: 100, date: daysAgo(40) },
      { id: 101, date: daysAgo(7) },
      { id: 102, date: daysAgo(1) },
    ],
    error: null,
  })
}

describe('GET /suppliers/:id — enriched detail', () => {
  it('returns balance, stats, aging buckets, products and recent lists', async () => {
    primeDetail()

    const res = await request(app).get('/api/suppliers/9')

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Acme')
    expect(res.body.balance).toBe(90)

    // Stats skip the cancelled PO; last order is the newest NON-cancelled.
    expect(res.body.stats).toEqual({
      po_count: 2,
      total_purchased: 150,
      last_po_date: daysAgo(2),
      payment_count: 2,
      total_paid: 70,
    })

    // Aging FIFO: the 60 payment eats the OLDEST bill first (100 -> 40 at
    // 40 days = 31-60 bucket), the 50 bill at 7 days stays current.
    expect(res.body.aging).toEqual({ current: 50, d30: 40, d60: 0, total: 90 })

    expect(res.body.products).toHaveLength(2)
    expect(res.body.products[0].name).toBe('Gadget')
    expect(res.body.recent_pos).toHaveLength(3)
    expect(res.body.recent_payments).toHaveLength(2)
    expect(res.body.recent_payments[0].payment_number).toBe('PAY-50')
  })

  it('skips journal queries entirely when the supplier has no account_code', async () => {
    enqueue('suppliers', { data: { id: 10, tenant_id: 1, name: 'Beta', account_code: null }, error: null })
    enqueue('purchase_orders', { data: [], error: null })
    enqueue('payments', { data: [], error: null })
    enqueue('products', { data: [], error: null })

    const res = await request(app).get('/api/suppliers/10')

    expect(res.status).toBe(200)
    expect(res.body.balance).toBe(0)
    // No payable account -> no aging to compute, and no queries to get it.
    expect(res.body.aging).toBeNull()
    expect(callsFor('accounts')).toBe(0)
    expect(callsFor('journal_entry_lines')).toBe(0)
    expect(callsFor('journal_entries')).toBe(0)
    expect(res.body.stats.po_count).toBe(0)
    expect(res.body.stats.total_paid).toBe(0)
  })

  it('404s for a supplier of another tenant', async () => {
    enqueue('suppliers', { data: null, error: { message: 'not found' } })

    const res = await request(app).get('/api/suppliers/999')

    expect(res.status).toBe(404)
    expect(res.body.error).toContain('not found')
    expect(callsFor('purchase_orders')).toBe(0)
  })
})
