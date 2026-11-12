import { Router } from 'express'
import { body, param, validationResult } from 'express-validator'
import supabase from '../db/supabase.js'
import { authenticateToken, requirePermission } from '../middleware/auth.js'
import { checkTenantLimits } from '../middleware/limits.js'

const router = Router()

const validate = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg })
  }
  next()
}

// Get all services
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('services')
      .select('*')
      .eq('tenant_id', req.user?.tenantId)
      .order('created_at', { ascending: false })
    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get single service
router.get('/:id', [
  param('id').isNumeric().withMessage('Invalid service ID'),
], validate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('services')
      .select('*')
      .eq('id', req.params.id)
      .eq('tenant_id', req.user?.tenantId)
      .single()
    if (error || !data) return res.status(404).json({ error: 'Service not found' })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Create service
router.post('/', authenticateToken, requirePermission('services_edit'), checkTenantLimits('services'), [
  body('name').trim().notEmpty().withMessage('Service name is required'),
  body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('service_type').optional().isIn(['maintenance', 'warranty', 'subscription', 'custom']),
], validate, async (req, res) => {
  try {
    const { name, name_ar, description, price, service_type } = req.body
    const { data, error } = await supabase
      .from('services')
      .insert({ tenant_id: req.user?.tenantId, name, name_ar, description, price, service_type })
      .select()
      .single()
    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Update service
router.put('/:id', authenticateToken, requirePermission('services_edit'), [
  param('id').isNumeric().withMessage('Invalid service ID'),
  body('name').optional().trim().notEmpty(),
  body('price').optional().isFloat({ min: 0 }),
], validate, async (req, res) => {
  try {
    const { name, name_ar, description, price, service_type, is_active } = req.body
    const updateData = { updated_at: new Date().toISOString() }
    if (name !== undefined) updateData.name = name
    if (name_ar !== undefined) updateData.name_ar = name_ar
    if (description !== undefined) updateData.description = description
    if (price !== undefined) updateData.price = price
    if (service_type !== undefined) updateData.service_type = service_type
    if (is_active !== undefined) updateData.is_active = is_active

    const { data, error } = await supabase
      .from('services')
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

// Delete service
router.delete('/:id', authenticateToken, requirePermission('services_edit'), [
  param('id').isNumeric().withMessage('Invalid service ID'),
], validate, async (req, res) => {
  try {
    // Same guard as plans: subscriptions point here with ON DELETE SET
    // NULL, so deleting a referenced service would blank its history.
    const { data: refs } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('tenant_id', req.user?.tenantId)
      .eq('service_id', req.params.id)
    if (refs && refs.length > 0) {
      return res.status(409).json({
        error: `Service is used by ${refs.length} subscription(s) — deactivate it instead`,
        subscription_count: refs.length,
      })
    }

    const { error } = await supabase
      .from('services')
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
