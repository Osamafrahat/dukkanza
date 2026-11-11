import { Router } from 'express'
import { body, param, validationResult } from 'express-validator'
import supabase from '../db/supabase.js'
import { authenticateToken, requirePermission } from '../middleware/auth.js'
import { sanitizeSearch } from '../helpers/search.js'
import { cleanText, cleanPhone } from '../helpers/importClean.js'

const router = Router()

const validate = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg })
  }
  next()
}

// Get all customers
router.get('/', async (req, res, next) => {
  try {
    const { search } = req.query
    let query = supabase
      .from('customers')
      .select('*')
      .eq('tenant_id', req.user.tenantId)
      .eq('is_active', true)
      .order('name')

    if (search) {
      const s = sanitizeSearch(search)
      if (s) query = query.or(`name.ilike.%${s}%,phone.ilike.%${s}%`)
    }

    const { data, error } = await query
    if (error) throw error
    res.json(data)
  } catch (err) {
    next(err)
  }
})

// Get customer by ID
router.get('/:id', [
  param('id').isNumeric().withMessage('Invalid customer ID'),
], validate, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .eq('tenant_id', req.user.tenantId)
      .eq('id', req.params.id)
      .single()

    if (error || !data) {
      return res.status(404).json({ error: 'Customer not found' })
    }

    res.json(data)
  } catch (err) {
    next(err)
  }
})

// Create customer
router.post('/', authenticateToken, requirePermission('customers_edit'), [
  body('name').trim().notEmpty().withMessage('Customer name is required'),
], validate, async (req, res, next) => {
  try {
    const { name, phone, email, address, notes } = req.body

    // Check if phone number already exists per tenant
    if (phone) {
      const { data: existing } = await supabase
        .from('customers')
        .select('id, name')
        .eq('tenant_id', req.user.tenantId)
        .eq('phone', phone)
        .eq('is_active', true)
        .limit(1)

      if (existing && existing.length > 0) {
        return res.status(400).json({
          error: `This phone number is already registered to: ${existing[0].name}`
        })
      }
    }

    const { data, error } = await supabase
      .from('customers')
      .insert({
        tenant_id: req.user.tenantId,
        name,
        phone: phone || null,
        email: email || null,
        address: address || null,
        notes: notes || null
      })
      .select()
      .single()

    if (error) throw error

    // Auto-assign account_code for per-customer AR tracking
    const accountCode = `1030-C${data.id}`
    await supabase
      .from('customers')
      .update({ account_code: accountCode })
      .eq('tenant_id', req.user.tenantId)
      .eq('id', data.id)

    data.account_code = accountCode

    req.logActivity({ action: 'created', entity_type: 'customer', entity_name: data.name })
    res.status(201).json(data)
  } catch (err) {
    next(err)
  }
})

