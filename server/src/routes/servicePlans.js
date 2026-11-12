import { Router } from 'express'
import { body, param, validationResult } from 'express-validator'
import supabase from '../db/supabase.js'
import { authenticateToken, requirePermission } from '../middleware/auth.js'

const router = Router()

const validate = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg })
  }
  next()
}

// Get all plans
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('service_plans')
      .select('*')
      .eq('tenant_id', req.user?.tenantId)
      .order('created_at', { ascending: false })
    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get single plan
router.get('/:id', [
  param('id').isNumeric().withMessage('Invalid plan ID'),
], validate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('service_plans')
      .select('*')
      .eq('id', req.params.id)
      .eq('tenant_id', req.user?.tenantId)
      .single()
    if (error || !data) return res.status(404).json({ error: 'Plan not found' })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Create plan
router.post('/', authenticateToken, requirePermission('services_edit'), [
  body('name').trim().notEmpty().withMessage('Plan name is required'),
  body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('billing_cycle').optional().isIn(['monthly', 'annual', 'one_time']),
], validate, async (req, res) => {
  try {
    const { name, name_ar, description, price, billing_cycle, duration_months, features } = req.body
    const { data, error } = await supabase
      .from('service_plans')
      .insert({ tenant_id: req.user?.tenantId, name, name_ar, description, price, billing_cycle, duration_months, features })
      .select()
      .single()
    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Update plan
router.put('/:id', authenticateToken, requirePermission('services_edit'), [
  param('id').isNumeric().withMessage('Invalid plan ID'),
  body('name').optional().trim().notEmpty(),
  body('price').optional().isFloat({ min: 0 }),
], validate, async (req, res) => {
  try {
    const { name, name_ar, description, price, billing_cycle, duration_months, features, is_active } = req.body
    const updateData = { updated_at: new Date().toISOString() }
    if (name !== undefined) updateData.name = name
    if (name_ar !== undefined) updateData.name_ar = name_ar
    if (description !== undefined) updateData.description = description
    if (price !== undefined) updateData.price = price
    if (billing_cycle !== undefined) updateData.billing_cycle = billing_cycle
    if (duration_months !== undefined) updateData.duration_months = duration_months
    if (features !== undefined) updateData.features = features
    if (is_active !== undefined) updateData.is_active = is_active

    const { data, error } = await supabase
      .from('service_plans')
      .update(updateData)
      .eq('id', req.params.id)
      .eq('tenant_id', req.user?.tenantId)
      .select()
      .single()
    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Delete plan
router.delete('/:id', authenticateToken, requirePermission('services_edit'), [
  param('id').isNumeric().withMessage('Invalid plan ID'),
], validate, async (req, res) => {
  try {
    // Subscriptions reference plans with ON DELETE SET NULL — deleting a
    // used plan would silently blank every row that pointed at it (the
    // subscriptions table just shows '-'). Block instead; is_active=false
    // is the sanctioned alternative that keeps history intact.
    const { data: refs } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('tenant_id', req.user?.tenantId)
      .eq('plan_id', req.params.id)
    if (refs && refs.length > 0) {
      return res.status(409).json({
        error: `Plan is used by ${refs.length} subscription(s) — deactivate it instead`,
        subscription_count: refs.length,
      })
    }

    const { error } = await supabase
      .from('service_plans')
      .delete()
      .eq('id', req.params.id)
      .eq('tenant_id', req.user?.tenantId)
    if (error) throw error
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
