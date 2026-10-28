import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import supabase from '../db/supabase.js'
import {
  TRANSITIONS,
  COMPLETABLE,
  canTransition,
  computeBomPlan,
  computeFrozenPlan,
  qcGate,
  workOrdersGate,
  round,
} from '../services/manufacturingCost.js'

// Production orders (MOs). Lifecycle:
//   draft -> confirmed -> in_progress (freeze components + routings)
//         -> paused/quality_check -> done (atomic RPC: consume + produce)
//         -> cancelled (always clean: nothing is consumed until done)
//
// Components are FROZEN into production_order_items at start, so editing
// the BOM mid-run cannot change what a started order consumes. Stock only
// moves inside mfg_complete_order() (add-manufacturing.sql), which locks
// the product rows FOR UPDATE — a concurrent POS sale can never spend the
// same unit twice.

const router = Router()

const validate = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg })
  }
  next()
}

const parseId = (v) => {
  const n = parseInt(v, 10)
  return Number.isInteger(n) && n > 0 ? n : null
}

const ORDER_SELECT =
  '*, products(id, name, sku, unit_of_measure), branches(id, name), bills_of_materials(id, output_quantity, status)'

async function loadOrder(req, res) {
  const id = parseId(req.params.id)
  if (!id) {
    res.status(400).json({ error: 'Invalid order id' })
    return null
  }
  const { data, error } = await supabase
    .from('production_orders')
    .select(ORDER_SELECT)
    .eq('id', id)
    .eq('tenant_id', req.user?.tenantId)
    .maybeSingle()
  if (error) throw error
  if (!data) {
    res.status(404).json({ error: 'Production order not found' })
    return null
  }
  return data
}

// 409 with the current state and what WAS allowed — the client shows this
// verbatim when two tabs race the same order.
function badState(res, order) {
  return res.status(409).json({
    error: `Order is '${order.status}' — that transition is not allowed`,
    code: 'ORDER_STATE',
    status: order.status,
    allowed: TRANSITIONS[order.status] || [],
  })
}

// Guarded status flip: the .eq('status') makes a concurrent transition lose
// cleanly (empty result) instead of double-executing.
async function transition(order, to, extra = {}) {
  const { data, error } = await supabase
    .from('production_orders')
    .update({ status: to, updated_at: new Date().toISOString(), ...extra })
    .eq('id', order.id)
    .eq('tenant_id', order.tenant_id)
    .eq('status', order.status)
    .select('id, status')
  if (error) throw error
  return (data || [])[0] || null
}

async function fetchDetail(orderId, tid) {
  const [orderRes, itemsRes, woRes, qcRes] = await Promise.all([
    supabase.from('production_orders').select(ORDER_SELECT)
      .eq('id', orderId).eq('tenant_id', tid).maybeSingle(),
    supabase.from('production_order_items')
      .select('*, products(id, name, sku, unit_of_measure, cost_price)')
      .eq('order_id', orderId).eq('tenant_id', tid).order('id', { ascending: true }),
    supabase.from('work_orders')
      .select('*, work_centers(id, name, cost_per_hour)')
      .eq('order_id', orderId).eq('tenant_id', tid)
      .order('sequence', { ascending: true }).order('id', { ascending: true }),
    supabase.from('quality_checks')
      .select('*')
      .eq('order_id', orderId).eq('tenant_id', tid)
      .order('created_at', { ascending: false }),
  ])
  if (orderRes.error) throw orderRes.error
  if (itemsRes.error) throw itemsRes.error
  if (woRes.error) throw woRes.error
  if (qcRes.error) throw qcRes.error
  if (!orderRes.data) return null
  return {
    ...orderRes.data,
    items: itemsRes.data || [],
    work_orders: woRes.data || [],
    quality_checks: qcRes.data || [],
  }
}

