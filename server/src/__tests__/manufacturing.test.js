// Manufacturing (MRP) — cost engine (pure) + route behaviour.
//
// The supabase mock is table-scripted: a per-table queue is consumed
// first, then an infinite per-table default, because the completion flow
// re-reads the same tables several times (loadOrder -> fetchDetail ->
// post-success refetch). Every chain is awaitable (routes do both
// `await query` and `await query.single()`), and update/insert calls are
// recorded so tests can assert on payloads (e.g. MO numbering, cost_price
// updates) without extra spy plumbing.

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'

// ---------------------------------------------------------------------------
// Controllable supabase mock
// ---------------------------------------------------------------------------

const queues = new Map()
const defaults = new Map()
const inserts = []
const updates = []
const rpcSpy = jest.fn()
let rpcResult = { data: null, error: null }

function enqueue(table, ...results) {
  queues.set(table, [...(queues.get(table) || []), ...results])
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
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'range', 'gte', 'lte', 'delete']) {
    chain[m] = jest.fn(() => chain)
  }
  chain.insert = jest.fn((rows) => {
    inserts.push({ table, rows })
    return chain
  })
  chain.update = jest.fn((patch) => {
    updates.push({ table, patch })
    return chain
  })
  chain.single = jest.fn(() => Promise.resolve(nextResult(table)))
  chain.maybeSingle = jest.fn(() => Promise.resolve(nextResult(table)))
  chain.count = jest.fn(() => chain)
  chain.then = (resolve, reject) => Promise.resolve(nextResult(table)).then(resolve, reject)
  return chain
}

jest.unstable_mockModule('../db/supabase.js', () => ({
  default: {
    from: (table) => makeFrom(table),
    rpc: (name, args) => {
      rpcSpy(name, args)
      return Promise.resolve(rpcResult)
    },
  },
  supabaseStorage: { from: (table) => makeFrom(table) },
  withTimeout: (p) => p,
}))

const { default: bomsRouter } = await import('../routes/boms.js')
const { default: productionOrdersRouter } = await import('../routes/productionOrders.js')
const {
  TRANSITIONS,
  COMPLETABLE,
  canTransition,
  computeBomPlan,
  computeFrozenPlan,
  mergeByProduct,
  qcGate,
  workOrdersGate,
} = await import('../services/manufacturingCost.js')

const app = express()
app.use(express.json())
app.use('/api/manufacturing/boms', bomsRouter)
// Stand-in for authenticateToken (mounted in index.js) so handlers see the
// real req.user shape: { id, tenantId, ... }.
app.use('/api/manufacturing/orders', (req, res, next) => {
  req.user = { id: 1, tenantId: 1, role: 'MANAGER' }
  next()
}, productionOrdersRouter)

