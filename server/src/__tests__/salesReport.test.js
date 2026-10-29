// GET /reports/sales — the endpoint the dashboard's analytics panel reads.
//
// The route previously returned daily totals only. The dashboard needs an
// hourly distribution to show when the store is busiest, so the handler now
// buckets orders by hour. That aggregation is what these tests pin: which
// bucket an order lands in, that a malformed row can't break the report, and
// that the pre-existing fields still come back unchanged.

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'

// ---------------------------------------------------------------------------
// Controllable supabase mock (table-scripted: queue first, then default)
// ---------------------------------------------------------------------------

const queues = new Map()
const defaults = new Map()
// Records every supabase `from()` so a test can assert the guard fired
// BEFORE any query was issued, not merely that the response looked empty.
const fromSpy = jest.fn((table) => makeFrom(table))

function setDefault(table, result) {
  defaults.set(table, result)
}
function nextResult(table) {
  const q = queues.get(table)
  if (q && q.length > 0) return q.shift()
  if (defaults.has(table)) return defaults.get(table)
  return { data: null, error: null }
}

function makeFrom(table) {
  const chain = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'range', 'gte', 'lte']) {
    chain[m] = jest.fn(() => chain)
  }
  chain.single = jest.fn(() => Promise.resolve(nextResult(table)))
  chain.maybeSingle = jest.fn(() => Promise.resolve(nextResult(table)))
  chain.then = (resolve, reject) => Promise.resolve(nextResult(table)).then(resolve, reject)
  return chain
}

jest.unstable_mockModule('../db/supabase.js', () => ({
  default: { from: fromSpy },
  supabaseStorage: { from: (table) => makeFrom(table) },
  withTimeout: (p) => p,
}))

const { default: reportsRouter } = await import('../routes/reports.js')

const app = express()
app.use(express.json())
// reports.js reads req.user/req.branchId set by the mount in index.js.
// Swappable so a test can speak as a tenant-less platform admin.
let currentUser = { id: 1, tenantId: 1, role: 'MANAGER' }
app.use('/api/reports', (req, res, next) => {
  req.user = currentUser
  req.branchId = null
  next()
}, reportsRouter)