// Map mfg_complete_order's typed RAISE codes to HTTP (mirror of
// transfers.js mapTransferError).
const RPC_STATUS = {
  ORDER_NOT_FOUND: [404, 'Production order not found'],
  ORDER_STATE: [409, 'Order is not in a completable state'],
  ORDER_EMPTY: [400, 'Order has no components to consume'],
  ORDER_INVALID: [400, 'Invalid completion payload'],
  STOCK_INSUFFICIENT: [409, 'Not enough stock to complete this order'],
}

function mapRpcError(err) {
  const msg = String(err?.message || err || '')
  for (const [code, [status, error]] of Object.entries(RPC_STATUS)) {
    if (msg.includes(code)) return { status, body: { error, code } }
  }
  return null
}

// ---------------------------------------------------------------------------
// Read side
// ---------------------------------------------------------------------------

// List (newest first; status filter + limit/offset paging)
router.get('/', async (req, res, next) => {
  try {
    const tid = req.user?.tenantId
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200)
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0)

    let query = supabase
      .from('production_orders')
      // count must be requested up front: supabase-js >= 2.100 dropped the
      // chained .count() builder, so a late `await query.count('exact')`
      // throws a TypeError and 500s the route.
      .select(ORDER_SELECT, { count: 'exact' })
      .eq('tenant_id', tid)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (req.query.status) {
      if (!Object.keys(TRANSITIONS).includes(req.query.status)) {
        return res.status(400).json({ error: 'Invalid status' })
      }
      query = query.eq('status', req.query.status)
    }
    if (req.query.product_id) {
      const pid = parseId(req.query.product_id)
      if (!pid) return res.status(400).json({ error: 'Invalid product_id' })
      query = query.eq('product_id', pid)
    }

    const { data, error, count } = await query
    if (error) throw error
    res.json({ orders: data || [], total: count ?? (data || []).length })
  } catch (err) {
    next(err)
  }
})

// Counts per status for the status tabs
router.get('/stats', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('production_orders')
      .select('status')
      .eq('tenant_id', req.user?.tenantId)
    if (error) throw error
    const counts = Object.fromEntries(Object.keys(TRANSITIONS).map((s) => [s, 0]))
    for (const row of data || []) {
      if (counts[row.status] !== undefined) counts[row.status] += 1
    }
    res.json({ counts, total: (data || []).length })
  } catch (err) {
    next(err)
  }
})

// Order detail: header + frozen components + work orders + quality checks
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ error: 'Invalid order id' })
    const detail = await fetchDetail(id, req.user?.tenantId)
    if (!detail) return res.status(404).json({ error: 'Production order not found' })
    res.json(detail)
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// Write side — lifecycle
// ---------------------------------------------------------------------------