beforeEach(() => {
  queues.clear()
  defaults.clear()
  inserts.length = 0
  updates.length = 0
  rpcSpy.mockReset()
  rpcResult = { data: null, error: null }
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

// ---------------------------------------------------------------------------
// Cost engine (pure)
// ---------------------------------------------------------------------------

describe('manufacturingCost engine', () => {
  it('only allows the documented transitions', () => {
    expect(canTransition('confirmed', 'in_progress')).toBe(true)
    expect(canTransition('draft', 'in_progress')).toBe(false)
    expect(canTransition('done', 'cancelled')).toBe(false)
    expect(canTransition('in_progress', 'done')).toBe(false) // must go through complete
    expect(Object.keys(TRANSITIONS)).toHaveLength(7)
    expect(COMPLETABLE).toEqual(['in_progress', 'paused', 'quality_check'])
  })

  it('scales the BOM, applies waste, and prices routings', () => {
    const plan = computeBomPlan({
      bom: { output_quantity: 2 },
      items: [
        { product_id: 1, quantity: 2, waste_factor: 10, unit_cost: 5, is_byproduct: false },
        { product_id: 2, quantity: 1, unit_cost: 0, is_byproduct: true },
      ],
      operations: [{ work_center_id: 9, expected_minutes: 30 }],
      workCenters: [{ id: 9, cost_per_hour: 60 }],
      quantity: 6, // 3 BOM runs
    })
    expect(plan.outputScale).toBe(3)
    expect(plan.consumption).toEqual([{ product_id: 1, quantity: 6, unit_cost: 5 }])
    expect(plan.scrap).toEqual([{ product_id: 1, quantity: 0.6, unit_cost: 5 }])
    expect(plan.byproducts).toEqual([{ product_id: 2, quantity: 3 }])
    expect(plan.componentCost).toBe(33) // (6 + 0.6) * 5
    expect(plan.operationsCost).toBe(90) // 30min * 3 runs = 90min @ 60/h
    expect(plan.totalCost).toBe(123)
    expect(plan.unitCost).toBe(20.5) // 123 / 6
  })

  it('merges duplicate component lines before scaling', () => {
    const merged = mergeByProduct([
      { product_id: 1, quantity: 2 },
      { product_id: 1, quantity: 3 },
      { product_id: 2, quantity: 1 },
    ])
    expect(merged).toHaveLength(2)
    expect(merged.find((r) => r.product_id === 1).quantity).toBe(5)
  })

  it('prices completion from the freeze and excludes skipped steps', () => {
    const plan = computeFrozenPlan({
      items: [
        { product_id: 1, quantity_planned: 6, scrap_quantity: 0.6, unit_cost: 5, is_byproduct: false },
        { product_id: 2, quantity_planned: 3, scrap_quantity: 0, unit_cost: 0, is_byproduct: true },
      ],
      workOrders: [
        { work_center_id: 9, expected_minutes: 90, status: 'done' },
        { work_center_id: 9, expected_minutes: 999, status: 'skipped' },
      ],
      workCenters: [{ id: 9, cost_per_hour: 60 }],
      quantity: 6,
      produced: 6,
    })
    expect(plan.componentCost).toBe(33)
    expect(plan.operationsCost).toBe(90) // skipped step costs nothing
    expect(plan.totalCost).toBe(123)
    expect(plan.unitCost).toBe(20.5)
    expect(plan.byproducts).toEqual([{ product_id: 2, quantity: 3 }])
  })

  it('gates completion on open work orders and unresolved checks', () => {
    expect(workOrdersGate([])).toEqual({ ok: true, remaining: 0 })
    expect(workOrdersGate([{ status: 'pending' }, { status: 'running' }, { status: 'skipped' }]))
      .toEqual({ ok: false, remaining: 2 })
    expect(qcGate([])).toEqual({ ok: true, pending: 0, failed: 0 })
    expect(qcGate([{ result: 'pass' }]).ok).toBe(true)
    expect(qcGate([{ result: 'pending' }])).toEqual({ ok: false, pending: 1, failed: 0 })
    expect(qcGate([{ result: 'fail' }])).toEqual({ ok: false, pending: 0, failed: 1 })
  })
})

// ---------------------------------------------------------------------------
// BOM routes
// ---------------------------------------------------------------------------

describe('boms routes', () => {
  it('rejects a BOM with no component inputs', async () => {
    const res = await request(app)
      .post('/api/manufacturing/boms')
      .send({
        product_id: 1,
        items: [{ product_id: 9, quantity: 1, is_byproduct: true }],
      })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('BOM_NO_INPUTS')
  })

  it('maps the one-active-BOM unique violation to 409', async () => {
    setDefault('products', { data: { id: 1, name: 'Widget' }, error: null })
    enqueue('bills_of_materials', { data: null, error: { code: '23505', message: 'duplicate key' } })

    const res = await request(app)
      .post('/api/manufacturing/boms')
      .send({ product_id: 1, items: [{ product_id: 9, quantity: 2 }] })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('BOM_ACTIVE_EXISTS')
  })

  it('blocks deletion while production orders reference the BOM', async () => {
    setDefault('bills_of_materials', { data: { id: 5, products: { name: 'Widget Kit' } }, error: null })
    setDefault('production_orders', { data: null, error: null, count: 3 })

    const res = await request(app).delete('/api/manufacturing/boms/5')
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('BOM_IN_USE')
    expect(inserts).toHaveLength(0)
  })

  it('validates query ids', async () => {
    const res = await request(app).get('/api/manufacturing/boms?product_id=abc')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid product_id')
  })
})

// ---------------------------------------------------------------------------
// Production order routes
// ---------------------------------------------------------------------------

const inProgressOrder = () => ({
  id: 77,
  tenant_id: 1,
  order_number: 'MO-000077',
  product_id: 5,
  bom_id: 8,
  branch_id: null,
  quantity: 6,
  quantity_produced: 6,
  // Costs as the RPC has just written them: this row serves every fetch of
  // the order, including the post-completion refetch the GL post reads.
  component_cost: 30,
  operations_cost: 0,
  total_cost: 30,
  unit_cost: 5,
  status: 'in_progress',
  notes: null,
  products: { id: 5, name: 'Orange Juice', sku: 'OJ' },
  branches: null,
  bills_of_materials: { id: 8, output_quantity: 2, status: 'active' },
})

const frozenItem = () => ({
  id: 1,
  tenant_id: 1,
  order_id: 77,
  product_id: 9,
  quantity_planned: 6,
  scrap_quantity: 0,
  unit_cost: 5,
  is_byproduct: false,
})

function primeOrder({ status = 'in_progress', items = [frozenItem()], workOrders = [], checks = [], stock = 100 } = {}) {
  const order = inProgressOrder()
  order.status = status
  setDefault('production_orders', { data: order, error: null })
  setDefault('production_order_items', { data: items, error: null })
  setDefault('work_orders', { data: workOrders, error: null })
  setDefault('quality_checks', { data: checks, error: null })
  setDefault('work_centers', { data: [], error: null })
  setDefault('products', { data: [{ id: 9, name: 'Oranges', stock_quantity: stock }], error: null })
  // Post-completion accounting path (only reached on success)
  setDefault('accounts', { data: { id: 100, code: '1050' }, error: null })
  setDefault('fiscal_periods', { data: { id: 5 }, error: null })
  setDefault('journal_entries', { data: { id: 900, entry_number: 'JE-1' }, error: null })
  setDefault('journal_entry_lines', { data: null, error: null })
  return order
}

describe('productionOrders routes', () => {
  it('validates the status filter', async () => {
    const res = await request(app).get('/api/manufacturing/orders?status=nope')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid status')
  })

  it('refuses to complete a draft order (state machine)', async () => {
    primeOrder({ status: 'draft' })
    const res = await request(app).post('/api/manufacturing/orders/77/complete').send({})
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('ORDER_STATE')
    expect(res.body.status).toBe('draft')
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('blocks completion while work orders are open', async () => {
    primeOrder({ workOrders: [{ id: 1, status: 'pending', expected_minutes: 30, work_center_id: null }] })
    const res = await request(app).post('/api/manufacturing/orders/77/complete').send({})
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('WO_PENDING')
    expect(res.body.remaining).toBe(1)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('blocks completion on pending quality checks', async () => {
    primeOrder({ checks: [{ id: 1, result: 'pending' }] })
    const res = await request(app).post('/api/manufacturing/orders/77/complete').send({})
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('QC_PENDING')
    expect(res.body.pending).toBe(1)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('blocks completion on failed quality checks', async () => {
    primeOrder({ checks: [{ id: 1, result: 'fail' }] })
    const res = await request(app).post('/api/manufacturing/orders/77/complete').send({})
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('QC_FAILED')
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('names the products when stock is short', async () => {
    primeOrder({ stock: 2 }) // needs 6
    const res = await request(app).post('/api/manufacturing/orders/77/complete').send({})
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('STOCK_INSUFFICIENT')
    expect(res.body.shortages).toEqual([
      { product_id: 9, name: 'Oranges', available: 2, required: 6 },
    ])
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('completes atomically via the RPC, updates cost_price, and posts the journal', async () => {
    primeOrder()
    rpcResult = { data: 77, error: null }

    const res = await request(app)
      .post('/api/manufacturing/orders/77/complete')
      .send({})

    expect(res.status).toBe(200)

    // The one stock-moving call: 13-arg RPC with the frozen consumption
    expect(rpcSpy).toHaveBeenCalledTimes(1)
    expect(rpcSpy.mock.calls[0][0]).toBe('mfg_complete_order')
    expect(rpcSpy.mock.calls[0][1]).toEqual({
      p_tenant_id: 1,
      p_order_id: 77,
      p_branch_id: null,
      p_items: [{ product_id: 9, quantity: 6, unit_cost: 5 }],
      p_scrap: [],
      p_output: [{ product_id: 5, quantity: 6 }],
      p_quantity_produced: 6,
      p_component_cost: 30,
      p_operations_cost: 0,
      p_total_cost: 30,
      p_unit_cost: 5,
      p_notes: null,
      p_user_id: 1,
    })

    // cost_price follows the computed unit cost (default on)
    const costUpdate = updates.find((u) => u.table === 'products' && u.patch.cost_price !== undefined)
    expect(costUpdate).toBeTruthy()
    expect(costUpdate.patch.cost_price).toBe(5)

    // journal_entry_id recorded from the auto-post (900 from the mock)
    const journalUpdate = updates.find((u) => u.table === 'production_orders' && u.patch.journal_entry_id)
    expect(journalUpdate).toBeTruthy()
    expect(journalUpdate.patch.journal_entry_id).toBe(900)
  })

  it('still completes when update_cost_price is off', async () => {
    primeOrder()
    rpcResult = { data: 77, error: null }

    const res = await request(app)
      .post('/api/manufacturing/orders/77/complete')
      .send({ update_cost_price: false })

    expect(res.status).toBe(200)
    expect(updates.find((u) => u.table === 'products' && u.patch.cost_price !== undefined)).toBeUndefined()
    expect(rpcSpy).toHaveBeenCalledTimes(1)
  })

  it('creates an order with a derived MO number', async () => {
    setDefault('products', { data: { id: 5, name: 'Orange Juice' }, error: null })
    setDefault('bills_of_materials', { data: { id: 8, status: 'active', product_id: 5 }, error: null })
    enqueue('production_orders',
      { data: { id: 77 }, error: null },          // insert
      { data: null, error: null },                // order_number update
    )
    setDefault('production_order_items', { data: [], error: null })
    setDefault('work_orders', { data: [], error: null })
    setDefault('quality_checks', { data: [], error: null })

    const res = await request(app)
      .post('/api/manufacturing/orders')
      .send({ product_id: 5, bom_id: 8, quantity: 6 })

    expect(res.status).toBe(201)
    const created = inserts.find((i) => i.table === 'production_orders')
    expect(created.rows.order_number).toBe('MO-pending')
    const numbered = updates.find((u) => u.table === 'production_orders' && u.patch.order_number)
    expect(numbered.patch.order_number).toBe('MO-000077')
  })

  it('rejects a BOM that does not produce the ordered product', async () => {
    setDefault('products', { data: { id: 5, name: 'Orange Juice' }, error: null })
    setDefault('bills_of_materials', { data: { id: 8, status: 'active', product_id: 999 }, error: null })

    const res = await request(app)
      .post('/api/manufacturing/orders')
      .send({ product_id: 5, bom_id: 8, quantity: 6 })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('BOM_PRODUCT_MISMATCH')
  })
})
