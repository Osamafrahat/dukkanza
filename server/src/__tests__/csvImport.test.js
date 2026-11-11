// Bulk CSV import for products, customers and suppliers
// (POST /api/{products,customers,suppliers}/import).
//
// Why this file exists: the import batch must never fail wholesale — one
// bad cell costs the user a whole migration pass — so every row reports
// its own outcome while the batch returns 200. The suite pins the four
// contracts that are easy to regress silently:
//   1. upsert keys     — products by SKU then barcode, customers by phone
//                        then name, suppliers by name then phone;
//   2. per-row errors  — snake_case codes + the file line (_row) the user
//                        is looking at, never a thrown 400/500 mid-batch;
//   3. plan headroom    — a tenant AT its product cap still gets its
//                        updates through, only NEW rows say limit_reached
//                        (the single-create middleware would 403 the whole
//                        batch — that's why the route carries its own cap);
//   4. side contracts   — account_code on every created customer/supplier
//                        (1030-C*/2010-S*), create-on-sight categories and
//                        suppliers, stock through adjustStock, AP journal
//                        on seeded opening stock — the same obligations
//                        single-create upholds.
//
// The supabase mock is the queue harness from supplierAdvances.test.js:
// every await on a query chain consumes ONE queued result per table, so
// the queue order documents the route's query order. A mis-ordered route
// fails here with a mismatched payload instead of a silent wrong write.

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon'

// ---------------------------------------------------------------------------
// Table-scripted supabase mock (+ a write log: payloads are captured at call
// time, results resolve at await time)
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

const writes = [] // { table, op: 'insert' | 'update', payload }

function makeFrom(table) {
  const chain = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'range', 'gte', 'lte', 'delete']) {
    chain[m] = jest.fn(() => chain)
  }
  chain.insert = jest.fn((payload) => { writes.push({ table, op: 'insert', payload }); return chain })
  chain.update = jest.fn((payload) => { writes.push({ table, op: 'update', payload }); return chain })
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

// The three routes declare authenticateToken/requirePermission inline. The
// asUser mount below stands in for index.js's auth + activity logger, so the
// real middleware must not run (it would 401 without a JWT and hit the DB
// for session checks, stealing queue entries).
jest.unstable_mockModule('../middleware/auth.js', () => ({
  authenticateToken: (_req, _res, next) => next(),
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
  requireManager: (_req, _res, next) => next(),
  requireSuperAdmin: () => (_req, _res, next) => next(),
  generateToken: () => 'test-token',
  generateSessionToken: () => 'test-session',
}))

// adjustStock (RPC-backed) and the AP journal must not touch anything: they
// are asserted directly and would otherwise route through the queue.
const adjustSpy = jest.fn(async ({ delta }) => delta)
const overlaySpy = jest.fn(async (x) => x)
jest.unstable_mockModule('../services/branchStock.js', () => ({
  adjustStock: adjustSpy,
  overlayBranchStock: overlaySpy,
}))

const journalSpy = jest.fn(async () => ({ id: 501 }))
jest.unstable_mockModule('../services/accountingEngine.js', () => ({
  postStockReceiveJournal: journalSpy,
  createJournalEntry: jest.fn(async () => ({ id: 502 })),
  seedChartOfAccounts: jest.fn(async () => undefined),
  reverseJournalEntry: jest.fn(async () => ({ id: 503 })),
}))

const { default: productsRouter } = await import('../routes/products.js')
const { default: customersRouter } = await import('../routes/customers.js')
const { default: suppliersRouter } = await import('../routes/suppliers.js')
const { cleanNum, cleanPhone } = await import('../helpers/importClean.js')

const app = express()
// 5mb, mirroring index.js — the max-row envelope tests would otherwise trip
// the 100kb default with a 413 instead of the validator's 400.
app.use(express.json({ limit: '5mb' }))

const asUser = (req, _res, next) => {
  req.user = { id: 1, tenantId: 1, role: 'MANAGER' }
  req.branchId = null
  req.logActivity = jest.fn()
  next()
}
app.use('/api/products', asUser, productsRouter)
app.use('/api/customers', asUser, customersRouter)
app.use('/api/suppliers', asUser, suppliersRouter)

beforeEach(() => {
  queues.clear()
  writes.length = 0
  jest.clearAllMocks()
})

const writesFor = (table, op) => writes.filter((w) => w.table === table && (!op || w.op === op))

// ---------------------------------------------------------------------------
// Row cleaners — one implementation shared by all three routes
// ---------------------------------------------------------------------------