// Create (draft)
router.post('/', [
  body('product_id').isInt({ gt: 0 }).withMessage('product_id is required'),
  body('bom_id').isInt({ gt: 0 }).withMessage('bom_id is required'),
  body('quantity').isFloat({ gt: 0 }).withMessage('Quantity must be > 0'),
  body('branch_id').optional({ nullable: true }).isInt({ gt: 0 }).withMessage('Invalid branch_id'),
], validate, async (req, res, next) => {
  try {
    const tid = req.user?.tenantId
    const { product_id, bom_id, quantity, branch_id = null, notes = null } = req.body

    const [{ data: product }, { data: bom }] = await Promise.all([
      supabase.from('products').select('id, name').eq('id', parseInt(product_id, 10))
        .eq('tenant_id', tid).maybeSingle(),
      supabase.from('bills_of_materials').select('id, status, product_id')
        .eq('id', parseInt(bom_id, 10)).eq('tenant_id', tid).maybeSingle(),
    ])
    if (!product) return res.status(404).json({ error: 'Product not found' })
    if (!bom) return res.status(404).json({ error: 'BOM not found' })
    if (bom.status !== 'active') {
      return res.status(409).json({ error: 'BOM is not active', code: 'BOM_NOT_ACTIVE' })
    }
    if (Number(bom.product_id) !== Number(product_id)) {
      return res.status(400).json({ error: 'BOM does not produce this product', code: 'BOM_PRODUCT_MISMATCH' })
    }
    if (branch_id) {
      const { data: branch } = await supabase.from('branches')
        .select('id').eq('id', parseInt(branch_id, 10)).eq('tenant_id', tid).maybeSingle()
      if (!branch) return res.status(404).json({ error: 'Branch not found' })
    }

    // order_number is derived from the row id after insert (global sequence
    // lpad'ed to 6) — no per-tenant counter to race on.
    const { data: created, error } = await supabase
      .from('production_orders')
      .insert({
        tenant_id: tid,
        order_number: 'MO-pending',
        product_id: parseInt(product_id, 10),
        bom_id: parseInt(bom_id, 10),
        branch_id: branch_id ? parseInt(branch_id, 10) : null,
        quantity: parseFloat(quantity),
        status: 'draft',
        notes,
        created_by: req.user?.id != null ? String(req.user.id) : 'system',
      })
      .select('id')
      .single()
    if (error) throw error

    const orderNumber = `MO-${String(created.id).padStart(6, '0')}`
    const { error: numErr } = await supabase
      .from('production_orders')
      .update({ order_number: orderNumber, updated_at: new Date().toISOString() })
      .eq('id', created.id)
      .eq('tenant_id', tid)
    if (numErr) throw numErr

    req.logActivity?.({
      action: 'created',
      entity_type: 'production_order',
      entity_id: created.id,
      entity_name: orderNumber,
    })

    const detail = await fetchDetail(created.id, tid)
    res.status(201).json(detail)
  } catch (err) {
    next(err)
  }
})

// Edit (draft/confirmed only — start freezes everything)
router.put('/:id', [
  body('quantity').optional().isFloat({ gt: 0 }).withMessage('Quantity must be > 0'),
  body('bom_id').optional().isInt({ gt: 0 }).withMessage('Invalid bom_id'),
  body('branch_id').optional({ nullable: true }).isInt({ gt: 0 }).withMessage('Invalid branch_id'),
], validate, async (req, res, next) => {
  try {
    const tid = req.user?.tenantId
    const order = await loadOrder(req, res)
    if (!order) return
    if (order.status !== 'draft' && order.status !== 'confirmed') return badState(res, order)

    const patch = { updated_at: new Date().toISOString() }
    if (req.body.quantity !== undefined) patch.quantity = parseFloat(req.body.quantity)
    if (req.body.notes !== undefined) patch.notes = req.body.notes
    if (req.body.branch_id !== undefined) patch.branch_id = req.body.branch_id ? parseInt(req.body.branch_id, 10) : null
    if (req.body.bom_id !== undefined) {
      const { data: bom } = await supabase.from('bills_of_materials')
        .select('id, status, product_id').eq('id', parseInt(req.body.bom_id, 10))
        .eq('tenant_id', tid).maybeSingle()
      if (!bom) return res.status(404).json({ error: 'BOM not found' })
      if (bom.status !== 'active') return res.status(409).json({ error: 'BOM is not active', code: 'BOM_NOT_ACTIVE' })
      if (Number(bom.product_id) !== Number(order.product_id)) {
        return res.status(400).json({ error: 'BOM does not produce this product', code: 'BOM_PRODUCT_MISMATCH' })
      }
      patch.bom_id = bom.id
    }

    const { error } = await supabase.from('production_orders')
      .update(patch).eq('id', order.id).eq('tenant_id', tid)
    if (error) throw error

    req.logActivity?.({
      action: 'updated',
      entity_type: 'production_order',
      entity_id: order.id,
      entity_name: order.order_number,
    })
    res.json(await fetchDetail(order.id, tid))
  } catch (err) {
    next(err)
  }
})

// draft -> confirmed
router.post('/:id/confirm', async (req, res, next) => {
  try {
    const order = await loadOrder(req, res)
    if (!order) return
    if (!canTransition(order.status, 'confirmed')) return badState(res, order)
    const flipped = await transition(order, 'confirmed')
    if (!flipped) return badState(res, order)
    res.json(await fetchDetail(order.id, req.user?.tenantId))
  } catch (err) {
    next(err)
  }
})

