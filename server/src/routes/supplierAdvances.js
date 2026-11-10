import { Router } from 'express'
import { body, query, validationResult } from 'express-validator'
import supabase from '../db/supabase.js'
import {
  listAdvances,
  availableFor,
  recordSupplierAdvance,
  ADVANCE_METHODS,
} from '../services/advanceLedger.js'

const router = Router()

const validate = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg })
  }
  next()
}

// List advances (optionally one supplier) with the available total.
router.get('/', [
  query('supplier_id').optional().isNumeric().withMessage('Invalid supplier ID'),
], validate, async (req, res, next) => {
  try {
    const supplierId = req.query.supplier_id ? Number(req.query.supplier_id) : null
    const data = await listAdvances(req.user.tenantId, supplierId)
    const available = data.reduce((sum, row) => sum + row.available, 0)
    res.json({ data, available })
  } catch (err) {
    next(err)
  }
})

// Record a new advance payment to a supplier.
// Mounted behind requireManager in index.js — this moves money.
router.post('/', [
  body('supplier_id').isNumeric().withMessage('Supplier ID is required'),
  body('amount').isFloat({ gt: 0 }).withMessage('Amount must be greater than 0'),
  body('method').optional().isIn(ADVANCE_METHODS).withMessage('Invalid payment method'),
], validate, async (req, res, next) => {
  try {
    const supplierId = Number(req.body.supplier_id)

    // The supplier must exist in THIS tenant — a valid id from another
    // tenant would otherwise park their advance on your books.
    const { data: supplier, error: supplierError } = await supabase
      .from('suppliers')
      .select('id, name')
      .eq('id', supplierId)
      .eq('tenant_id', req.user.tenantId)
      .single()
    if (supplierError || !supplier) {
      return res.status(404).json({ error: 'Supplier not found' })
    }

    const result = await recordSupplierAdvance({
      tenantId: req.user.tenantId,
      supplierId,
      amount: req.body.amount,
      method: req.body.method || 'cash',
      notes: req.body.notes || null,
      reference: req.body.reference || null,
      paymentDate: req.body.payment_date || null,
      userId: req.user?.id,
    })

    req.logActivity({
      action: 'created',
      entity_type: 'supplier_advance',
      entity_name: `${supplier.name} advance`,
      details: { amount: parseFloat(req.body.amount), method: req.body.method || 'cash' },
    })
    res.status(201).json(result)
  } catch (err) {
    next(err)
  }
})

// Available advance for one supplier — the settlement hint reads this.
router.get('/available/:supplierId', async (req, res, next) => {
  try {
    const available = await availableFor(req.user.tenantId, Number(req.params.supplierId))
    res.json({ available })
  } catch (err) {
    next(err)
  }
})

export default router