describe('importClean', () => {
  it('reads currency-suffixed numbers but refuses ambiguous dotted ones', () => {
    expect(cleanNum('1,250.50 ج.م')).toBe(1250.5) // the unit's dot must not poison the number
    expect(cleanNum('١٢٥')).toBe(125)
    expect(cleanNum('1.250.500')).toBeNull() // would otherwise read as 1.25
    expect(cleanNum('abc')).toBeNull()
    expect(cleanNum('')).toBeNull()
  })

  it('canonicalizes every Egyptian phone format to one shape', () => {
    expect(cleanPhone('01012345678')).toBe('1012345678')
    expect(cleanPhone('+20 10 1234 5678')).toBe('1012345678')
    expect(cleanPhone('00201012345678')).toBe('1012345678')
    expect(cleanPhone(cleanPhone('01012345678'))).toBe('1012345678') // idempotent
  })
})

// ---------------------------------------------------------------------------
// Envelope validation — a malformed request never reaches the batch
// ---------------------------------------------------------------------------

describe('import envelope validation', () => {
  it('rejects a missing / non-array / empty items payload with 400', async () => {
    for (const body of [{}, { items: [] }, { items: 'nope' }, { items: { 0: {} } }]) {
      const res = await request(app).post('/api/products/import').send(body)
      expect(res.status).toBe(400)
      expect(res.body.error).toBe('items must be a non-empty array')
    }
  })

  it('enforces the per-route row caps (2000 / 5000 / 5000)', async () => {
    const cases = [
      ['/api/products/import', 2001, 2000],
      ['/api/customers/import', 5001, 5000],
      ['/api/suppliers/import', 5001, 5000],
    ]
    for (const [path, count, cap] of cases) {
      const items = Array.from({ length: count }, (_, i) => ({ name: `r${i}` }))
      const res = await request(app).post(path).send({ items })
      expect(res.status).toBe(400)
      expect(res.body.error).toBe(`Too many rows (max ${cap} per import)`)
    }
  })
})

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