// confirmed -> in_progress: freeze components (at current BOM + current
// costs) and instantiate routings as work orders.
router.post('/:id/start', async (req, res, next) => {
  try {
    const tid = req.user?.tenantId
    const order = await loadOrder(req, res)
    if (!order) return
    if (!canTransition(order.status, 'in_progress')) return badState(res, order)
    if (!order.bom_id) {
      return res.status(409).json({ error: 'Order has no BOM', code: 'BOM_REQUIRED' })
    }

    const [itemsRes, opsRes, wcRes] = await Promise.all([
      supabase.from('bom_items')
        .select('*, products(id, cost_price)')
        .eq('bom_id', order.bom_id).eq('tenant_id', tid)
        .order('sort_order', { ascending: true }),
      supabase.from('bom_operations')
        .select('*')
        .eq('bom_id', order.bom_id).eq('tenant_id', tid)
        .order('sequence', { ascending: true }),
      supabase.from('work_centers').select('id, cost_per_hour').eq('tenant_id', tid),
    ])
    if (itemsRes.error) throw itemsRes.error
    if (opsRes.error) throw opsRes.error
    if (wcRes.error) throw wcRes.error

    const bomItems = (itemsRes.data || []).map((i) => ({
      ...i,
      unit_cost: Number(i.products?.cost_price) || 0,
    }))
    if (!bomItems.some((i) => !i.is_byproduct)) {
      return res.status(400).json({ error: 'BOM has no component inputs', code: 'BOM_NO_INPUTS' })
    }

    const plan = computeBomPlan({
      bom: { output_quantity: order.bills_of_materials?.output_quantity },
      items: bomItems,
      operations: opsRes.data || [],
      workCenters: wcRes.data || [],
      quantity: order.quantity,
    })

    const scrapByPid = new Map(plan.scrap.map((s) => [s.product_id, s.quantity]))
    const freezeRows = [
      ...plan.consumption.map((c) => ({
        tenant_id: tid,
        order_id: order.id,
        product_id: c.product_id,
        quantity_planned: c.quantity,
        scrap_quantity: scrapByPid.get(c.product_id) || 0,
        unit_cost: c.unit_cost,
        is_byproduct: false,
      })),
      ...plan.byproducts.map((b) => ({
        tenant_id: tid,
        order_id: order.id,
        product_id: b.product_id,
        quantity_planned: b.quantity,
        scrap_quantity: 0,
        unit_cost: 0,
        is_byproduct: true,
      })),
    ]

    const frozen = await supabase
      .from('production_order_items')
      .insert(freezeRows)
      .select('id')
    if (frozen.error) throw frozen.error

    if ((opsRes.data || []).length > 0) {
      const woRows = (opsRes.data || []).map((op) => ({
        tenant_id: tid,
        order_id: order.id,
        work_center_id: op.work_center_id || null,
        sequence: op.sequence,
        name: op.name,
        status: 'pending',
        expected_minutes: op.expected_minutes || 0,
      }))
      const { error: woErr } = await supabase.from('work_orders').insert(woRows)
      if (woErr) throw woErr
    }

    const startedAt = new Date().toISOString()
    const flipped = await transition(order, 'in_progress', { started_at: startedAt })
    if (!flipped) {
      // Lost the race to another start/cancel — roll the freeze back so we
      // never leave orphaned rows on a non-started order.
      await supabase.from('production_order_items').delete().eq('order_id', order.id).eq('tenant_id', tid)
      await supabase.from('work_orders').delete().eq('order_id', order.id).eq('tenant_id', tid)
      const fresh = await loadOrderById(order.id, tid)
      return fresh ? badState(res, fresh) : res.status(409).json({ error: 'Order state changed', code: 'ORDER_STATE' })
    }

    req.logActivity?.({
      action: 'started',
      entity_type: 'production_order',
      entity_id: order.id,
      entity_name: order.order_number,
    })
    res.json(await fetchDetail(order.id, tid))
  } catch (err) {
    next(err)
  }
})

