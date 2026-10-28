import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import supabase from '../db/supabase.js'

// Bills of Materials — recipes/assemblies. One ACTIVE BOM per product is
// enforced by the partial unique index in add-manufacturing.sql (Odoo's
// rule); drafts and archived versions may stack. BOMs referenced by any
// production order can be archived but not deleted (order history keeps
// pointing at them, FK is ON DELETE SET NULL as a second net).

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

// Supabase maps SQLSTATE 23505 -> error.code '23505'; unique violations on
// these tables always mean "already exists / already active".
const isUniqueViolation = (err) => err?.code === '23505'

const ORDER_DETAIL_SELECT =
  '*, products(id, name, sku, unit_of_measure)'

async function loadBom(req, res) {
  const id = parseId(req.params.id)
  if (!id) {
    res.status(400).json({ error: 'Invalid BOM id' })
    return null
  }
  const { data, error } = await supabase
    .from('bills_of_materials')
    .select(ORDER_DETAIL_SELECT)
    .eq('id', id)
    .eq('tenant_id', req.user?.tenantId)
    .maybeSingle()
  if (error) throw error
  if (!data) {
    res.status(404).json({ error: 'BOM not found' })
    return null
  }
  return data
}

async function fetchParts(bomId, tid) {
  const [itemsRes, opsRes] = await Promise.all([
    supabase
      .from('bom_items')
      .select('*, products(id, name, sku, unit_of_measure, cost_price)')
      .eq('bom_id', bomId)
      .eq('tenant_id', tid)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true }),
    supabase
      .from('bom_operations')
      .select('*, work_centers(id, name, cost_per_hour)')
      .eq('bom_id', bomId)
      .eq('tenant_id', tid)
      .order('sequence', { ascending: true })
      .order('id', { ascending: true }),
  ])
  if (itemsRes.error) throw itemsRes.error
  if (opsRes.error) throw opsRes.error
  return { items: itemsRes.data || [], operations: opsRes.data || [] }
}

// List BOMs (header + counts, newest first)
router.get('/', async (req, res, next) => {
  try {
    const tid = req.user?.tenantId
    let query = supabase
      .from('bills_of_materials')
      .select('*, products(id, name, sku), bom_items(id), bom_operations(id)')
      .eq('tenant_id', tid)
      .order('created_at', { ascending: false })

    if (req.query.product_id) {
      const pid = parseId(req.query.product_id)
      if (!pid) return res.status(400).json({ error: 'Invalid product_id' })
      query = query.eq('product_id', pid)
    }
    if (req.query.status) {
      if (!['draft', 'active', 'archived'].includes(req.query.status)) {
        return res.status(400).json({ error: 'Invalid status' })
      }
      query = query.eq('status', req.query.status)
    }

    const { data, error } = await query
    if (error) throw error

    res.json((data || []).map((b) => ({
      ...b,
      item_count: (b.bom_items || []).length,
      operation_count: (b.bom_operations || []).length,
      bom_items: undefined,
      bom_operations: undefined,
    })))
  } catch (err) {
    next(err)
  }
})

// BOM detail: header + ordered components + routings
router.get('/:id', async (req, res, next) => {
  try {
    const bom = await loadBom(req, res)
    if (!bom) return
    const { items, operations } = await fetchParts(bom.id, req.user?.tenantId)
    res.json({ ...bom, items, operations })
  } catch (err) {
    next(err)
  }
})