describe('POST /products/import', () => {
  it('creates new rows, updates by SKU, reports bad rows, and keeps identity columns read-only', async () => {
    enqueue('tenants', { data: { subscription_tier: 'free', max_products: null }, error: null })
    enqueue('products',
      { data: null, error: null, count: 30 }, // headroom: 50 - 30
      { data: [{ id: 7, name: 'Old Cola', sku: 'OLD-1', barcode: null, stock_quantity: 10 }], error: null },
      { data: { id: 901, name: 'Cola', sku: 'SKU-1', barcode: null, stock_quantity: 0, price: 10, cost_price: 6 }, error: null },
      { data: null, error: null }) // update
    enqueue('categories',
      { data: [], error: null }, // list
      { data: { id: 41, name: 'Drinks' }, error: null }) // create-on-sight
    enqueue('suppliers',
      { data: [], error: null }, // list
      { data: { id: 55, name: 'Pepsi Co' }, error: null }, // create-on-sight
      { data: null, error: null }) // account_code backfill

    const res = await request(app).post('/api/products/import').send({
      items: [
        { _row: 2, name: 'Cola', price: '10', cost_price: '6', sku: 'SKU-1', stock_quantity: '5', category: 'Drinks', supplier: 'Pepsi Co' },
        { _row: 3, name: 'Old Cola Plus', price: '12', cost_price: '7', sku: 'OLD-1', stock_quantity: '12' },
        { _row: 4, name: '   ', price: '10' },
        { _row: 5, name: 'No Price', price: 'abc' },
        { _row: 6, name: 'Dup', price: '5', sku: 'OLD-1' },
        { _row: 7, name: 'Costly', price: '5', cost_price: '8' },
      ],
    })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ created: 1, updated: 1, categories_created: 1, suppliers_created: 1 })
    expect(res.body.errors).toEqual([
      { row: 4, error: 'name_required' },
      { row: 5, error: 'price_invalid' },
      { row: 6, error: 'sku_in_file_dup' },
      { row: 7, error: 'cost_exceeds_price' },
    ])

    // Create: category/supplier resolved by name, defaults match single-create.
    const [prodInsert, prodUpdate] = writesFor('products')
    expect(prodInsert.payload).toMatchObject({
      tenant_id: 1, name: 'Cola', sku: 'SKU-1', barcode: null,
      category_id: 41, supplier_id: 55, price: 10, cost_price: 6,
      stock_quantity: 0, low_stock_threshold: 10,
    })
    expect(writesFor('categories', 'insert')[0].payload).toEqual({ tenant_id: 1, name: 'Drinks' })
    expect(writesFor('suppliers', 'insert')[0].payload).toEqual({ tenant_id: 1, name: 'Pepsi Co' })
    expect(writesFor('suppliers', 'update')[0].payload).toEqual({ account_code: '2010-S55' })

    // Update: SKU identifies the row but must never be rewritten, and the
    // CSV's stock states the shelf count (set-to, not increment).
    expect(prodUpdate.payload).not.toHaveProperty('sku')
    expect(prodUpdate.payload).toMatchObject({ name: 'Old Cola Plus', price: 12, cost_price: 7 })

    // Stock: seed 5 on create, move 10 -> 12 on update, through adjustStock.
    expect(adjustSpy.mock.calls.map((c) => c[0].delta)).toEqual([5, 2])
    expect(adjustSpy.mock.calls[0][0]).toMatchObject({ tenantId: 1, branchId: null, productId: 901 })

    // AP journal on seeded opening stock from a known supplier.
    expect(journalSpy).toHaveBeenCalledTimes(1)
    expect(journalSpy.mock.calls[0][0]).toEqual({ id: 901, quantity: 5 })
    expect(journalSpy.mock.calls[0][1]).toEqual({ name: 'Cola', cost_price: 6 })
    expect(journalSpy.mock.calls[0][2]).toMatchObject({ id: 55, account_code: '2010-S55' })
    expect(journalSpy.mock.calls[0][3]).toBe(1)
  })

  it('reports limit_reached for NEW rows when the tenant is at its cap, still allowing updates', async () => {
    enqueue('tenants', { data: { subscription_tier: 'free', max_products: null }, error: null })
    enqueue('products',
      { data: null, error: null, count: 50 }, // at the free-plan cap
      { data: [{ id: 7, name: 'Old Cola', sku: 'OLD-1', barcode: null, stock_quantity: 10 }], error: null },
      { data: null, error: null }) // update
    enqueue('categories', { data: [], error: null })
    enqueue('suppliers', { data: [], error: null })

    const res = await request(app).post('/api/products/import').send({
      items: [
        { _row: 2, name: 'Brand New', price: '5' },
        { _row: 3, name: 'Old Cola', price: '11', sku: 'OLD-1' },
      ],
    })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ created: 0, updated: 1 })
    expect(res.body.errors).toEqual([{ row: 2, error: 'limit_reached' }])
    expect(writesFor('products', 'insert')).toHaveLength(0)
    expect(writesFor('products', 'update')).toHaveLength(1)
  })

  it('fails open when the cap cannot be read (headroom stays infinite)', async () => {
    enqueue('tenants', { data: null, error: { message: 'tenant missing' } })
    enqueue('products',
      { data: null, error: { message: 'count failed' } },
      { data: [], error: null },
      { data: { id: 12, name: 'New', sku: null, barcode: null, stock_quantity: 0 }, error: null })
    enqueue('categories', { data: [], error: null })
    enqueue('suppliers', { data: [], error: null })

    const res = await request(app).post('/api/products/import').send({
      items: [{ _row: 2, name: 'New', price: '5' }],
    })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ created: 1, updated: 0, errors: [] })
  })

  it('reserves the SKU for the first occurrence in the file and reports later duplicates', async () => {
    enqueue('tenants', { data: { subscription_tier: 'enterprise', max_products: -1 }, error: null })
    enqueue('products',
      { data: null, error: null, count: 0 },
      { data: [], error: null },
      { data: { id: 1, name: 'A', sku: 'S1', barcode: null, stock_quantity: 0 }, error: null },
      { data: { id: 2, name: 'B', sku: 'S1', barcode: null, stock_quantity: 0 }, error: null })
    enqueue('categories', { data: [], error: null })
    enqueue('suppliers', { data: [], error: null })

    const res = await request(app).post('/api/products/import').send({
      items: [
        { _row: 2, name: 'A', price: '5', sku: 'S1' },
        { _row: 3, name: 'B', price: '5', sku: 's1' },
      ],
    })

    expect(res.body).toMatchObject({ created: 1, updated: 0 })
    expect(res.body.errors).toEqual([{ row: 3, error: 'sku_in_file_dup' }])
  })
})

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