// Bulk CSV import (upsert: phone first, then name). Same per-row report
// contract as POST /products/import — see that route for why the batch
// carries its own report instead of failing wholesale. Customers have no
// plan cap, so there is no headroom to compute here.
//
// The phone match mirrors this file's uniqueness rule (one active
// customer per phone); the name match only exists for legacy exports
// whose rows have no phone column at all, and is disabled for names this
// same file already used so two distinct people called "Ahmed" stay two
// rows instead of collapsing into one.
router.post('/import', authenticateToken, requirePermission('customers_edit'), [
  body('items').isArray({ min: 1 }).withMessage('items must be a non-empty array'),
  body('items').isArray({ max: 5000 }).withMessage('Too many rows (max 5000 per import)'),
], validate, async (req, res, next) => {
  try {
    const tenantId = req.user.tenantId
    const items = req.body.items
    const errors = []
    let created = 0
    let updated = 0

    const { data: existing, error: listErr } = await supabase
      .from('customers')
      .select('id, name, phone, email, address, notes')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
    if (listErr) throw listErr
    const byPhone = new Map()
    const byName = new Map()
    for (const c of existing || []) {
      const phoneKey = cleanPhone(c.phone)
      if (phoneKey) byPhone.set(phoneKey, c)
      const nameKey = cleanText(c.name).toLowerCase()
      // First row wins a duplicate name in the table (legacy data can
      // already contain them) — matching must stay deterministic.
      if (nameKey && !byName.has(nameKey)) byName.set(nameKey, c)
    }

    const seenPhones = new Set()
    const seenNames = new Set()

    for (let i = 0; i < items.length; i++) {
      const row = items[i] && typeof items[i] === 'object' ? items[i] : {}
      const rowNo = Number.isInteger(row._row) && row._row > 0 ? row._row : i + 1
      try {
        const name = cleanText(row.name)
        if (!name) { errors.push({ row: rowNo, error: 'name_required' }); continue }
        const nameKey = name.toLowerCase()
        const phone = 'phone' in row ? cleanPhone(row.phone) : ''
        if (phone && seenPhones.has(phone)) { errors.push({ row: rowNo, error: 'phone_in_file_dup' }); continue }
        // A phoneless row has only its name to stand on: the same name
        // twice within one file with nothing to tell the rows apart is the
        // earlier row repeated, not a second customer.
        if (!phone && seenNames.has(nameKey)) { errors.push({ row: rowNo, error: 'name_in_file_dup' }); continue }

        const phoneMatch = phone ? byPhone.get(phone) || null : null
        const nameMatch = seenNames.has(nameKey) ? null : byName.get(nameKey) || null
        // Both keys hit DIFFERENT customers: the row's name says one thing
        // and its phone says another. Updating either one would steal the
        // other's identity (and phones are unique per active customer), so
        // report the ambiguity instead of guessing.
        if (phoneMatch && nameMatch && phoneMatch.id !== nameMatch.id) {
          errors.push({ row: rowNo, error: 'phone_conflict' }); continue
        }
        const match = phoneMatch || nameMatch

        if (phone) seenPhones.add(phone)
        seenNames.add(nameKey)

        if (match) {
          // Only mapped columns are sent, so '' here means "the CSV column
          // exists and is empty" — the file is the source of truth and the
          // field is cleared, not left stale.
          const patch = { name, updated_at: new Date().toISOString() }
          if ('phone' in row) patch.phone = phone || null
          if ('email' in row) patch.email = cleanText(row.email) || null
          if ('address' in row) patch.address = String(row.address ?? '').trim() || null
          if ('notes' in row) patch.notes = String(row.notes ?? '').trim() || null
          const { error } = await supabase
            .from('customers')
            .update(patch)
            .eq('tenant_id', tenantId)
            .eq('id', match.id)
          if (error) {
            console.error('[CUSTOMERS] import: update failed:', error.message)
            errors.push({ row: rowNo, error: 'update_failed' })
            continue
          }
          updated++
          continue
        }

        const { data, error } = await supabase
          .from('customers')
          .insert({
            tenant_id: tenantId,
            name,
            phone: phone || null,
            email: 'email' in row ? cleanText(row.email) || null : null,
            address: 'address' in row ? String(row.address ?? '').trim() || null : null,
            notes: 'notes' in row ? String(row.notes ?? '').trim() || null : null,
          })
          .select()
          .single()
        if (error || !data) {
          console.error('[CUSTOMERS] import: insert failed:', error?.message)
          errors.push({ row: rowNo, error: 'insert_failed' })
          continue
        }
        created++
        // Per-customer AR tracking, same account_code shape single-create
        // assigns (1030-C<id>).
        const accountCode = `1030-C${data.id}`
        await supabase
          .from('customers')
          .update({ account_code: accountCode })
          .eq('tenant_id', tenantId)
          .eq('id', data.id)
        data.account_code = accountCode
      } catch (rowErr) {
        console.error('[CUSTOMERS] import: row failed:', rowErr.message)
        errors.push({ row: rowNo, error: 'insert_failed' })
      }
    }

    if (created || updated) {
      req.logActivity({ action: 'imported', entity_type: 'customer', entity_name: `CSV import: ${created} created, ${updated} updated` })
    }
    res.json({ created, updated, errors })
  } catch (err) {
    next(err)
  }
})

// Update customer
router.put('/:id', authenticateToken, requirePermission('customers_edit'), [
  param('id').isNumeric().withMessage('Invalid customer ID'),
  body('name').trim().notEmpty().withMessage('Customer name is required'),
], validate, async (req, res, next) => {
  try {
    const { name, phone, email, address, notes } = req.body

    // Check if phone number already exists per tenant (excluding current customer)
    if (phone) {
      const { data: existing } = await supabase
        .from('customers')
        .select('id, name')
        .eq('tenant_id', req.user.tenantId)
        .eq('phone', phone)
        .eq('is_active', true)
        .neq('id', req.params.id)
        .limit(1)

      if (existing && existing.length > 0) {
        return res.status(400).json({
          error: `This phone number is already registered to: ${existing[0].name}`
        })
      }
    }

    const { data, error } = await supabase
      .from('customers')
      .update({
        name,
        phone: phone || null,
        email: email || null,
        address: address || null,
        notes: notes || null,
        updated_at: new Date().toISOString()
      })
      .eq('tenant_id', req.user.tenantId)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    req.logActivity({ action: 'updated', entity_type: 'customer', entity_id: req.params.id })
    res.json(data)
  } catch (err) {
    next(err)
  }
})

// Delete customer (soft delete)
router.delete('/:id', authenticateToken, requirePermission('customers_edit'), [
  param('id').isNumeric().withMessage('Invalid customer ID'),
], validate, async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('customers')
      .update({ is_active: false })
      .eq('tenant_id', req.user.tenantId)
      .eq('id', req.params.id)

    if (error) throw error
    req.logActivity({ action: 'deleted', entity_type: 'customer', entity_id: req.params.id })
    res.json({ message: 'Customer deleted successfully' })
  } catch (err) {
    next(err)
  }
})

export default router
