import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import supabase from '../db/supabase.js'
import { adjustStock } from '../services/branchStock.js'
import { resolveBranchParam } from '../services/branches.js'

const router = Router()

const validate = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg })
  }
  next()
}

// Get PO stats
router.get('/stats', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('purchase_orders')
      .select('id, total, status')
      .eq('tenant_id', req.user?.tenantId)

    if (error) throw error

    const orders = data || []
    const totalOrders = orders.length
    const totalValue = orders.reduce((sum, o) => sum + parseFloat(o.total || 0), 0)
    const pendingCount = orders.filter(o => o.status === 'draft' || o.status === 'sent').length
    const receivedCount = orders.filter(o => o.status === 'received').length

    res.json({ total_orders: totalOrders, total_value: totalValue, pending_count: pendingCount, received_count: receivedCount })
  } catch (err) {
    next(err)
  }
})

// Get all purchase orders
router.get('/', async (req, res, next) => {
  try {
    const { status, supplier_id } = req.query

    let query = supabase
      .from('purchase_orders')
      .select('*, suppliers(name, contact_person, email)')
      .eq('tenant_id', req.user?.tenantId)
      .order('created_at', { ascending: false })

    if (status) query = query.eq('status', status)
    if (supplier_id) query = query.eq('supplier_id', supplier_id)

    const { data, error } = await query
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    next(err)
  }
})

// Create purchase order
router.post('/', [
  body('supplier_id').isNumeric().withMessage('Supplier ID is required'),
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
], validate, async (req, res, next) => {
  try {
    const { supplier_id, items, expected_date, notes } = req.body

    // Destination branch: explicit body value, else the active branch.
    const branchCheck = await resolveBranchParam(req.user?.tenantId, req.body.branch_id)
    if (!branchCheck.ok) {
      return res.status(400).json({ error: 'Selected branch does not exist', code: 'BRANCH_INVALID' })
    }
    const destinationBranchId = branchCheck.value || req.branchId || null

    const order_number = `PO-${Date.now()}`

    // Lookup product names from product IDs
    const productIds = items.map(i => i.product_id).filter(Boolean)
    let productNameMap = {}
    if (productIds.length > 0) {
      const { data: prods } = await supabase
        .from('products')
        .select('id, name')
        .in('id', productIds)
        .eq('tenant_id', req.user?.tenantId)
      ;(prods || []).forEach(p => { productNameMap[p.id] = p.name })
    }

    let total = 0
    const processedItems = items.map(item => {
      const quantity = parseFloat(item.quantity)
      const unit_price = parseFloat(item.unit_price)
      const line_total = quantity * unit_price
      total += line_total
      return {
        product_id: item.product_id,
        product_name: productNameMap[item.product_id] || item.product_name || 'Unknown',
        quantity,
        unit_price,
        // Column is `total` in purchase_order_items — `line_total` does not
        // exist and PostgREST rejects the insert (500 on create).
        total: line_total,
        received_quantity: 0,
      }
    })

    const { data: po, error: poError } = await supabase
      .from('purchase_orders')
      .insert({
        tenant_id: req.user?.tenantId,
        branch_id: destinationBranchId,
        supplier_id,
        order_number,
        total,
        expected_date,
        notes,
        status: 'draft',
        created_at: new Date().toISOString(),
      })
      .select('*, suppliers(name, contact_person, email)')
      .single()

    if (poError) throw poError

    const itemsToInsert = processedItems.map(item => ({
      ...item,
      purchase_order_id: po.id,
      tenant_id: req.user?.tenantId,
    }))

    const { error: itemsError } = await supabase
      .from('purchase_order_items')
      .insert(itemsToInsert)

    if (itemsError) {
      // Roll back the header so a failed item insert never leaves an
      // orphaned draft PO behind.
      await supabase.from('purchase_orders').delete().eq('id', po.id)
      throw itemsError
    }

    const { data: itemsData } = await supabase
      .from('purchase_order_items')
      .select('*')
      .eq('purchase_order_id', po.id)
      .eq('tenant_id', req.user?.tenantId)

    res.status(201).json({ ...po, items: itemsData || [] })
  } catch (err) {
    next(err)
  }
})

// Get PO by ID
router.get('/:id', async (req, res, next) => {
  try {
    const { data: po, error: poError } = await supabase
      .from('purchase_orders')
      .select('*, suppliers(name, contact_person, email)')
      .eq('id', req.params.id)
      .eq('tenant_id', req.user?.tenantId)
      .single()

    if (poError || !po) {
      return res.status(404).json({ error: 'Purchase order not found' })
    }

    const { data: items } = await supabase
      .from('purchase_order_items')
      .select('*')
      .eq('purchase_order_id', po.id)
      .eq('tenant_id', req.user?.tenantId)

    res.json({ ...po, items: items || [] })
  } catch (err) {
    next(err)
  }
})

