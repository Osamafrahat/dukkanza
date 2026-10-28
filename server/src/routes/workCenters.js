import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import supabase from '../db/supabase.js'

// Work centers — machines/stations with an hourly cost. Routings
// (bom_operations.work_center_id) reference them with ON DELETE RESTRICT,
// so the DB backstops the usage check below; work_orders reference them
// ON DELETE SET NULL (a deleted center must not erase run history).

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

const isUniqueViolation = (err) => err?.code === '23505'

// List work centers (active first, then name)
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('work_centers')
      .select('*')
      .eq('tenant_id', req.user?.tenantId)
      .order('is_active', { ascending: false })
      .order('name', { ascending: true })
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    next(err)
  }
})

// Create
router.post('/', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('cost_per_hour').optional().isFloat({ gte: 0 }).withMessage('cost_per_hour must be >= 0'),
  body('time_efficiency').optional().isFloat({ gt: 0 }).withMessage('time_efficiency must be > 0'),
], validate, async (req, res, next) => {
  try {
    const tid = req.user?.tenantId
    const { name, cost_per_hour = 0, time_efficiency = 100, description = null } = req.body

    const { data, error } = await supabase
      .from('work_centers')
      .insert({
        tenant_id: tid,
        name: String(name).trim(),
        cost_per_hour: parseFloat(cost_per_hour) || 0,
        time_efficiency: parseFloat(time_efficiency) || 100,
        description,
      })
      .select()
      .single()
    if (error) {
      if (isUniqueViolation(error)) {
        return res.status(409).json({ error: 'A work center with this name already exists', code: 'WC_NAME_EXISTS' })
      }
      throw error
    }

    req.logActivity?.({
      action: 'created',
      entity_type: 'work_center',
      entity_id: data.id,
      entity_name: data.name,
    })
    res.status(201).json(data)
  } catch (err) {
    next(err)
  }
})

// Update
router.put('/:id', [
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
  body('cost_per_hour').optional().isFloat({ gte: 0 }).withMessage('cost_per_hour must be >= 0'),
  body('time_efficiency').optional().isFloat({ gt: 0 }).withMessage('time_efficiency must be > 0'),
], validate, async (req, res, next) => {
  try {
    const tid = req.user?.tenantId
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ error: 'Invalid work center id' })

    const patch = { updated_at: new Date().toISOString() }
    if (req.body.name !== undefined) patch.name = String(req.body.name).trim()
    if (req.body.cost_per_hour !== undefined) patch.cost_per_hour = parseFloat(req.body.cost_per_hour)
    if (req.body.time_efficiency !== undefined) patch.time_efficiency = parseFloat(req.body.time_efficiency)
    if (req.body.description !== undefined) patch.description = req.body.description
    if (req.body.is_active !== undefined) patch.is_active = !!req.body.is_active

    const { data, error } = await supabase
      .from('work_centers')
      .update(patch)
      .eq('id', id)
      .eq('tenant_id', tid)
      .select()
      .maybeSingle()
    if (error) {
      if (isUniqueViolation(error)) {
        return res.status(409).json({ error: 'A work center with this name already exists', code: 'WC_NAME_EXISTS' })
      }
      throw error
    }
    if (!data) return res.status(404).json({ error: 'Work center not found' })

    req.logActivity?.({
      action: 'updated',
      entity_type: 'work_center',
      entity_id: id,
      entity_name: data.name,
    })
    res.json(data)
  } catch (err) {
    next(err)
  }
})

// Delete — blocked while routings or runs reference it
router.delete('/:id', async (req, res, next) => {
  try {
    const tid = req.user?.tenantId
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ error: 'Invalid work center id' })

    const { data: wc, error: wcErr } = await supabase
      .from('work_centers')
      .select('id, name')
      .eq('id', id)
      .eq('tenant_id', tid)
      .maybeSingle()
    if (wcErr) throw wcErr
    if (!wc) return res.status(404).json({ error: 'Work center not found' })

    const [routingRes, runRes] = await Promise.all([
      supabase
        .from('bom_operations')
        .select('id', { count: 'exact', head: true })
        .eq('work_center_id', id)
        .eq('tenant_id', tid),
      supabase
        .from('work_orders')
        .select('id', { count: 'exact', head: true })
        .eq('work_center_id', id)
        .eq('tenant_id', tid),
    ])
    if (routingRes.error) throw routingRes.error
    if (runRes.error) throw runRes.error

    const routings = routingRes.count || 0
    const runs = runRes.count || 0
    if (routings > 0 || runs > 0) {
      return res.status(409).json({
        error: `Work center is in use (${routings} routing step${routings === 1 ? '' : 's'}, ${runs} run${runs === 1 ? '' : 's'}) — deactivate it instead`,
        code: 'WC_IN_USE',
        usage: { routings, runs },
      })
    }

    const { error } = await supabase
      .from('work_centers')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tid)
    if (error) {
      if (isUniqueViolation(error)) return res.status(409).json({ error: 'Work center is still referenced', code: 'WC_IN_USE' })
      throw error
    }

    req.logActivity?.({
      action: 'deleted',
      entity_type: 'work_center',
      entity_id: id,
      entity_name: wc.name,
    })
    res.json({ ok: true, id })
  } catch (err) {
    next(err)
  }
})

export default router