// Orders anchored to "today" at specific local hours so the bucket a row
// lands in is deterministic regardless of the machine's timezone.
const at = (hour, minute) => {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

const ORDERS = [
  { id: 1, total: '300', created_at: at(13, 30) },
  { id: 2, total: '50', created_at: at(13, 5) },
  { id: 3, total: '200', created_at: at(9, 15) },
  // Malformed row: no timestamp at all. Must not throw, and must not be
  // counted into any hour.
  { id: 4, total: '999', created_at: null },
]

const ORDER_ITEMS = [
  { quantity: 3, total: '300', product_id: 7, products: { name: 'Cheese' } },
  { quantity: 1, total: '50', product_id: 8, products: { name: 'Bread' } },
]

beforeEach(() => {
  queues.clear()
  defaults.clear()
  jest.clearAllMocks()
  currentUser = { id: 1, tenantId: 1, role: 'MANAGER' }
  setDefault('orders', { data: ORDERS, error: null })
  setDefault('order_items', { data: ORDER_ITEMS, error: null })
})

const getSales = (range = 'week') =>
  request(app).get(`/api/reports/sales?range=${range}`)

describe('GET /reports/sales — hourly distribution', () => {
  it('returns exactly 24 buckets, one per hour of the day', async () => {
    const res = await getSales()

    expect(res.status).toBe(200)
    expect(res.body.hourlySales).toHaveLength(24)
    expect(res.body.hourlySales.map((h) => h.hour)).toEqual(
      Array.from({ length: 24 }, (_, i) => i),
    )
  })

  it('sums the totals and counts of every order sharing an hour', async () => {
    const res = await getSales()

    // Two orders fall in the 13:xx hour (300 + 50).
    expect(res.body.hourlySales[13]).toMatchObject({ hour: 13, sales: 350, orders: 2 })
    expect(res.body.hourlySales[9]).toMatchObject({ hour: 9, sales: 200, orders: 1 })
  })

  it('leaves hours with no orders at zero rather than omitting them', async () => {
    const res = await getSales()

    expect(res.body.hourlySales[0]).toMatchObject({ hour: 0, sales: 0, orders: 0 })
    expect(res.body.hourlySales[23]).toMatchObject({ hour: 23, sales: 0, orders: 0 })
  })

  it('skips a row with no timestamp instead of throwing', async () => {
    const res = await getSales()

    expect(res.status).toBe(200)
    const bucketed = res.body.hourlySales.reduce((sum, h) => sum + h.orders, 0)
    // The null-timestamp order is excluded from the hourly view...
    expect(bucketed).toBe(3)
    // ...but the request still succeeds.
    expect(res.body.totalOrders).toBe(4)
  })

  it('keeps the pre-existing report fields intact', async () => {
    const res = await getSales()

    // 300 + 50 + 200 + 999 — the malformed row still has a total.
    expect(res.body.totalSales).toBe(1549)
    expect(res.body.totalOrders).toBe(4)
    expect(res.body.avgOrderValue).toBeCloseTo(1549 / 4)
    expect(res.body.itemsSold).toBe(4)
    expect(Array.isArray(res.body.dailySales)).toBe(true)
    expect(res.body.topProducts).toHaveLength(2)
    expect(res.body.topProducts[0]).toMatchObject({ name: 'Cheese', revenue: 300 })
  })

  it('reports an empty hourly series as all-zero when there are no orders', async () => {
    setDefault('orders', { data: [], error: null })
    setDefault('order_items', { data: [], error: null })

    const res = await getSales()

    expect(res.status).toBe(200)
    expect(res.body.hourlySales).toHaveLength(24)
    expect(res.body.hourlySales.every((h) => h.sales === 0 && h.orders === 0)).toBe(true)
  })
})

describe('tenant-less caller (platform SUPER_ADMIN)', () => {
  // backup.js documents tenant_id === null as this role's designed state and
  // auth deliberately lets such a token through. supabase-js renders
  // `.eq('tenant_id', null)` as `tenant_id=eq.null`, which PostgREST parses
  // as a comparison against the TEXT 'null' — Postgres rejects that for a
  // bigint column ("invalid input syntax for type bigint: \"null\""), and the
  // route's `throw` made it a 500. This is the live Sentry issue.
  beforeEach(() => {
    currentUser = { id: 99, tenantId: null, role: 'SUPER_ADMIN' }
  })

  it('answers /sales with an empty report instead of failing', async () => {
    const res = await getSales()

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      totalSales: 0,
      totalOrders: 0,
      avgOrderValue: 0,
      itemsSold: 0,
      topProducts: [],
      dailySales: [],
      hourlySales: [],
    })
  })

  it('bails before touching the database', async () => {
    await getSales()

    // Guards on the first line of the handler: no tenant filter is ever
    // built, so the malformed `eq.null` query cannot be issued at all.
    expect(fromSpy).not.toHaveBeenCalled()
  })

  it('returns matching empty shapes for the sibling reports', async () => {
    const stock = await request(app).get('/api/reports/stock')
    expect(stock.status).toBe(200)
    expect(stock.body).toMatchObject({
      totalProducts: 0,
      lowStockCount: 0,
      lowStockProducts: [],
      categoryBreakdown: [],
      topByValue: [],
    })

    const pl = await request(app).get('/api/reports/profit-loss')
    expect(pl.status).toBe(200)
    expect(pl.body).toMatchObject({ totalRevenue: 0, grossProfit: 0, margin: 0 })

    const expenses = await request(app).get('/api/reports/expenses')
    expect(expenses.status).toBe(200)
    expect(expenses.body).toMatchObject({ totalExpenses: 0, dailyExpenses: [] })

    const dead = await request(app).get('/api/reports/dead-stock')
    expect(dead.status).toBe(200)
    expect(dead.body).toMatchObject({ items: [], total_items: 0, total_value: 0 })

    expect(fromSpy).not.toHaveBeenCalled()
  })

  it('still serves tenant-scoped callers normally', async () => {
    currentUser = { id: 1, tenantId: 1, role: 'MANAGER' }

    const res = await getSales()

    expect(res.status).toBe(200)
    expect(res.body.totalOrders).toBe(4)
    expect(fromSpy).toHaveBeenCalled()
  })
})
