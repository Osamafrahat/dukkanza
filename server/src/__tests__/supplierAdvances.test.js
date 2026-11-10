// Supplier advances: recording, FIFO consumption on settlement, PO deposits,
// and the advance balance the Suppliers page renders.
//
// Why this file exists: an advance is a real asset (account 1150), not a
// negative payable, and the whole feature hinges on three money paths
// staying consistent with each other:
//   1. recording one  -> Dr 1150 / Cr cash-bank, one advance row;
//   2. settling up    -> Dr AP in full, Cr 1150 for what the advance
//                        covered, Cr cash-bank for the remainder, with the
//                        advance rows marked consumed oldest-first;
//   3. a PO deposit   -> the same as (1) but linked to the PO.
// The accounts mock resolves BY CODE (not positionally), so each assertion
// proves which account was actually debited/credited — the failure mode
// that produced this feature's predecessor bug (journal posted to the
// wrong side entirely while looking successful).

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon'

// ---------------------------------------------------------------------------
// Table-scripted supabase mock (same harness as purchaseOrderReceive.test.js)
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

// Accounts resolve BY the code each query filters on: a single request looks
// up 1150, 1010, 20101... and the assertions need to tell those apart.
const ACCOUNTS = {
  '1010': { id: 1, code: '1010', balance: 0 },      // Cash
  '1020': { id: 2, code: '1020', balance: 0 },      // Bank
  '1030': { id: 3, code: '1030', balance: 0 },      // Accounts Receivable
  '1150': { id: 5, code: '1150', balance: 0 },      // Supplier Advances
  '2010': { id: 99, code: '2010', balance: 0 },     // generic Accounts Payable
  '20101': { id: 22, code: '20101', balance: 500 }, // one supplier's payable
}

// Codes with no accounts row yet — the realistic default (seedChartOfAccounts
// has not run for this tenant, and findAccount's retry still misses).
const missingAccounts = new Set()