async function loadOrderById(id, tid) {
  const { data, error } = await supabase
    .from('production_orders')
    .select('id, status, order_number')
    .eq('id', id)
    .eq('tenant_id', tid)
    .maybeSingle()
  if (error) throw error
  return data
}

// in_progress <-> paused
router.post('/:id/pause', async (req, res, next) => {
  try {
    const order = await loadOrder(req, res)
    if (!order) return
    if (!canTransition(order.status, 'paused')) return badState(res, order)
    const flipped = await transition(order, 'paused')
    if (!flipped) return badState(res, order)
    res.json(await fetchDetail(order.id, req.user?.tenantId))
  } catch (err) {
    next(err)
  }
})

router.post('/:id/resume', async (req, res, next) => {
  try {
    const order = await loadOrder(req, res)
    if (!order) return
    if (!canTransition(order.status, 'in_progress')) return badState(res, order)
    const flipped = await transition(order, 'in_progress')
    if (!flipped) return badState(res, order)
    res.json(await fetchDetail(order.id, req.user?.tenantId))
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// Work orders (routing step instances)
// ---------------------------------------------------------------------------

async function loadWorkOrder(req, res) {
  const orderId = parseId(req.params.id)
  const woId = parseId(req.params.woId)
  if (!orderId || !woId) {
    res.status(400).json({ error: 'Invalid id' })
    return null
  }
  const { data, error } = await supabase
    .from('work_orders')
    .select('*')
    .eq('id', woId)
    .eq('order_id', orderId)
    .eq('tenant_id', req.user?.tenantId)
    .maybeSingle()
  if (error) throw error
  if (!data) {
    res.status(404).json({ error: 'Work order not found' })
    return null
  }
  return data
}

async function flipWorkOrder(wo, to, extra = {}) {
  const { data, error } = await supabase
    .from('work_orders')
    .update({ ...extra, status: to })
    .eq('id', wo.id)
    .eq('tenant_id', wo.tenant_id)
    .eq('status', wo.status)
    .select('id, status')
  if (error) throw error
  return (data || [])[0] || null
}

router.post('/:id/work-orders/:woId/start', async (req, res, next) => {
  try {
    const order = await loadOrder(req, res)
    if (!order) return
    if (order.status !== 'in_progress') return badState(res, order)
    const wo = await loadWorkOrder(req, res)
    if (!wo) return
    if (wo.status !== 'pending') {
      return res.status(409).json({ error: `Step is '${wo.status}'`, code: 'WO_STATE', status: wo.status })
    }
    const flipped = await flipWorkOrder(wo, 'running', { started_at: new Date().toISOString() })
    if (!flipped) return res.status(409).json({ error: 'Step state changed', code: 'WO_STATE' })
    res.json(await fetchDetail(order.id, req.user?.tenantId))
  } catch (err) {
    next(err)
  }
})

router.post('/:id/work-orders/:woId/complete', async (req, res, next) => {
  try {
    const order = await loadOrder(req, res)
    if (!order) return
    if (order.status !== 'in_progress') return badState(res, order)
    const wo = await loadWorkOrder(req, res)
    if (!wo) return
    if (wo.status !== 'running') {
      return res.status(409).json({ error: `Step is '${wo.status}' — start it first`, code: 'WO_STATE', status: wo.status })
    }
    const now = Date.now()
    const startedMs = wo.started_at ? Date.parse(wo.started_at) : now
    const actual = wo.started_at ? Math.max(0.1, round((now - startedMs) / 60000, 1)) : Number(wo.expected_minutes) || 0
    const flipped = await flipWorkOrder(wo, 'done', {
      actual_minutes: actual,
      completed_at: new Date().toISOString(),
    })
    if (!flipped) return res.status(409).json({ error: 'Step state changed', code: 'WO_STATE' })
    res.json(await fetchDetail(order.id, req.user?.tenantId))
  } catch (err) {
    next(err)
  }
})

router.post('/:id/work-orders/:woId/skip', async (req, res, next) => {
  try {
    const order = await loadOrder(req, res)
    if (!order) return
    if (order.status !== 'in_progress' && order.status !== 'paused') return badState(res, order)
    const wo = await loadWorkOrder(req, res)
    if (!wo) return
    if (wo.status !== 'pending' && wo.status !== 'running') {
      return res.status(409).json({ error: `Step is '${wo.status}'`, code: 'WO_STATE', status: wo.status })
    }
    const flipped = await flipWorkOrder(wo, 'skipped')
    if (!flipped) return res.status(409).json({ error: 'Step state changed', code: 'WO_STATE' })
    res.json(await fetchDetail(order.id, req.user?.tenantId))
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// Quality checks (completion gate)
// ---------------------------------------------------------------------------

router.post('/:id/quality', [
  body('check_name').trim().notEmpty().withMessage('check_name is required'),
  body('result').optional().isIn(['pending', 'pass', 'fail']).withMessage('Invalid result'),
  body('quantity_passed').optional().isFloat({ gte: 0 }).withMessage('quantity_passed must be >= 0'),
  body('quantity_failed').optional().isFloat({ gte: 0 }).withMessage('quantity_failed must be >= 0'),
], validate, async (req, res, next) => {
  try {
    const tid = req.user?.tenantId
    const order = await loadOrder(req, res)
    if (!order) return
    if (order.status === 'done' || order.status === 'cancelled') return badState(res, order)

    const result = req.body.result || 'pending'
    const { data, error } = await supabase
      .from('quality_checks')
      .insert({
        tenant_id: tid,
        order_id: order.id,
        work_order_id: req.body.work_order_id ? parseInt(req.body.work_order_id, 10) : null,
        check_name: req.body.check_name,
        result,
        quantity_passed: parseFloat(req.body.quantity_passed) || 0,
        quantity_failed: parseFloat(req.body.quantity_failed) || 0,
        inspector: req.body.inspector || null,
        notes: req.body.notes || null,
        checked_at: result !== 'pending' ? new Date().toISOString() : null,
      })
      .select()
      .single()
    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    next(err)
  }
})

router.put('/:id/quality/:qcId', [
  body('result').optional().isIn(['pending', 'pass', 'fail']).withMessage('Invalid result'),
  body('quantity_passed').optional().isFloat({ gte: 0 }).withMessage('quantity_passed must be >= 0'),
  body('quantity_failed').optional().isFloat({ gte: 0 }).withMessage('quantity_failed must be >= 0'),
], validate, async (req, res, next) => {
  try {
    const tid = req.user?.tenantId
    const orderId = parseId(req.params.id)
    const qcId = parseId(req.params.qcId)
    if (!orderId || !qcId) return res.status(400).json({ error: 'Invalid id' })

    const patch = {}
    if (req.body.result !== undefined) {
      patch.result = req.body.result
      patch.checked_at = req.body.result !== 'pending' ? new Date().toISOString() : null
    }
    if (req.body.quantity_passed !== undefined) patch.quantity_passed = parseFloat(req.body.quantity_passed)
    if (req.body.quantity_failed !== undefined) patch.quantity_failed = parseFloat(req.body.quantity_failed)
    if (req.body.inspector !== undefined) patch.inspector = req.body.inspector
    if (req.body.notes !== undefined) patch.notes = req.body.notes

    const { data, error } = await supabase
      .from('quality_checks')
      .update(patch)
      .eq('id', qcId)
      .eq('order_id', orderId)
      .eq('tenant_id', tid)
      .select()
      .maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Quality check not found' })
    res.json(data)
  } catch (err) {
    next(err)
  }
})

router.delete('/:id/quality/:qcId', async (req, res, next) => {
  try {
    const tid = req.user?.tenantId
    const orderId = parseId(req.params.id)
    const qcId = parseId(req.params.qcId)
    if (!orderId || !qcId) return res.status(400).json({ error: 'Invalid id' })
    const { data, error } = await supabase
      .from('quality_checks')
      .delete()
      .eq('id', qcId)
      .eq('order_id', orderId)
      .eq('tenant_id', tid)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Quality check not found' })
    res.json({ ok: true, id: qcId })
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// Completion — the only place stock moves
// ---------------------------------------------------------------------------

router.post('/:id/complete', [
  body('quantity_produced').optional().isFloat({ gt: 0 }).withMessage('quantity_produced must be > 0'),
], validate, async (req, res, next) => {
  try {
    const tid = req.user?.tenantId
    const order = await loadOrder(req, res)
    if (!order) return
    if (!COMPLETABLE.includes(order.status)) return badState(res, order)

    const detail = await fetchDetail(order.id, tid)
    if (!detail) return res.status(404).json({ error: 'Production order not found' })
    const { items, work_orders: workOrders, quality_checks: checks } = detail

    const inputs = items.filter((i) => !i.is_byproduct)
    if (inputs.length === 0) {
      return res.status(409).json({ error: 'Order was never started — no frozen components', code: 'NOT_STARTED' })
    }

    // Gates: routings first, then QC
    const woGate = workOrdersGate(workOrders)
    if (!woGate.ok) {
      return res.status(409).json({
        error: `${woGate.remaining} work order${woGate.remaining === 1 ? '' : 's'} still open — finish or skip them first`,
        code: 'WO_PENDING',
        remaining: woGate.remaining,
      })
    }
    const qc = qcGate(checks)
    if (qc.pending > 0) {
      return res.status(409).json({ error: `${qc.pending} quality check(s) pending`, code: 'QC_PENDING', pending: qc.pending })
    }
    if (qc.failed > 0) {
      return res.status(409).json({ error: `${qc.failed} quality check(s) failed`, code: 'QC_FAILED', failed: qc.failed })
    }

    const produced = req.body.quantity_produced !== undefined
      ? parseFloat(req.body.quantity_produced)
      : Number(order.quantity)
    if (!Number.isFinite(produced) || produced <= 0) {
      return res.status(400).json({ error: 'quantity_produced must be > 0', code: 'PRODUCED_REQUIRED' })
    }

    // Cost plan from the FREEZE (BOM edits mid-run cannot change it)
    const wcRes = await supabase.from('work_centers').select('id, cost_per_hour').eq('tenant_id', tid)
    if (wcRes.error) throw wcRes.error
    const plan = computeFrozenPlan({
      items,
      workOrders,
      workCenters: wcRes.data || [],
      quantity: order.quantity,
      produced,
    })

    // Friendly shortage report BEFORE the authoritative RPC (the RPC also
    // checks, race-safe — this just names the products for the UI).
    const needed = new Map()
    for (const c of plan.consumption) needed.set(c.product_id, (needed.get(c.product_id) || 0) + c.quantity)
    for (const s of plan.scrap) needed.set(s.product_id, (needed.get(s.product_id) || 0) + s.quantity)
    const ids = [...needed.keys()]
    const [prodRes, stockRes] = await Promise.all([
      supabase.from('products').select('id, name, stock_quantity').eq('tenant_id', tid).in('id', ids),
      order.branch_id
        ? supabase.from('product_stock').select('product_id, quantity')
            .eq('tenant_id', tid).eq('branch_id', order.branch_id).in('product_id', ids)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (prodRes.error) throw prodRes.error
    if (stockRes.error) throw stockRes.error
    const byId = new Map((prodRes.data || []).map((p) => [p.id, p]))
    const available = new Map()
    if (order.branch_id) {
      for (const r of stockRes.data || []) available.set(Number(r.product_id), Number(r.quantity) || 0)
    } else {
      for (const p of prodRes.data || []) available.set(Number(p.id), Number(p.stock_quantity) || 0)
    }
    const shortages = []
    for (const [pid, qty] of needed) {
      const have = available.get(Number(pid)) || 0
      if (have < qty) {
        shortages.push({
          product_id: pid,
          name: byId.get(Number(pid))?.name || `#${pid}`,
          available: have,
          required: round(qty),
        })
      }
    }
    if (shortages.length > 0) {
      return res.status(409).json({ error: 'Not enough stock to complete this order', code: 'STOCK_INSUFFICIENT', shortages })
    }

    // Authoritative, atomic: consume + produce + finalize in one txn
    const outputs = [
      { product_id: order.product_id, quantity: produced },
      ...plan.byproducts,
    ]
    let rpcErr = null
    try {
      const { error } = await supabase.rpc('mfg_complete_order', {
        p_tenant_id: tid,
        p_order_id: order.id,
        p_branch_id: order.branch_id || null,
        p_items: plan.consumption,
        p_scrap: plan.scrap,
        p_output: outputs,
        p_quantity_produced: produced,
        p_component_cost: plan.componentCost,
        p_operations_cost: plan.operationsCost,
        p_total_cost: plan.totalCost,
        p_unit_cost: plan.unitCost,
        p_notes: order.notes || null,
        p_user_id: req.user?.id != null ? Number(req.user.id) : null,
      })
      if (error) rpcErr = error
    } catch (err) {
      rpcErr = err
    }
    if (rpcErr) {
      const mapped = mapRpcError(rpcErr)
      if (mapped) return res.status(mapped.status).json(mapped.body)
      console.error('[MFG] mfg_complete_order failed:', rpcErr.message || rpcErr)
      return res.status(500).json({ error: 'Failed to complete order' })
    }

    // ---- Everything below is post-success best-effort (house style:
    // accounting/valuation failures log, they never fail the request). ----
    try {
      const refreshed = await fetchDetail(order.id, tid)

      if (req.body.update_cost_price !== false && plan.unitCost > 0) {
        await supabase.from('products')
          .update({ cost_price: plan.unitCost, updated_at: new Date().toISOString() })
          .eq('id', order.product_id)
          .eq('tenant_id', tid)
      }

      let journalEntryId = null
      try {
        const { postProductionJournal } = await import('../services/accountingEngine.js')
        const entry = await postProductionJournal(refreshed, { name: refreshed.products?.name || '' }, tid)
        if (entry?.id) journalEntryId = entry.id
      } catch (accErr) {
        console.error('Accounting auto-post failed:', accErr.message)
      }
      if (journalEntryId) {
        await supabase.from('production_orders')
          .update({ journal_entry_id: journalEntryId })
          .eq('id', order.id)
          .eq('tenant_id', tid)
      }

      req.logActivity?.({
        action: 'completed',
        entity_type: 'production_order',
        entity_id: order.id,
        entity_name: order.order_number,
        details: { produced, total_cost: plan.totalCost },
      })

      res.json(await fetchDetail(order.id, tid))
    } catch (postErr) {
      // The order IS done (stock already moved) — report success, log loud.
      console.error('[MFG] post-completion steps failed:', postErr.message || postErr)
      res.json(await fetchDetail(order.id, tid))
    }
  } catch (err) {
    next(err)
  }
})

// Cancel — clean at every pre-done state (nothing consumed yet)
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const order = await loadOrder(req, res)
    if (!order) return
    if (!canTransition(order.status, 'cancelled')) return badState(res, order)
    const flipped = await transition(order, 'cancelled')
    if (!flipped) return badState(res, order)

    req.logActivity?.({
      action: 'cancelled',
      entity_type: 'production_order',
      entity_id: order.id,
      entity_name: order.order_number,
    })
    res.json(await fetchDetail(order.id, req.user?.tenantId))
  } catch (err) {
    next(err)
  }
})

export default router