describe('POST /customers/import', () => {
  it('upserts by phone then name, guards in-file dupes and phone/name conflicts', async () => {
    enqueue('customers',
      { data: [
        { id: 1, name: 'Ali', phone: '1012345678', email: null, address: null, notes: null },
        { id: 2, name: 'Sara', phone: '1099999999', email: null, address: null, notes: null },
        { id: 3, name: 'Mona', phone: null, email: null, address: null, notes: null },
        { id: 4, name: 'Omar', phone: '1055555555', email: null, address: null, notes: null },
        { id: 5, name: 'Yara', phone: '1066666666', email: null, address: null, notes: null },
      ], error: null },
      { data: null, error: null }, // Ali update
      { data: { id: 30, name: 'Nour' }, error: null }, // Nour insert
      { data: null, error: null }, // account_code backfill
      { data: null, error: null }) // Mona update

    const res = await request(app).post('/api/customers/import').send({
      items: [
        { _row: 2, name: 'Ali', phone: '01012345678' },          // phone canonicalizes -> update
        { _row: 3, name: 'Nour', phone: '01122222333' },          // brand new
        { _row: 4, name: 'Mona', phone: '' },                    // phoneless legacy -> name match
        { _row: 5, name: 'Ali', phone: '' },                     // phoneless repeat of a used name
        { _row: 6, name: 'Sara', phone: '01012345678' },         // phone already claimed in file
        { _row: 7, name: 'Omar', phone: '01066666666' },          // name->c4, phone->c5: ambiguous
        { _row: 8, name: '', phone: '0107777777' },
      ],
    })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ created: 1, updated: 2 })
    expect(res.body.errors).toEqual([
      { row: 5, error: 'name_in_file_dup' },
      { row: 6, error: 'phone_in_file_dup' },
      { row: 7, error: 'phone_conflict' },
      { row: 8, error: 'name_required' },
    ])

    const customerWrites = writesFor('customers')
    expect(customerWrites).toHaveLength(4)
    // Phone match updated Ali with the canonical phone.
    expect(customerWrites[0]).toMatchObject({ op: 'update' })
    expect(customerWrites[0].payload).toMatchObject({ name: 'Ali', phone: '1012345678' })
    // Created rows get the per-customer AR account, same shape as single-create.
    expect(customerWrites[1].payload).toMatchObject({ tenant_id: 1, name: 'Nour', phone: '1122222333', email: null, address: null, notes: null })
    expect(customerWrites[2].payload).toEqual({ account_code: '1030-C30' })
    // Name match updated Mona; her (absent from file) phone stays untouched
    // only insofar as the mapped column existed — phone WAS mapped ('' -> null).
    expect(customerWrites[3].payload).toMatchObject({ name: 'Mona', phone: null })
  })

  it('lets a name-matched row adopt a brand-new phone', async () => {
    enqueue('customers', { data: [{ id: 3, name: 'Mona', phone: null, email: null, address: null, notes: null }], error: null },
      { data: null, error: null })

    const res = await request(app).post('/api/customers/import').send({
      items: [{ _row: 2, name: 'Mona', phone: '01011112222' }],
    })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ created: 0, updated: 1, errors: [] })
    expect(writesFor('customers')[0].payload).toMatchObject({ phone: '1011112222' })
  })
})

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

describe('POST /suppliers/import', () => {
  it('upserts by name then phone, reports repeats of a name within the file', async () => {
    enqueue('suppliers',
      { data: [{ id: 9, name: 'Acme', contact_person: null, email: null, phone: '1012345678', address: null, notes: null }], error: null },
      { data: null, error: null }, // Acme update
      { data: { id: 10, name: 'Fresh Foods' }, error: null }, // insert
      { data: null, error: null }) // account_code backfill

    const res = await request(app).post('/api/suppliers/import').send({
      items: [
        { _row: 2, name: 'Acme', phone: '01012345678', contact_person: 'Sam' },
        { _row: 3, name: 'Fresh Foods' },
        { _row: 4, name: 'Acme' },
        { _row: 5, name: '  ' },
      ],
    })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ created: 1, updated: 1 })
    expect(res.body.errors).toEqual([
      { row: 4, error: 'name_in_file_dup' },
      { row: 5, error: 'name_required' },
    ])

    const supplierWrites = writesFor('suppliers')
    expect(supplierWrites[0].payload).toMatchObject({ name: 'Acme', phone: '1012345678', contact_person: 'Sam' })
    expect(supplierWrites[1].payload).toMatchObject({ tenant_id: 1, name: 'Fresh Foods', contact_person: null, phone: null })
    expect(supplierWrites[2].payload).toEqual({ account_code: '2010-S10' })
  })
})