// Create a BOM with its components and routings in one payload
router.post('/', [
  body('product_id').isInt({ gt: 0 }).withMessage('product_id is required'),
  body('output_quantity').optional().isFloat({ gt: 0 }).withMessage('output_quantity must be > 0'),
  body('status').optional().isIn(['draft', 'active', 'archived']).withMessage('Invalid status'),
  body('items').isArray({ min: 1 }).withMessage('items must be a non-empty array'),
  body('items.*.product_id').isInt({ gt: 0 }).withMessage('Each item needs a product_id'),
  body('items.*.quantity').isFloat({ gt: 0 }).withMessage('Each item quantity must be > 0'),
  body('items.*.waste_factor').optional().isFloat({ gte: 0, lt: 100 }).withMessage('waste_factor must be 0-99'),
  body('operations').optional().isArray().withMessage('operations must be an array'),
], validate, async (req, res, next) => {
  try {
    const tid = req.user?.tenantId
    const {
      product_id, output_quantity, status = 'active', notes = null,
      items = [], operations = [],
    } = req.body

    const inputs = items.filter((i) => !i.is_byproduct)
    if (inputs.length === 0) {
      return res.status(400).json({ error: 'A BOM needs at least one component input', code: 'BOM_NO_INPUTS' })
    }

    // Product must belong to this tenant
    const { data: product, error: prodErr } = await supabase
      .from('products')
      .select('id, name')
      .eq('id', parseInt(product_id, 10))
      .eq('tenant_id', tid)
      .maybeSingle()
    if (prodErr) throw prodErr
    if (!product) return res.status(404).json({ error: 'Product not found' })

    // Work centers must belong to this tenant (FK would reject anyway with
    // a confusing 500 — checking gives a clean 400)
    const wcIds = [...new Set(operations.map((o) => parseInt(o.work_center_id, 10)).filter(Boolean))]
    if (wcIds.length > 0) {
      const { data: wcs, error: wcErr } = await supabase
        .from('work_centers')
        .select('id')
        .eq('tenant_id', tid)
        .in('id', wcIds)
      if (wcErr) throw wcErr
      if ((wcs || []).length !== wcIds.length) {
        return res.status(400).json({ error: 'Unknown work center', code: 'WC_UNKNOWN' })
      }
    }

    const { data: bom, error } = await supabase
      .from('bills_of_materials')
      .insert({
        tenant_id: tid,
        product_id: parseInt(product_id, 10),
        output_quantity: output_quantity !== undefined ? parseFloat(output_quantity) : 1,
        status,
        notes,
        created_by: req.user?.id != null ? String(req.user.id) : 'system',
      })
      .select()
      .single()
    if (error) {
      if (isUniqueViolation(error)) {
        return res.status(409).json({
          error: 'This product already has an active BOM — archive it first or edit the existing one',
          code: 'BOM_ACTIVE_EXISTS',
        })
      }
      throw error
    }

    const itemRows = items.map((i, idx) => ({
      tenant_id: tid,
      bom_id: bom.id,
      product_id: parseInt(i.product_id, 10),
      quantity: parseFloat(i.quantity),
      waste_factor: i.waste_factor !== undefined ? parseFloat(i.waste_factor) : 0,
      is_byproduct: !!i.is_byproduct,
      sort_order: idx,
    }))
    const { error: itemsErr } = await supabase.from('bom_items').insert(itemRows)
    if (itemsErr) throw itemsErr

    if (operations.length > 0) {
      const opRows = operations.map((o, idx) => ({
        tenant_id: tid,
        bom_id: bom.id,
        work_center_id: o.work_center_id ? parseInt(o.work_center_id, 10) : null,
        sequence: o.sequence != null ? parseInt(o.sequence, 10) : idx + 1,
        name: String(o.name || `Step ${idx + 1}`),
        expected_minutes: o.expected_minutes !== undefined ? parseFloat(o.expected_minutes) : 0,
        description: o.description || null,
      }))
      const { error: opsErr } = await supabase.from('bom_operations').insert(opRows)
      if (opsErr) throw opsErr
    }

    req.logActivity?.({
      action: 'created',
      entity_type: 'bill_of_materials',
      entity_id: bom.id,
      entity_name: product.name,
    })

    const { items: newItems, operations: newOps } = await fetchParts(bom.id, tid)
    res.status(201).json({ ...bom, items: newItems, operations: newOps })
  } catch (err) {
    next(err)
  }
})

