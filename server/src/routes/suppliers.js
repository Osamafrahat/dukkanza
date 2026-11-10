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

// Get all suppliers
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .eq('tenant_id', req.user?.tenantId)
      .order('name')

    if (error) throw error

    // Advance balances (amount - consumed) per supplier. One grouped query
    // for the whole list. Resilient by design: until the
    // add-supplier-advances migration has run, the table does not exist and
    // this fails — every supplier then reports 0 instead of the request
    // blowing up over an enrichment.
    let advanceBySupplier = {}
    try {
      const { data: advanceRows, error: advanceError } = await supabase
        .from('supplier_advances')
        .select('supplier_id, amount, consumed_amount')
        .eq('tenant_id', req.user?.tenantId)
      if (!advanceError) {
        for (const row of advanceRows || []) {
          const available = parseFloat(row.amount) - parseFloat(row.consumed_amount || 0)
          advanceBySupplier[row.supplier_id] = (advanceBySupplier[row.supplier_id] || 0) + available
        }
      }
    } catch {
      advanceBySupplier = {}
    }

    // Enrich with AP balance from accounts table
    const enriched = await Promise.all((data || []).map(async (supplier) => {
      let balance = 0
      if (supplier.account_code) {
        const { data: account } = await supabase
          .from('accounts')
          .select('balance')
          .eq('code', supplier.account_code)
          .eq('tenant_id', req.user?.tenantId)
          .single()
        balance = account?.balance || 0
      }
      return {
        ...supplier,
        balance,
        advance_available: advanceBySupplier[supplier.id] || 0,
      }
    }))

    res.json(enriched)
  } catch (err) {
    next(err)
  }
})

// Get supplier by ID
router.get('/:id', [
  param('id').isNumeric().withMessage('Invalid supplier ID'),
], validate, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .eq('id', req.params.id)
      .eq('tenant_id', req.user?.tenantId)
      .single()

    if (error || !data) {
      return res.status(404).json({ error: 'Supplier not found' })
    }

    res.json(data)
  } catch (err) {
    next(err)
  }
})

// Create supplier
router.post('/', authenticateToken, requirePermission('suppliers_edit'), [
  body('name').trim().notEmpty().withMessage('Supplier name is required'),
], validate, async (req, res, next) => {
  try {
    const { name, contact_person, email, phone, address, notes } = req.body

    // Insert supplier first to get its ID
    const { data, error } = await supabase
      .from('suppliers')
      .insert({
        tenant_id: req.user?.tenantId,
        name,
        contact_person: contact_person || null,
        email: email || null,
        phone: phone || null,
        address: address || null,
        notes: notes || null
      })
      .select()
      .single()

    if (error) throw error

    // Auto-assign account_code for per-supplier AP tracking
    const accountCode = `2010-S${data.id}`
    await supabase
      .from('suppliers')
      .update({ account_code: accountCode })
      .eq('id', data.id)
      .eq('tenant_id', req.user?.tenantId)

    data.account_code = accountCode

    req.logActivity({ action: 'created', entity_type: 'supplier', entity_name: data.name })
    res.status(201).json(data)
  } catch (err) {
    next(err)
  }
})

// Update supplier
router.put('/:id', authenticateToken, requirePermission('suppliers_edit'), [
  param('id').isNumeric().withMessage('Invalid supplier ID'),
  body('name').trim().notEmpty().withMessage('Supplier name is required'),
], validate, async (req, res, next) => {
  try {
    const { name, contact_person, email, phone, address, notes } = req.body

    const { data, error } = await supabase
      .from('suppliers')
      .update({
        name,
        contact_person: contact_person || null,
        email: email || null,
        phone: phone || null,
        address: address || null,
        notes: notes || null
      })
      .eq('id', req.params.id)
      .eq('tenant_id', req.user?.tenantId)
      .select()
      .single()

    if (error) throw error
    req.logActivity({ action: 'updated', entity_type: 'supplier', entity_id: req.params.id })
    res.json(data)
  } catch (err) {
    next(err)
  }
})

// Delete supplier
router.delete('/:id', authenticateToken, requirePermission('suppliers_edit'), [
  param('id').isNumeric().withMessage('Invalid supplier ID'),
], validate, async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('suppliers')
      .delete()
      .eq('id', req.params.id)
      .eq('tenant_id', req.user?.tenantId)

    if (error) throw error
    req.logActivity({ action: 'deleted', entity_type: 'supplier', entity_id: req.params.id })
    res.json({ message: 'Supplier deleted successfully' })
  } catch (err) {
    next(err)
  }
})

export default router
