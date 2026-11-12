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

// Aggregate for the Suppliers page header: purchase-order value created in
// the last 30 days (cancelled orders excluded). Defined BEFORE /:id so the
// literal path wins over the param route.
router.get('/overview', async (req, res, next) => {
  try {
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
    const { data, error } = await supabase
      .from('purchase_orders')
      .select('total, status')
      .eq('tenant_id', req.user?.tenantId)
      .gte('created_at', since)

    if (error) throw error

    const purchases30d = (data || [])
      .filter((po) => po.status !== 'cancelled')
      .reduce((sum, po) => sum + (parseFloat(po.total) || 0), 0)

    res.json({ purchases_30d: purchases30d })
  } catch (err) {
    next(err)
  }
})

// Get supplier by ID — enriched with everything the detail drawer needs in
// one round trip: AP balance, lifetime stats, AP aging buckets, the
// products they supply, and the most recent POs/payments.
router.get('/:id', [
  param('id').isNumeric().withMessage('Invalid supplier ID'),
], validate, async (req, res, next) => {
  try {
    const tenantId = req.user?.tenantId
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .eq('id', req.params.id)
      .eq('tenant_id', tenantId)
      .single()

    if (error || !data) {
      return res.status(404).json({ error: 'Supplier not found' })
    }

    const [accountRes, posRes, paysRes, prodsRes] = await Promise.all([
      data.account_code
        ? supabase.from('accounts').select('id, balance').eq('code', data.account_code).eq('tenant_id', tenantId).single()
        : Promise.resolve({ data: null }),
      supabase.from('purchase_orders')
        .select('id, order_number, status, total, expected_date, received_date, created_at')
        .eq('tenant_id', tenantId).eq('supplier_id', data.id)
        .order('created_at', { ascending: false }),
      supabase.from('payments')
        .select('id, payment_number, payment_type, method, amount, payment_date')
        .eq('tenant_id', tenantId).eq('partner_type', 'supplier').eq('partner_id', data.id)
        .order('payment_date', { ascending: false }),
      supabase.from('products')
        .select('id, name, sku, price, cost_price, stock_quantity, is_active')
        .eq('tenant_id', tenantId).eq('supplier_id', data.id)
        .order('name').limit(100),
    ])

    const balance = parseFloat(accountRes?.data?.balance) || 0
    const pos = posRes.data || []
    const pays = paysRes.data || []
    // The list is newest-first; cancelled orders are not purchases.
    const billed = pos.filter((po) => po.status !== 'cancelled')

    const stats = {
      po_count: billed.length,
      total_purchased: billed.reduce((sum, po) => sum + (parseFloat(po.total) || 0), 0),
      last_po_date: billed[0]?.created_at || null,
      payment_count: pays.length,
      total_paid: pays.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0),
    }

    // AP aging: walk this supplier's payable account journal oldest-first —
    // credits are bills (PO receives), debits are payments consumed FIFO
    // against the oldest bill. Whatever survives is an open bill, bucketed
    // by age. Liability balances are credit-positive (see accountingEngine),
    // which is exactly the sign convention this walk assumes.
    let aging = null
    if (accountRes?.data?.id) {
      const { data: lines } = await supabase
        .from('journal_entry_lines')
        .select('id, entry_id, debit, credit')
        .eq('tenant_id', tenantId)
        .eq('account_id', accountRes.data.id)
        .order('id')

      if (lines && lines.length > 0) {
        const entryIds = [...new Set(lines.map((l) => l.entry_id))]
        const { data: entries } = await supabase
          .from('journal_entries')
          .select('id, date')
          .eq('tenant_id', tenantId)
          .in('id', entryIds)

        const dateById = new Map((entries || []).map((e) => [e.id, e.date]))
        const today = new Date().toISOString().slice(0, 10)
        const ordered = [...lines].sort((a, b) => {
          const da = dateById.get(a.entry_id) || today
          const db = dateById.get(b.entry_id) || today
          return da < db ? -1 : da > db ? 1 : a.id - b.id
        })

        const open = []
        for (const line of ordered) {
          const credit = parseFloat(line.credit) || 0
          const debit = parseFloat(line.debit) || 0
          if (credit > 0) open.push({ amount: credit, date: dateById.get(line.entry_id) || today })
          if (debit > 0) {
            let left = debit
            while (left > 0.005 && open.length > 0) {
              const head = open[0]
              const applied = Math.min(head.amount, left)
              head.amount -= applied
              left -= applied
              if (head.amount <= 0.005) open.shift()
            }
            // Leftover debit = payment bigger than every open bill; the
            // account balance already reflects it, nothing open to age.
          }
        }

        const buckets = { current: 0, d30: 0, d60: 0 }
        for (const bill of open) {
          const age = Math.floor((Date.parse(today) - Date.parse(bill.date)) / 86400000)
          if (age <= 30) buckets.current += bill.amount
          else if (age <= 60) buckets.d30 += bill.amount
          else buckets.d60 += bill.amount
        }
        aging = { ...buckets, total: buckets.current + buckets.d30 + buckets.d60 }
      } else {
        aging = { current: 0, d30: 0, d60: 0, total: 0 }
      }
    }

    res.json({
      ...data,
      balance,
      stats,
      aging,
      products: prodsRes.data || [],
      recent_pos: pos.slice(0, 10),
      recent_payments: pays.slice(0, 10),
    })
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