function makeAccountsFrom() {
  const chain = {}
  for (const m of ['select', 'in', 'order', 'limit', 'range', 'gte', 'lte', 'insert', 'update', 'delete']) {
    chain[m] = jest.fn(() => chain)
  }
  const codes = []
  chain.eq = jest.fn((col, val) => {
    if (col === 'code') codes.push(val)
    return chain
  })
  const result = () => {
    const code = codes[codes.length - 1]
    if (missingAccounts.has(code)) return { data: null, error: null }
    return { data: ACCOUNTS[code] ?? null, error: null }
  }
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

// Capture journals instead of writing them. createJournalEntry returns the
// entry ROW (not {data}), which is what both callers dereference.
const journalSpy = jest.fn(async () => ({ id: 501 }))
const seedSpy = jest.fn(async () => undefined)
jest.unstable_mockModule('../services/accountingEngine.js', () => ({
  createJournalEntry: journalSpy,
  seedChartOfAccounts: seedSpy,
}))

const { default: supplierAdvancesRouter } = await import('../routes/supplierAdvances.js')
const { paymentsRouter } = await import('../routes/payments.js')
const { default: purchaseOrdersRouter } = await import('../routes/purchaseOrders.js')
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
app.use('/api/supplier-advances', asUser, supplierAdvancesRouter)
app.use('/api/accounting/payments', asUser, paymentsRouter)
app.use('/api/purchase-orders', asUser, purchaseOrdersRouter)
app.use('/api/suppliers', asUser, suppliersRouter)

beforeEach(() => {
  queues.clear()
  defaults.clear()
  missingAccounts.clear()
  jest.clearAllMocks()
})

const callsFor = (table) => fromSpy.mock.calls.filter((c) => c[0] === table).length

// ---------------------------------------------------------------------------
// Recording an advance
// ---------------------------------------------------------------------------

describe('POST /supplier-advances — recording', () => {
  beforeEach(() => {
    enqueue('suppliers', { data: { id: 9, name: 'Acme' }, error: null })
    enqueue('payments',
      { data: { id: 600, payment_number: 'PAY-20261109-0001' }, error: null },
      { data: null, error: null })
    enqueue('supplier_advances', {
      data: { id: 700, supplier_id: 9, amount: 250, consumed_amount: 0, payment_id: 600, po_id: null },
      error: null,
    })
  })

  it('posts Dr 1150 / Cr cash and returns the advance row', async () => {
    const res = await request(app)
      .post('/api/supplier-advances')
      .send({ supplier_id: 9, amount: 250, method: 'cash' })

    expect(res.status).toBe(201)
    expect(res.body.advance).toMatchObject({ id: 700, amount: 250, consumed_amount: 0 })
    expect(res.body.journalEntryId).toBe(501)

    expect(journalSpy).toHaveBeenCalledTimes(1)
    const { lines } = journalSpy.mock.calls[0][0]
    expect(lines).toHaveLength(2)
    // 5 = 1150 Supplier Advances (asset up), 1 = 1010 Cash (cash out).
    expect(lines[0]).toMatchObject({ accountId: 5, debit: 250, credit: 0 })
    expect(lines[1]).toMatchObject({ accountId: 1, debit: 0, credit: 250 })
  })

  it('credits bank instead of cash for a bank_transfer', async () => {
    const res = await request(app)
      .post('/api/supplier-advances')
      .send({ supplier_id: 9, amount: 250, method: 'bank_transfer' })

    expect(res.status).toBe(201)
    const { lines } = journalSpy.mock.calls[0][0]
    expect(lines[1]).toMatchObject({ accountId: 2, debit: 0, credit: 250 })
  })

  it('rejects a non-positive amount before touching the database', async () => {
    const res = await request(app)
      .post('/api/supplier-advances')
      .send({ supplier_id: 9, amount: 0, method: 'cash' })

    expect(res.status).toBe(400)
    expect(callsFor('payments')).toBe(0)
    expect(journalSpy).not.toHaveBeenCalled()
  })

  it('404s when the supplier belongs to another tenant', async () => {
    queues.get('suppliers').length = 0
    enqueue('suppliers', { data: null, error: { message: 'not found' } })

    const res = await request(app)
      .post('/api/supplier-advances')
      .send({ supplier_id: 999, amount: 100, method: 'cash' })

    expect(res.status).toBe(404)
    expect(callsFor('payments')).toBe(0)
    expect(journalSpy).not.toHaveBeenCalled()
  })
})

describe('GET /supplier-advances — listing and availability', () => {
  it('reports remaining availability per row and in total', async () => {
    enqueue('supplier_advances', {
      data: [
        { id: 1, supplier_id: 9, amount: 100, consumed_amount: 0 },
        { id: 2, supplier_id: 9, amount: 50, consumed_amount: 20 },
      ],
      error: null,
    })

    const res = await request(app).get('/api/supplier-advances?supplier_id=9')

    expect(res.status).toBe(200)
    expect(res.body.data.map((r) => r.available)).toEqual([100, 30])
    expect(res.body.available).toBe(130)
  })

  it('answers /available/:supplierId with the consumable total', async () => {
    enqueue('supplier_advances', {
      data: [{ id: 1, supplier_id: 9, amount: 100, consumed_amount: 40 }],
      error: null,
    })

    const res = await request(app).get('/api/supplier-advances/available/9')

    expect(res.status).toBe(200)
    expect(res.body.available).toBe(60)
  })
})

// ---------------------------------------------------------------------------
// Settlement auto-consume (payments.js)
// ---------------------------------------------------------------------------

function primeSettlement(advanceRows, { amount = 100 } = {}) {
  enqueue('payments',
    { data: { id: 800, payment_number: 'PAY-20261109-0002', amount }, error: null },
    { data: null, error: null })
  enqueue('suppliers', { data: { account_code: '20101' }, error: null })
  enqueue('supplier_advances', { data: advanceRows, error: null })
  for (const row of advanceRows) {
    enqueue('supplier_advances', { data: [{ id: row.id }], error: null })
  }
  return request(app)
    .post('/api/accounting/payments')
    .send({
      payment_type: 'outbound',
      method: 'cash',
      amount,
      partner_type: 'supplier',
      partner_id: 9,
    })
}

describe('POST /accounting/payments — advance auto-consume', () => {
  it('consumes oldest-first and leaves nothing for cash when covered', async () => {
    // Row 10 (oldest): 60 available; row 11: 40 available. Both are eaten
    // to cover the 100 settlement, so no cash line may be posted.
    const res = await primeSettlement([
      { id: 10, amount: 60, consumed_amount: 0 },
      { id: 11, amount: 50, consumed_amount: 10 },
    ])

    expect(res.status).toBe(201)
    expect(res.body.advance_applied).toBe(100)

    const { lines } = journalSpy.mock.calls[0][0]
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ accountId: 22, debit: 100, credit: 0 }) // AP in full
    expect(lines[1]).toMatchObject({ accountId: 5, credit: 100 })            // 1150 applied
    // Cash must NOT be credited: the advance covered everything.
    expect(lines.some((l) => l.accountId === 1)).toBe(false)
  })

  it('caps the advance at what is available and charges cash for the rest', async () => {
    const res = await primeSettlement([{ id: 10, amount: 30, consumed_amount: 0 }])

    expect(res.status).toBe(201)
    expect(res.body.advance_applied).toBe(30)

    const { lines } = journalSpy.mock.calls[0][0]
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({ accountId: 22, debit: 100, credit: 0 }) // AP full
    expect(lines[1]).toMatchObject({ accountId: 5, credit: 30 })             // advance part
    expect(lines[2]).toMatchObject({ accountId: 1, credit: 70 })             // cash part
    // Balanced: 100 debit = 30 + 70 credits.
    const debits = lines.reduce((s, l) => s + l.debit, 0)
    const credits = lines.reduce((s, l) => s + l.credit, 0)
    expect(debits).toBe(credits)
  })

  it('falls back to the old all-cash journal when no advance exists', async () => {
    const res = await primeSettlement([])

    expect(res.status).toBe(201)
    expect(res.body.advance_applied).toBe(0)

    const { lines } = journalSpy.mock.calls[0][0]
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ accountId: 22, debit: 100, credit: 0 })
    expect(lines[1]).toMatchObject({ accountId: 1, credit: 100 })
    expect(lines.some((l) => l.accountId === 5)).toBe(false)
  })

  it('never consumes when 1150 cannot be resolved (nothing to credit)', async () => {
    // If the advance account is missing there is no destination for the
    // consumed part, so consuming would unbalance the journal.
    missingAccounts.add('1150')

    const res = await primeSettlement([{ id: 10, amount: 30, consumed_amount: 0 }])

    expect(res.status).toBe(201)
    expect(res.body.advance_applied).toBe(0)
    // consumeAdvances is never reached: no supplier_advances query at all.
    expect(callsFor('supplier_advances')).toBe(0)

    const { lines } = journalSpy.mock.calls[0][0]
    expect(lines.some((l) => l.accountId === 5)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// PO deposit at creation (purchaseOrders.js)
// ---------------------------------------------------------------------------

function primeCreatePO({ deposit_amount, deposit_method } = {}) {
  enqueue('products', { data: [{ id: 7, name: 'Widget' }], error: null })
  enqueue('purchase_orders', {
    data: { id: 15, tenant_id: 1, order_number: 'PO-100', supplier_id: 9, total: 500, status: 'draft', suppliers: { name: 'Acme' } },
    error: null,
  })
  enqueue('purchase_order_items',
    { data: null, error: null },
    { data: [{ id: 101, product_id: 7, quantity: 10, unit_price: 50, total: 500 }], error: null })

  const body = {
    supplier_id: 9,
    items: [{ product_id: 7, quantity: 10, unit_price: 50 }],
  }
  if (deposit_amount !== undefined) body.deposit_amount = deposit_amount
  if (deposit_method !== undefined) body.deposit_method = deposit_method
  return request(app).post('/api/purchase-orders').send(body)
}

describe('POST /purchase-orders — deposit', () => {
  beforeEach(() => {
    enqueue('payments',
      { data: { id: 900, payment_number: 'PAY-20261109-0003' }, error: null },
      { data: null, error: null })
    enqueue('supplier_advances', {
      data: { id: 701, supplier_id: 9, amount: 200, consumed_amount: 0, payment_id: 900, po_id: 15 },
      error: null,
    })
  })

  it('pays the deposit immediately: Dr 1150 / Cr cash, linked to the PO', async () => {
    const res = await primeCreatePO({ deposit_amount: 200, deposit_method: 'cash' })

    expect(res.status).toBe(201)
    expect(res.body.deposit).toMatchObject({ id: 701, amount: 200, po_id: 15 })

    expect(journalSpy).toHaveBeenCalledTimes(1)
    const { lines } = journalSpy.mock.calls[0][0]
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ accountId: 5, debit: 200, credit: 0 })
    expect(lines[1]).toMatchObject({ accountId: 1, credit: 200 })
  })

  it('rejects a deposit larger than the order total before creating anything', async () => {
    const res = await primeCreatePO({ deposit_amount: 600 })

    expect(res.status).toBe(400)
    expect(callsFor('purchase_orders')).toBe(0)
    expect(callsFor('payments')).toBe(0)
    expect(journalSpy).not.toHaveBeenCalled()
  })

  it('rejects a non-positive deposit', async () => {
    const res = await primeCreatePO({ deposit_amount: -5 })

    expect(res.status).toBe(400)
    expect(callsFor('purchase_orders')).toBe(0)
    expect(journalSpy).not.toHaveBeenCalled()
  })

  it('rejects an unknown deposit method', async () => {
    const res = await primeCreatePO({ deposit_amount: 100, deposit_method: 'bitcoin' })

    expect(res.status).toBe(400)
    expect(callsFor('purchase_orders')).toBe(0)
  })

  it('creates a clean PO with no deposit when none was given', async () => {
    const res = await primeCreatePO()

    expect(res.status).toBe(201)
    expect(res.body.deposit).toBeNull()
    expect(callsFor('supplier_advances')).toBe(0)
    expect(journalSpy).not.toHaveBeenCalled()
    // The pre-existing header + items flow still ran.
    expect(res.body.items).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Suppliers list enrichment
// ---------------------------------------------------------------------------

describe('GET /suppliers — advance balance enrichment', () => {
  it('adds advance_available alongside the AP balance', async () => {
    enqueue('suppliers', {
      data: [
        { id: 1, name: 'A', account_code: '20101' },
        { id: 2, name: 'B', account_code: null },
      ],
      error: null,
    })
    enqueue('supplier_advances', {
      data: [
        { supplier_id: 1, amount: 100, consumed_amount: 40 },
        { supplier_id: 1, amount: 50, consumed_amount: 0 },
        { supplier_id: 2, amount: 30, consumed_amount: 0 },
      ],
      error: null,
    })

    const res = await request(app).get('/api/suppliers')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0]).toMatchObject({ balance: 500, advance_available: 110 })
    expect(res.body[1]).toMatchObject({ balance: 0, advance_available: 30 })
  })

  it('still returns suppliers with 0 advances when the table is missing', async () => {
    // Pre-migration reality: the supplier_advances relation does not exist
    // yet. The page must not fall over while the migration is pending.
    enqueue('suppliers', { data: [{ id: 1, name: 'A', account_code: null }], error: null })
    enqueue('supplier_advances', { data: null, error: { message: 'relation "supplier_advances" does not exist' } })

    const res = await request(app).get('/api/suppliers')

    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({ advance_available: 0 })
  })
})
