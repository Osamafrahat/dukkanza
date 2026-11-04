// PATCH /purchase-orders/:id/receive — goods receipt and its accounting.
//
// Receiving used to look like it worked (stock moved, status flipped) while
// touching no account at all, for two independent reasons:
//   1. the cost loop read `item.unit_cost`, a column PO items do not have
//      (they store `unit_price` + `total`), so totalCost was always 0 and
//      the `totalCost > 0` guard skipped the journal silently;
//   2. even when it did run, the credit went to generic 2010 instead of the
//      supplier's own account — which is the account the Suppliers page
//      reads for its "remaining balance" and that payments.js debits when
//      settling up, so the two sides never met.
//
// The accounts mock below resolves BY the `code` each query filters on, so
// the assertions prove which account was actually credited.

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'

// ---------------------------------------------------------------------------
// Table-scripted supabase mock
// ---------------------------------------------------------------------------

const queues = new Map()
const defaults = new Map()

function enqueue(table, ...results) {
  if (!queues.has(table)) queues.set(table, [])
  queues.get(table).push(...results)
}
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
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'range', 'gte', 'lte', 'update', 'insert', 'delete']) {
    chain[m] = jest.fn(() => chain)
  }
  chain.single = jest.fn(() => Promise.resolve(nextResult(table)))
  chain.maybeSingle = jest.fn(() => Promise.resolve(nextResult(table)))
  chain.then = (resolve, reject) => Promise.resolve(nextResult(table)).then(resolve, reject)
  return chain
}

// Accounts are resolved by the code each query filters on: the route looks
// up 1050 and then the supplier's code, and the test asserts on the ids that
// come back — a positional queue could not tell those two lookups apart.
const ACCOUNTS = {
  '1050': { id: 11, code: '1050' },   // Inventory
  '2010': { id: 99, code: '2010' },   // generic Accounts Payable
  '20101': { id: 22, code: '20101' }, // supplier's own payable
}

function makeAccountsFrom() {
  const chain = {}
  for (const m of ['select', 'in', 'order', 'limit', 'range', 'gte', 'lte']) {
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

// Stock lands through adjustStock (branch-aware); keep it a spy.
const adjustStockSpy = jest.fn(async () => true)
jest.unstable_mockModule('../services/branchStock.js', () => ({
  adjustStock: adjustStockSpy,
}))

jest.unstable_mockModule('../services/branches.js', () => ({
  resolveBranchParam: jest.fn(async () => ({ value: null, error: null })),
}))

// Capture the journal instead of writing one.
const journalSpy = jest.fn(async () => ({ data: { id: 501 }, error: null }))
jest.unstable_mockModule('../services/accountingEngine.js', () => ({
  createJournalEntry: journalSpy,
}))

const { default: purchaseOrdersRouter } = await import('../routes/purchaseOrders.js')

const app = express()
app.use(express.json())
// index.js mounts this router behind authenticateToken; stand in for it.
app.use('/api/purchase-orders', (req, res, next) => {
  req.user = { id: 1, tenantId: 1, role: 'MANAGER' }
  req.branchId = null
  next()
}, purchaseOrdersRouter)

const PO = {
  id: 15,
  tenant_id: 1,
  order_number: 'PO-1793183963644',
  status: 'sent',
  supplier_id: 9,
  branch_id: null,
  total: 500,
}
// Note: `unit_price` and `total` — there is deliberately no `unit_cost`.
const ITEMS = [
  { id: 101, product_id: 7, quantity: 10, unit_price: 50, total: 500, received_quantity: 0 },
]
const RECEIVED_PO = {
  ...PO,
  status: 'received',
  received_date: '2026-11-04T10:00:00.000Z',
  suppliers: { name: 'شركة الفتح' },
}

function prime({ accountCode = '20101' } = {}) {
  // purchase_orders is read twice (load, then post-update refetch) and
  // purchase_order_items twice (select, then post-update select).
  enqueue('purchase_orders', { data: PO }, { data: RECEIVED_PO })
  enqueue('purchase_order_items', { data: ITEMS }, { data: ITEMS })
  setDefault('purchase_orders', { data: RECEIVED_PO, error: null })
  setDefault('purchase_order_items', { data: ITEMS, error: null })
  setDefault('stock_movements', { data: null, error: null })
  setDefault('suppliers', { data: accountCode ? { account_code: accountCode } : { account_code: null }, error: null })
}

beforeEach(() => {
  queues.clear()
  defaults.clear()
  jest.clearAllMocks()
  prime()
})

const receive = () =>
  request(app).patch('/api/purchase-orders/15/receive')

describe('receive — journal posting', () => {
  it('posts a journal for the full PO value', async () => {
    const res = await receive()

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('received')
    expect(journalSpy).toHaveBeenCalledTimes(1)

    // 10 units x 50 — computed from unit_price/total, not the nonexistent
    // unit_cost (which used to yield NaN -> 0 and skip the entry entirely).
    const { lines } = journalSpy.mock.calls[0][0]
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ accountId: 11, debit: 500, credit: 0 })
    expect(lines[1]).toMatchObject({ debit: 0, credit: 500 })
  })

  it('credits the SUPPLIER account, not the generic 2010', async () => {
    await receive()

    const { lines } = journalSpy.mock.calls[0][0]
    // 22 is suppliers.account_code 20101; 99 is the generic 2010. The
    // Suppliers page derives "remaining balance" from 22's accounts.balance,
    // and payments.js debits 22 — so crediting 99 would leave both untouched.
    expect(lines[1].accountId).toBe(22)
    expect(lines[1].accountId).not.toBe(99)
  })

  it('falls back to generic 2010 when the supplier has no account', async () => {
    prime({ accountCode: null })

    await receive()

    const { lines } = journalSpy.mock.calls[0][0]
    expect(lines[1].accountId).toBe(99)
  })

  it('still receives the goods if the journal fails', async () => {
    journalSpy.mockImplementationOnce(() => {
      throw new Error('accounting unavailable')
    })

    const res = await receive()

    // Accounting must never block a goods receipt — stock and status win.
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('received')
  })

  it('moves stock for the received quantity', async () => {
    await receive()

    expect(adjustStockSpy).toHaveBeenCalledTimes(1)
    expect(adjustStockSpy.mock.calls[0][0]).toMatchObject({
      productId: 7,
      delta: 10,
    })
  })

  it('refuses to receive the same PO twice', async () => {
    // Drop the entries beforeEach queued (which start as `sent`) so the
    // handler actually sees an already-received order.
    queues.get('purchase_orders').length = 0
    enqueue('purchase_orders', { data: { ...PO, status: 'received' } })

    const res = await receive()

    expect(res.status).toBe(400)
    expect(journalSpy).not.toHaveBeenCalled()
  })
})
