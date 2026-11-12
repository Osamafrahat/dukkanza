import { Router } from 'express'
import { body, param, validationResult } from 'express-validator'
import supabase from '../db/supabase.js'
import { authenticateToken, requirePermission } from '../middleware/auth.js'
import { cleanText, cleanPhone } from '../helpers/importClean.js'

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

// Bulk CSV import (upsert by name, then phone). Same per-row report
// contract as POST /products/import — see that route for the design.
// Name is the natural identity of a supplier (unlike customers there is
// no phone uniqueness rule here), so a repeated name inside one file is
// reported as a duplicate rather than folded together.
router.post('/import', authenticateToken, requirePermission('suppliers_edit'), [
  body('items').isArray({ min: 1 }).withMessage('items must be a non-empty array'),
  body('items').isArray({ max: 5000 }).withMessage('Too many rows (max 5000 per import)'),
], validate, async (req, res, next) => {
  try {
    const tenantId = req.user?.tenantId
    const items = req.body.items
    const errors = []
    let created = 0
    let updated = 0

    const { data: existing, error: listErr } = await supabase
      .from('suppliers')
      .select('id, name, contact_person, email, phone, address, notes')
      .eq('tenant_id', tenantId)
    if (listErr) throw listErr
    const byName = new Map()
    const byPhone = new Map()
    for (const s of existing || []) {
      const nameKey = cleanText(s.name).toLowerCase()
      if (nameKey && !byName.has(nameKey)) byName.set(nameKey, s)
      const phoneKey = cleanPhone(s.phone)
      if (phoneKey) byPhone.set(phoneKey, s)
    }

    const seenNames = new Set()

    for (let i = 0; i < items.length; i++) {
      const row = items[i] && typeof items[i] === 'object' ? items[i] : {}
      const rowNo = Number.isInteger(row._row) && row._row > 0 ? row._row : i + 1
      try {
        const name = cleanText(row.name)
        if (!name) { errors.push({ row: rowNo, error: 'name_required' }); continue }
        const nameKey = name.toLowerCase()
        if (seenNames.has(nameKey)) { errors.push({ row: rowNo, error: 'name_in_file_dup' }); continue }

        const phone = 'phone' in row ? cleanPhone(row.phone) : ''
        const match = byName.get(nameKey) || (phone ? byPhone.get(phone) || null : null)

        seenNames.add(nameKey)

        if (match) {
          const patch = { name }
          if ('contact_person' in row) patch.contact_person = cleanText(row.contact_person) || null
          if ('email' in row) patch.email = cleanText(row.email) || null
          if ('phone' in row) patch.phone = phone || null
          if ('address' in row) patch.address = String(row.address ?? '').trim() || null
          if ('notes' in row) patch.notes = String(row.notes ?? '').trim() || null
          const { error } = await supabase
            .from('suppliers')
            .update(patch)
            .eq('id', match.id)
            .eq('tenant_id', tenantId)
          if (error) {
            console.error('[SUPPLIERS] import: update failed:', error.message)
            errors.push({ row: rowNo, error: 'update_failed' })
            continue
          }
          updated++
          continue
        }

        const { data, error } = await supabase
          .from('suppliers')
          .insert({
            tenant_id: tenantId,
            name,
            contact_person: 'contact_person' in row ? cleanText(row.contact_person) || null : null,
            email: 'email' in row ? cleanText(row.email) || null : null,
            phone: phone || null,
            address: 'address' in row ? String(row.address ?? '').trim() || null : null,
            notes: 'notes' in row ? String(row.notes ?? '').trim() || null : null,
          })
          .select()
          .single()
        if (error || !data) {
          console.error('[SUPPLIERS] import: insert failed:', error?.message)
          errors.push({ row: rowNo, error: 'insert_failed' })
          continue
        }
        created++
        // Per-supplier AP tracking, same account_code shape single-create
        // assigns (2010-S<id>).
        const accountCode = `2010-S${data.id}`
        await supabase
          .from('suppliers')
          .update({ account_code: accountCode })
          .eq('id', data.id)
          .eq('tenant_id', tenantId)
        data.account_code = accountCode
      } catch (rowErr) {
        console.error('[SUPPLIERS] import: row failed:', rowErr.message)
        errors.push({ row: rowNo, error: 'insert_failed' })
      }
    }

    if (created || updated) {
      req.logActivity({ action: 'imported', entity_type: 'supplier', entity_name: `CSV import: ${created} created, ${updated} updated` })
    }
    res.json({ created, updated, errors })
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