// Update header and/or replace components + routings wholesale
router.put('/:id', [
  body('output_quantity').optional().isFloat({ gt: 0 }).withMessage('output_quantity must be > 0'),
  body('status').optional().isIn(['draft', 'active', 'archived']).withMessage('Invalid status'),
  body('items').optional().isArray({ min: 1 }).withMessage('items must be a non-empty array'),
  body('items.*.product_id').isInt({ gt: 0 }).withMessage('Each item needs a product_id'),
  body('items.*.quantity').isFloat({ gt: 0 }).withMessage('Each item quantity must be > 0'),
], validate, async (req, res, next) => {
  try {
    const tid = req.user?.tenantId
    const bom = await loadBom(req, res)
    if (!bom) return

    const patch = { updated_at: new Date().toISOString() }
    if (req.body.output_quantity !== undefined) patch.output_quantity = parseFloat(req.body.output_quantity)
    if (req.body.status !== undefined) patch.status = req.body.status
    if (req.body.notes !== undefined) patch.notes = req.body.notes

    const { error } = await supabase
      .from('bills_of_materials')
      .update(patch)
      .eq('id', bom.id)
      .eq('tenant_id', tid)
    if (error) {
      if (isUniqueViolation(error)) {
        return res.status(409).json({
          error: 'This product already has an active BOM — archive it first or edit the existing one',
          code: 'BOM_ACTIVE_EXISTS',
        })
      }
      throw error
    }

    // Wholesale replacement keeps the payload simple and matches how the
    // editor submits (the MO freeze means existing orders are unaffected).
    if (Array.isArray(req.body.items)) {
      const inputs = req.body.items.filter((i) => !i.is_byproduct)
      if (inputs.length === 0) {
        return res.status(400).json({ error: 'A BOM needs at least one component input', code: 'BOM_NO_INPUTS' })
      }
      const { error: delErr } = await supabase
        .from('bom_items')
        .delete()
        .eq('bom_id', bom.id)
        .eq('tenant_id', tid)
      if (delErr) throw delErr
      const itemRows = req.body.items.map((i, idx) => ({
        tenant_id: tid,
        bom_id: bom.id,
        product_id: parseInt(i.product_id, 10),
        quantity: parseFloat(i.quantity),
        waste_factor: i.waste_factor !== undefined ? parseFloat(i.waste_factor) : 0,
        is_byproduct: !!i.is_byproduct,
        sort_order: idx,
      }))
      const { error: insErr } = await supabase.from('bom_items').insert(itemRows)
      if (insErr) throw insErr
    }

    if (Array.isArray(req.body.operations)) {
      const { error: delErr } = await supabase
        .from('bom_operations')
        .delete()
        .eq('bom_id', bom.id)
        .eq('tenant_id', tid)
      if (delErr) throw delErr
      if (req.body.operations.length > 0) {
        const opRows = req.body.operations.map((o, idx) => ({
          tenant_id: tid,
          bom_id: bom.id,
          work_center_id: o.work_center_id ? parseInt(o.work_center_id, 10) : null,
          sequence: o.sequence != null ? parseInt(o.sequence, 10) : idx + 1,
          name: String(o.name || `Step ${idx + 1}`),
          expected_minutes: o.expected_minutes !== undefined ? parseFloat(o.expected_minutes) : 0,
          description: o.description || null,
        }))
        const { error: insErr } = await supabase.from('bom_operations').insert(opRows)
        if (insErr) throw insErr
      }
    }

    req.logActivity?.({
      action: 'updated',
      entity_type: 'bill_of_materials',
      entity_id: bom.id,
      entity_name: bom.products?.name || `BOM #${bom.id}`,
    })

    const { items, operations } = await fetchParts(bom.id, tid)
    const { data: refreshed } = await supabase
      .from('bills_of_materials')
      .select(ORDER_DETAIL_SELECT)
      .eq('id', bom.id)
      .eq('tenant_id', tid)
      .single()
    res.json({ ...(refreshed || bom), items, operations })
  } catch (err) {
    next(err)
  }
})

// Delete — blocked while any production order references it (archive
// instead; history must keep its recipe).
router.delete('/:id', async (req, res, next) => {
  try {
    const tid = req.user?.tenantId
    const bom = await loadBom(req, res)
    if (!bom) return

    const { count, error: countErr } = await supabase
      .from('production_orders')
      .select('id', { count: 'exact', head: true })
      .eq('bom_id', bom.id)
      .eq('tenant_id', tid)
    if (countErr) throw countErr
    if ((count || 0) > 0) {
      return res.status(409).json({
        error: 'This BOM is used by production orders — archive it instead of deleting',
        code: 'BOM_IN_USE',
      })
    }

    const { error } = await supabase
      .from('bills_of_materials')
      .delete()
      .eq('id', bom.id)
      .eq('tenant_id', tid)
    if (error) throw error

    req.logActivity?.({
      action: 'deleted',
      entity_type: 'bill_of_materials',
      entity_id: bom.id,
      entity_name: bom.products?.name || `BOM #${bom.id}`,
    })

    res.json({ ok: true, id: bom.id })
  } catch (err) {
    next(err)
  }
})

export default router