// Update PO
router.put('/:id', async (req, res, next) => {
  try {
    const { status, expected_date, notes, items } = req.body

    const allowedStatuses = ['draft', 'sent', 'received', 'cancelled']
    const updateFields = {}
    if (status !== undefined) {
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}` })
      }
      updateFields.status = status
    }
    if (expected_date !== undefined) updateFields.expected_date = expected_date
    if (notes !== undefined) updateFields.notes = notes
    if ('branch_id' in req.body) {
      const branchCheck = await resolveBranchParam(req.user?.tenantId, req.body.branch_id)
      if (!branchCheck.ok) {
        return res.status(400).json({ error: 'Selected branch does not exist', code: 'BRANCH_INVALID' })
      }
      updateFields.branch_id = branchCheck.value
    }

    if (items && Array.isArray(items)) {
      let total = 0
      for (const item of items) {
        total += parseFloat(item.quantity) * parseFloat(item.unit_price)
      }
      updateFields.total = total

      await supabase
        .from('purchase_order_items')
        .delete()
        .eq('purchase_order_id', req.params.id)
        .eq('tenant_id', req.user?.tenantId)

      const itemsToInsert = items.map(item => ({
        purchase_order_id: req.params.id,
        tenant_id: req.user?.tenantId,
        product_id: item.product_id,
        product_name: item.product_name || 'Unknown',
        quantity: parseFloat(item.quantity),
        unit_price: parseFloat(item.unit_price),
        // Schema column is `total` — `line_total` doesn't exist.
        total: parseFloat(item.quantity) * parseFloat(item.unit_price),
        received_quantity: item.received_quantity || 0,
      }))

      const { error: itemsError } = await supabase
        .from('purchase_order_items')
        .insert(itemsToInsert)
      if (itemsError) throw itemsError
    }

    const { data, error } = await supabase
      .from('purchase_orders')
      .update(updateFields)
      .eq('id', req.params.id)
      .eq('tenant_id', req.user?.tenantId)
      .select('*, suppliers(name, contact_person, email)')
      .single()

    if (error) throw error
    if (!data) {
      return res.status(404).json({ error: 'Purchase order not found' })
    }

    const { data: updatedItems } = await supabase
      .from('purchase_order_items')
      .select('*')
      .eq('purchase_order_id', data.id)
      .eq('tenant_id', req.user?.tenantId)

    res.json({ ...data, items: updatedItems || [] })
  } catch (err) {
    next(err)
  }
})

// Receive PO
router.patch('/:id/receive', async (req, res, next) => {
  try {
    const { data: po, error: poError } = await supabase
      .from('purchase_orders')
      .select('*')
      .eq('id', req.params.id)
      .eq('tenant_id', req.user?.tenantId)
      .single()

    if (poError || !po) {
      return res.status(404).json({ error: 'Purchase order not found' })
    }

    if (po.status === 'received') {
      return res.status(400).json({ error: 'PO already received' })
    }

    const { data: items } = await supabase
      .from('purchase_order_items')
      .select('*')
      .eq('purchase_order_id', po.id)
      .eq('tenant_id', req.user?.tenantId)

    if (items) {
      for (const item of items) {
        const received_qty = item.quantity - (item.received_quantity || 0)
        if (received_qty > 0) {
          await supabase
            .from('purchase_order_items')
            .update({ received_quantity: item.quantity })
            .eq('id', item.id)
            .eq('tenant_id', req.user?.tenantId)

          // Goods land at the PO'S DESTINATION BRANCH (legacy rows were
          // backfilled to the default) — not wherever the receiver happens
          // to be standing. adjustStock keeps the branch row and the total
          // in sync.
          const targetBranchId = po.branch_id || req.branchId || null
          const adjusted = await adjustStock({
            tenantId: req.user?.tenantId,
            branchId: targetBranchId,
            productId: item.product_id,
            delta: received_qty,
          })
          if (adjusted === null) {
            console.error('[PO RECEIVE] stock adjust failed for product', item.product_id)
          }

          await supabase
            .from('stock_movements')
            .insert({
              tenant_id: req.user?.tenantId,
              product_id: item.product_id,
              quantity: received_qty,
              type: 'purchase',
              reference: po.order_number,
              notes: `Received from PO ${po.order_number}`,
              branch_id: targetBranchId,
              created_at: new Date().toISOString(),
            })
        }
      }
    }

    const { data, error } = await supabase
      .from('purchase_orders')
      .update({
        status: 'received',
        received_date: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('tenant_id', req.user?.tenantId)
      .select('*, suppliers(name, contact_person, email)')
      .single()

    if (error) throw error

    const { data: updatedItems } = await supabase
      .from('purchase_order_items')
      .select('*')
      .eq('purchase_order_id', data.id)
      .eq('tenant_id', req.user?.tenantId)

    // Accounting: Debit Inventory (1050), Credit Accounts Payable.
    //
    // The payable must land on THIS SUPPLIER's own account
    // (suppliers.account_code): the Suppliers page derives its "remaining
    // balance" from accounts.balance of exactly that account, and
    // payments.js debits the same account when settling up — so receiving
    // goods and paying the supplier move opposite ends of one figure. The
    // generic 2010 is only the fallback for suppliers with no account
    // assigned, mirroring payments.js.
    try {
      const { createJournalEntry } = await import('../services/accountingEngine.js')
      const tid = req.user?.tenantId

      const inventoryAccount = await supabase
        .from('accounts').select('id').eq('code', '1050').eq('tenant_id', tid).single()

      let apCode = '2010'
      if (po.supplier_id) {
        const { data: supplierRow } = await supabase
          .from('suppliers')
          .select('account_code')
          .eq('id', po.supplier_id)
          .eq('tenant_id', tid)
          .single()
        if (supplierRow?.account_code) apCode = supplierRow.account_code
      }
      const apAccount = await supabase
        .from('accounts').select('id').eq('code', apCode).eq('tenant_id', tid).single()

      // PO items store `unit_price` plus a precomputed `total` — there is no
      // `unit_cost` column. Reading it produced NaN -> 0, so totalCost was
      // always 0 and the guard below skipped this journal every time.
      let totalCost = 0
      for (const item of (updatedItems || [])) {
        const lineTotal = item.total != null
          ? parseFloat(item.total)
          : (parseFloat(item.unit_price) || 0) * (item.quantity || 0)
        totalCost += lineTotal
      }

      if (!(totalCost > 0)) {
        // Never fail the receive over accounting — but never fail SILENTLY
        // either: a dropped journal used to look exactly like "nothing
        // happened to any account".
        console.error('[PO RECEIVE] journal skipped: total', totalCost, 'for', po.order_number)
      } else if (!inventoryAccount.data || !apAccount.data) {
        console.error('[PO RECEIVE] journal skipped: no account 1050 or', apCode, 'for tenant', tid)
      } else {
        const date = new Date().toISOString().split('T')[0]
        const ref = `PO-${po.order_number}`
        const lines = [
          { accountId: inventoryAccount.data.id, debit: totalCost, credit: 0, description: `Inventory received - ${ref}` },
          { accountId: apAccount.data.id, debit: 0, credit: totalCost, description: `AP ${apCode} - ${ref}` },
        ]
        await createJournalEntry({
          date,
          description: `Purchase order received: ${po.order_number}`,
          reference: ref,
          sourceType: 'purchase_order',
          sourceId: data.id,
          lines,
          createdBy: req.user?.id,
        }, tid)
      }
    } catch (accErr) {
      console.error('[PO RECEIVE] Accounting journal failed:', accErr.message)
    }

    res.json({ ...data, items: updatedItems || [] })
  } catch (err) {
    next(err)
  }
})

// Delete PO (only if draft)
router.delete('/:id', async (req, res, next) => {
  try {
    const { data: po } = await supabase
      .from('purchase_orders')
      .select('status')
      .eq('id', req.params.id)
      .eq('tenant_id', req.user?.tenantId)
      .single()

    if (!po) {
      return res.status(404).json({ error: 'Purchase order not found' })
    }

    if (po.status !== 'draft') {
      return res.status(400).json({ error: 'Only draft POs can be deleted' })
    }

    await supabase
      .from('purchase_order_items')
      .delete()
      .eq('purchase_order_id', req.params.id)
      .eq('tenant_id', req.user?.tenantId)

    const { error } = await supabase
      .from('purchase_orders')
      .delete()
      .eq('id', req.params.id)
      .eq('tenant_id', req.user?.tenantId)

    if (error) throw error
    res.json({ message: 'Purchase order deleted' })
  } catch (err) {
    next(err)
  }
})

export default router
