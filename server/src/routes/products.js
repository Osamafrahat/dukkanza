import { Router } from 'express'
import { body, param, validationResult } from 'express-validator'
import supabase from '../db/supabase.js'
import { authenticateToken, requirePermission } from '../middleware/auth.js'
import { checkTenantLimits } from '../middleware/limits.js'
import { sanitizeSearch } from '../helpers/search.js'
import { cleanText, cleanNum } from '../helpers/importClean.js'
import { adjustStock, overlayBranchStock } from '../services/branchStock.js'
import { resolveLimit, isUnlimited } from '../services/planLimits.js'

const router = Router()

const validate = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg })
  }
  next()
}

// Get all products
router.get('/', async (req, res, next) => {
  try {
    const { category_id, is_active, search, page = 1, limit = 100 } = req.query
    const offset = (page - 1) * limit

    let query = supabase.from('products').select('*, suppliers(name)', { count: 'exact' })
      .eq('tenant_id', req.user?.tenantId)

    if (category_id) {
      query = query.eq('category_id', category_id)
    }
    if (is_active !== undefined) {
      query = query.eq('is_active', is_active === 'true')
    }
    if (search) {
      const s = sanitizeSearch(search)
      if (s) query = query.or(`name.ilike.%${s}%,sku.ilike.%${s}%,barcode.ilike.%${s}%`)
    }

    query = query.order('name').range(offset, offset + parseInt(limit) - 1)

    const { data, error, count } = await query
    if (error) throw error

    // stock_quantity becomes the ACTIVE BRANCH's quantity; a product with
    // no stock row at this branch shows 0 (this branch holds none).
    await overlayBranchStock(data, req.user?.tenantId, req.branchId)

    res.json({ data, total: count, page: parseInt(page), limit: parseInt(limit) })
  } catch (err) {
    next(err)
  }
})

// Get product by ID
router.get('/:id', [
  param('id').isNumeric().withMessage('Invalid product ID'),
], validate, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', req.params.id)
      .eq('tenant_id', req.user?.tenantId)
      .single()

    if (error || !data) {
      return res.status(404).json({ error: 'Product not found' })
    }

    await overlayBranchStock([data], req.user?.tenantId, req.branchId)

    res.json(data)
  } catch (err) {
    next(err)
  }
})

// Get product by barcode
router.get('/barcode/:barcode', [
  param('barcode').trim().notEmpty().withMessage('Barcode is required'),
], validate, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('barcode', req.params.barcode)
      .eq('tenant_id', req.user?.tenantId)
      .single()

    if (error || !data) {
      return res.status(404).json({ error: 'Product not found' })
    }

    await overlayBranchStock([data], req.user?.tenantId, req.branchId)

    res.json(data)
  } catch (err) {
    next(err)
  }
})

// Create product
router.post('/', authenticateToken, requirePermission('inventory_edit'), checkTenantLimits('products'), [
  body('name').trim().notEmpty().withMessage('Product name is required')
    .isLength({ max: 255 }).withMessage('Name too long'),
  body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('sku').optional().trim().isLength({ max: 50 }),
  body('barcode').optional().trim().isLength({ max: 100 }),
  body('stock_quantity').optional().isFloat({ min: 0 }).withMessage('Stock must be non-negative'),
  body('low_stock_threshold').optional().isInt({ min: 0 }),
  body('cost_price').optional().isFloat({ min: 0 }),
], validate, async (req, res, next) => {
  try {
    const { name, sku, barcode, category_id, supplier_id, price, cost_price,
            stock_quantity, low_stock_threshold, is_refundable, unit_of_measure, pieces_per_box, image_url, specifications, commission_rate } = req.body
    const initialStock = parseFloat(stock_quantity) || 0

    // Check for duplicate SKU
    if (sku) {
      const { data: existing } = await supabase
        .from('products')
        .select('id')
        .eq('sku', sku)
        .eq('tenant_id', req.user?.tenantId)
        .single()
      if (existing) {
        return res.status(409).json({ error: 'SKU already exists' })
      }
    }

    // Check for duplicate barcode
    if (barcode) {
      const { data: existing } = await supabase
        .from('products')
        .select('id')
        .eq('barcode', barcode)
        .eq('tenant_id', req.user?.tenantId)
        .single()
      if (existing) {
        return res.status(409).json({ error: 'Barcode already exists' })
      }
    }

    // Validate cost price vs selling price
    if (cost_price !== undefined && cost_price !== null && parseFloat(cost_price) > parseFloat(price)) {
      return res.status(400).json({ error: 'Cost price cannot exceed selling price' })
    }

    const { data, error } = await supabase
      .from('products')
      .insert({
        tenant_id: req.user?.tenantId,
        name,
        sku: sku || null,
        barcode: barcode || null,
        category_id: category_id || null,
        supplier_id: supplier_id || null,
        price,
        cost_price: cost_price || 0,
        // Seeded to 0: initial stock is applied through adjustStock below,
        // which creates the product_stock row AND recomputes the total —
        // writing stock_quantity directly here would break
        // total = sum(branches) from day one.
        stock_quantity: 0,
        low_stock_threshold: low_stock_threshold || 10,
        is_refundable: is_refundable !== false,
        unit_of_measure: unit_of_measure || 'quantity',
        pieces_per_box: unit_of_measure === 'box' ? (pieces_per_box || null) : null,
        image_url: image_url || null,
        specifications: specifications || [],
        commission_rate: commission_rate || 0
      })
      .select()
      .single()

    if (error) throw error

    // Seed initial stock at the ACTIVE BRANCH (RPC keeps row + total in
    // sync); on failure the product stays at 0 — loudly logged, retryable.
    if (initialStock > 0) {
      const adjusted = await adjustStock({
        tenantId: req.user?.tenantId,
        branchId: req.branchId,
        productId: data.id,
        delta: initialStock,
      })
      if (adjusted !== null) data.stock_quantity = adjusted
      else console.error('[PRODUCTS] initial stock seed failed for product', data.id)
    }

    req.logActivity({ action: 'created', entity_type: 'product', entity_name: data.name })

    // Auto-post journal if initial stock with supplier (AP liability)
    if (data.stock_quantity > 0 && data.cost_price > 0 && data.supplier_id) {
      try {
        const { postStockReceiveJournal } = await import('../services/accountingEngine.js')
        const movement = { id: data.id, quantity: data.stock_quantity }
        const { data: supp } = await supabase.from('suppliers').select('id, name, account_code').eq('id', data.supplier_id).eq('tenant_id', req.user?.tenantId).single()
        await postStockReceiveJournal(movement, { name: data.name, cost_price: data.cost_price }, supp, req.user?.tenantId)
      } catch (accErr) {
        console.error('Accounting auto-post (product create) failed:', accErr.message)
      }
    }

    res.status(201).json(data)
  } catch (err) {
    next(err)
  }
})

// Bulk CSV import (upsert). One request for the whole file with a
// per-row report, instead of one browser round-trip per row.
//
// Match keys: SKU first, then barcode — a row hitting either updates that
// product; anything else is created. Identity columns are match keys only,
// never rewrite targets (writing another row's SKU here would collide with
// the unique checks the single-create route performs).
//
// Deliberately NOT behind checkTenantLimits: that middleware 403s the
// whole batch the moment the tenant sits at its product cap — which would
// also block a pure-update import. Headroom for NEW rows is computed once
// below and rows past the cap report limit_reached, so a partial import
// is explicit instead of fatal.
router.post('/import', authenticateToken, requirePermission('inventory_edit'), [
  body('items').isArray({ min: 1 }).withMessage('items must be a non-empty array'),
  body('items').isArray({ max: 2000 }).withMessage('Too many rows (max 2000 per import)'),
], validate, async (req, res, next) => {
  try {
    const tenantId = req.user?.tenantId
    const items = req.body.items
    const errors = []
    let created = 0
    let updated = 0
    let categoriesCreated = 0
    let suppliersCreated = 0

    // Headroom for NEW rows only. Mirrors limits.js fail-open semantics:
    // if the cap cannot be read, import anyway rather than drop data.
    let headroom = Infinity
    try {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('subscription_tier, max_products')
        .eq('id', tenantId)
        .single()
      const counted = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
      if (!counted.error) {
        const limit = resolveLimit('products', tenant?.subscription_tier || 'free', tenant?.max_products)
        if (!isUnlimited(limit)) {
          headroom = Math.max(0, Number(limit) - (counted.count || 0))
        }
      }
    } catch (capErr) {
      console.error('[PRODUCTS] import: plan cap lookup failed, continuing uncapped:', capErr.message)
    }

    const { data: existingProducts, error: listErr } = await supabase
      .from('products')
      .select('id, name, sku, barcode, stock_quantity')
      .eq('tenant_id', tenantId)
    if (listErr) throw listErr
    const bySku = new Map()
    const byBarcode = new Map()
    const rememberProduct = (p) => {
      if (p.sku) bySku.set(p.sku.trim().toLowerCase(), p)
      if (p.barcode) byBarcode.set(p.barcode.trim(), p)
    }
    for (const p of existingProducts || []) rememberProduct(p)

    const { data: existingCategories, error: catErr } = await supabase
      .from('categories')
      .select('id, name')
      .eq('tenant_id', tenantId)
    if (catErr) throw catErr
    const catByName = new Map(
      (existingCategories || []).map((c) => [cleanText(c.name).toLowerCase(), c]),
    )
    // A category column full of group names should not need a separate
    // setup pass — create on first sight, resolve thereafter.
    const resolveCategory = async (raw) => {
      const name = cleanText(raw)
      if (!name) return null
      const key = name.toLowerCase()
      const hit = catByName.get(key)
      if (hit) return hit.id
      const { data: cat, error } = await supabase
        .from('categories')
        .insert({ tenant_id: tenantId, name })
        .select('id, name')
        .single()
      if (error || !cat) {
        console.error('[PRODUCTS] import: category create failed:', error?.message)
        return null
      }
      catByName.set(key, cat)
      categoriesCreated++
      return cat.id
    }

    const { data: existingSuppliers, error: supErr } = await supabase
      .from('suppliers')
      .select('id, name, account_code')
      .eq('tenant_id', tenantId)
    if (supErr) throw supErr
    const supByName = new Map(
      (existingSuppliers || []).map((s) => [cleanText(s.name).toLowerCase(), s]),
    )
    const supById = new Map((existingSuppliers || []).map((s) => [s.id, s]))
    // Same create-on-sight contract as categories, plus the per-supplier
    // AP account single-create assigns (2010-S<id>) — without it the new
    // supplier would silently sit outside AP tracking.
    const resolveSupplier = async (raw) => {
      const name = cleanText(raw)
      if (!name) return null
      const key = name.toLowerCase()
      const hit = supByName.get(key)
      if (hit) return hit.id
      const { data: sup, error } = await supabase
        .from('suppliers')
        .insert({ tenant_id: tenantId, name })
        .select('id, name, account_code')
        .single()
      if (error || !sup) {
        console.error('[PRODUCTS] import: supplier create failed:', error?.message)
        return null
      }
      const accountCode = `2010-S${sup.id}`
      await supabase
        .from('suppliers')
        .update({ account_code: accountCode })
        .eq('id', sup.id)
        .eq('tenant_id', tenantId)
      sup.account_code = accountCode
      supByName.set(key, sup)
      supById.set(sup.id, sup)
      suppliersCreated++
      return sup.id
    }

    // First occurrence of a SKU/barcode owns the key for this file;
    // later duplicates are reported, not silently folded together.
    const seenSkus = new Set()
    const seenBarcodes = new Set()

    for (let i = 0; i < items.length; i++) {
      const row = items[i] && typeof items[i] === 'object' ? items[i] : {}
      // _row = the file line the client saw (header is line 1), so the
      // error points where the user is looking; fall back to index.
      const rowNo = Number.isInteger(row._row) && row._row > 0 ? row._row : i + 1
      try {
        const name = cleanText(row.name)
        if (!name) { errors.push({ row: rowNo, error: 'name_required' }); continue }
        const price = cleanNum(row.price)
        if (price === null || price < 0) { errors.push({ row: rowNo, error: 'price_invalid' }); continue }
        const costProvided = row.cost_price !== undefined && row.cost_price !== null && row.cost_price !== ''
        const costPrice = costProvided ? cleanNum(row.cost_price) : 0
        if (costPrice === null || costPrice < 0) { errors.push({ row: rowNo, error: 'cost_invalid' }); continue }
        if (costPrice > price) { errors.push({ row: rowNo, error: 'cost_exceeds_price' }); continue }
        const stockProvided = row.stock_quantity !== undefined && row.stock_quantity !== null && row.stock_quantity !== ''
        const stockValue = stockProvided ? cleanNum(row.stock_quantity) : null
        if (stockProvided && (stockValue === null || stockValue < 0)) { errors.push({ row: rowNo, error: 'stock_invalid' }); continue }
        const thresholdProvided = row.low_stock_threshold !== undefined && row.low_stock_threshold !== null && row.low_stock_threshold !== ''
        const threshold = thresholdProvided ? cleanNum(row.low_stock_threshold) : null
        if (thresholdProvided && (threshold === null || threshold < 0)) { errors.push({ row: rowNo, error: 'threshold_invalid' }); continue }

        const sku = cleanText(row.sku, 50)
        const barcode = cleanText(row.barcode, 100)
        const skuKey = sku.toLowerCase()
        if (sku && seenSkus.has(skuKey)) { errors.push({ row: rowNo, error: 'sku_in_file_dup' }); continue }
        if (barcode && seenBarcodes.has(barcode)) { errors.push({ row: rowNo, error: 'barcode_in_file_dup' }); continue }

        const match = (sku && bySku.get(skuKey)) || (barcode && byBarcode.get(barcode)) || null

        if (match) {
          if (sku) seenSkus.add(skuKey)
          if (barcode) seenBarcodes.add(barcode)
          // SKU/barcode are intentionally absent: they identify the row,
          // rewriting them could collide with another product's identity.
          const patch = { name, price, cost_price: costPrice, updated_at: new Date().toISOString() }
          if ('category' in row) patch.category_id = await resolveCategory(row.category)
          if ('supplier' in row) patch.supplier_id = await resolveSupplier(row.supplier)
          if (thresholdProvided) patch.low_stock_threshold = threshold
          const { error } = await supabase
            .from('products')
            .update(patch)
            .eq('id', match.id)
            .eq('tenant_id', tenantId)
          if (error) {
            console.error('[PRODUCTS] import: update failed:', error.message)
            errors.push({ row: rowNo, error: 'update_failed' })
            continue
          }
          updated++
          // Set-to semantics: the CSV states the shelf count, so the
          // adjustment is the difference from what's recorded. adjustStock
          // keeps the per-branch row and the total in sync and logs its
          // own failure — the product just keeps its old count.
          const currentStock = Number(match.stock_quantity) || 0
          if (stockProvided && stockValue !== currentStock) {
            await adjustStock({ tenantId, branchId: req.branchId, productId: match.id, delta: stockValue - currentStock })
          }
          continue
        }

        if (headroom <= 0) { errors.push({ row: rowNo, error: 'limit_reached' }); continue }
        if (sku) seenSkus.add(skuKey)
        if (barcode) seenBarcodes.add(barcode)

        const categoryId = 'category' in row ? await resolveCategory(row.category) : null
        const supplierId = 'supplier' in row ? await resolveSupplier(row.supplier) : null
        const { data, error } = await supabase
          .from('products')
          .insert({
            tenant_id: tenantId,
            name,
            sku: sku || null,
            barcode: barcode || null,
            category_id: categoryId,
            supplier_id: supplierId,
            price,
            cost_price: costPrice,
            // Seeded to 0 like single-create: initial stock goes through
            // adjustStock so the per-branch row and the total agree from
            // day one (see the comment in the create route above).
            stock_quantity: 0,
            low_stock_threshold: thresholdProvided ? threshold : 10,
          })
          .select()
          .single()
        if (error || !data) {
          console.error('[PRODUCTS] import: insert failed:', error?.message)
          errors.push({ row: rowNo, error: 'insert_failed' })
          continue
        }
        created++
        headroom--
        rememberProduct(data)
        const initialStock = stockValue || 0
        if (initialStock > 0) {
          const adjusted = await adjustStock({ tenantId, branchId: req.branchId, productId: data.id, delta: initialStock })
          if (adjusted !== null) data.stock_quantity = adjusted
          else console.error('[PRODUCTS] import: initial stock seed failed for product', data.id)
        }
        // Same AP journal contract as single-create: opening stock from a
        // known supplier owes that supplier.
        if (data.stock_quantity > 0 && costPrice > 0 && supplierId) {
          try {
            const { postStockReceiveJournal } = await import('../services/accountingEngine.js')
            const movement = { id: data.id, quantity: data.stock_quantity }
            await postStockReceiveJournal(movement, { name: data.name, cost_price: costPrice }, supById.get(supplierId) || null, tenantId)
          } catch (accErr) {
            console.error('Accounting auto-post (CSV import) failed:', accErr.message)
          }
        }
      } catch (rowErr) {
        console.error('[PRODUCTS] import: row failed:', rowErr.message)
        errors.push({ row: rowNo, error: 'insert_failed' })
      }
    }

    if (created || updated) {
      req.logActivity({ action: 'imported', entity_type: 'product', entity_name: `CSV import: ${created} created, ${updated} updated` })
    }
    res.json({ created, updated, errors, categories_created: categoriesCreated, suppliers_created: suppliersCreated })
  } catch (err) {
    next(err)
  }
})

// Update product
router.put('/:id', authenticateToken, requirePermission('inventory_edit'), [
  param('id').isNumeric().withMessage('Invalid product ID'),
  body('name').optional().trim().notEmpty().isLength({ max: 255 }),
  body('price').optional().isFloat({ min: 0 }),
  body('stock_quantity').optional().isInt({ min: 0 }),
], validate, async (req, res, next) => {
  try {
    // Check if product exists
    const { data: existing } = await supabase
      .from('products')
      .select('*')
      .eq('id', req.params.id)
      .eq('tenant_id', req.user?.tenantId)
      .single()

    if (!existing) {
      return res.status(404).json({ error: 'Product not found' })
    }

    // existing.stock_quantity becomes the ACTIVE BRANCH's quantity — the
    // stock input the UI sends was displayed branch-relative, so the diff
    // (and the journal below) must be computed against the same basis.
    await overlayBranchStock([existing], req.user?.tenantId, req.branchId)

    const { name, sku, barcode, category_id, supplier_id, price, cost_price,
            stock_quantity, low_stock_threshold, is_refundable, unit_of_measure, pieces_per_box, image_url, specifications, is_active, commission_rate } = req.body

    // Check for duplicate SKU (excluding current product)
    if (sku && sku !== existing.sku) {
      const { data: dupSku } = await supabase
        .from('products')
        .select('id')
        .eq('sku', sku)
        .eq('tenant_id', req.user?.tenantId)
        .neq('id', req.params.id)
        .single()
      if (dupSku) {
        return res.status(409).json({ error: 'SKU already exists' })
      }
    }

    // Check for duplicate barcode (excluding current product)
    if (barcode && barcode !== existing.barcode) {
      const { data: dupBarcode } = await supabase
        .from('products')
        .select('id')
        .eq('barcode', barcode)
        .eq('tenant_id', req.user?.tenantId)
        .neq('id', req.params.id)
        .single()
      if (dupBarcode) {
        return res.status(409).json({ error: 'Barcode already exists' })
      }
    }

    // Validate cost price vs selling price
    const finalPrice = price !== undefined ? parseFloat(price) : parseFloat(existing.price)
    const finalCost = cost_price !== undefined && cost_price !== null ? parseFloat(cost_price) : (existing.cost_price !== null ? parseFloat(existing.cost_price) : null)
    if (finalCost !== null && finalCost > finalPrice) {
      return res.status(400).json({ error: 'Cost price cannot exceed selling price' })
    }

    const { data, error } = await supabase
      .from('products')
      .update({
        name: name ?? existing.name,
        sku: sku ?? existing.sku,
        barcode: barcode ?? existing.barcode,
        category_id: category_id ?? existing.category_id,
        supplier_id: supplier_id !== undefined ? (supplier_id || null) : existing.supplier_id,
        price: price ?? existing.price,
        cost_price: cost_price ?? existing.cost_price,
        low_stock_threshold: low_stock_threshold ?? existing.low_stock_threshold,
        is_refundable: is_refundable ?? existing.is_refundable,
        unit_of_measure: unit_of_measure ?? existing.unit_of_measure,
        pieces_per_box: unit_of_measure === 'box' ? (pieces_per_box ?? existing.pieces_per_box) : null,
        image_url: image_url ?? existing.image_url,
        specifications: specifications ?? existing.specifications,
        is_active: is_active ?? existing.is_active,
        commission_rate: commission_rate ?? existing.commission_rate,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .eq('tenant_id', req.user?.tenantId)
      .select()
      .single()

    if (error) throw error
    req.logActivity({ action: 'updated', entity_type: 'product', entity_id: req.params.id, entity_name: data.name })

    // Stock input = SET the active branch's quantity; convert to a delta
    // and let the RPC apply it (it owns stock_quantity now — the payload no
    // longer carries it). data.stock_quantity is rewritten to the branch's
    // post-edit quantity so the journal diff below stays branch-relative;
    // on RPC failure keep the pre-edit quantity so a failed write never
    // posts a journal entry.
    let effectiveBranchQty = Number(existing.stock_quantity) || 0
    if (stock_quantity !== undefined && stock_quantity !== null) {
      const targetQty = parseFloat(stock_quantity)
      const delta = targetQty - effectiveBranchQty
      if (delta !== 0) {
        const adjusted = await adjustStock({
          tenantId: req.user?.tenantId,
          branchId: req.branchId,
          productId: data.id,
          delta,
        })
        if (adjusted !== null) effectiveBranchQty = adjusted
        else console.error('[PRODUCTS] stock adjust failed for product', data.id)
      } else {
        effectiveBranchQty = targetQty
      }
    }
    data.stock_quantity = effectiveBranchQty

    // Auto-post journal if stock changed
    const stockDiff = data.stock_quantity - existing.stock_quantity
    if (stockDiff !== 0 && data.cost_price > 0) {
      try {
        const { postStockReceiveJournal, postStockAdjustJournal } = await import('../services/accountingEngine.js')
        const movement = { id: data.id, quantity: Math.abs(stockDiff) }
        let supplierInfo = null
        if (data.supplier_id) {
          const { data: supp } = await supabase.from('suppliers').select('id, name, account_code').eq('id', data.supplier_id).eq('tenant_id', req.user?.tenantId).single()
          supplierInfo = supp
        }
        if (stockDiff > 0) {
        await postStockReceiveJournal(movement, { name: data.name, cost_price: data.cost_price }, supplierInfo, req.user?.tenantId)
        } else {
          await postStockAdjustJournal({ ...movement, quantity: -Math.abs(stockDiff) }, { name: data.name, cost_price: data.cost_price }, req.user?.tenantId)
        }
      } catch (accErr) {
        console.error('Accounting auto-post (product update) failed:', accErr.message)
      }
    }

    res.json(data)
  } catch (err) {
    next(err)
  }
})

// Delete product
router.delete('/:id', authenticateToken, requirePermission('inventory_edit'), [
  param('id').isNumeric().withMessage('Invalid product ID'),
], validate, async (req, res, next) => {
  try {
    const { data: existing } = await supabase
      .from('products')
      .select('*')
      .eq('id', req.params.id)
      .eq('tenant_id', req.user?.tenantId)
      .single()

    if (!existing) {
      return res.status(404).json({ error: 'Product not found' })
    }

    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', req.params.id)
      .eq('tenant_id', req.user?.tenantId)

    if (error) throw error
    req.logActivity({ action: 'deleted', entity_type: 'product', entity_id: req.params.id })

    // Auto-post journal: reverse inventory value
    if (existing.stock_quantity > 0 && existing.cost_price > 0) {
      try {
        const { postStockAdjustJournal } = await import('../services/accountingEngine.js')
        const movement = { id: existing.id, quantity: -existing.stock_quantity }
        await postStockAdjustJournal(movement, { name: existing.name, cost_price: existing.cost_price }, req.user?.tenantId)
      } catch (accErr) {
        console.error('Accounting auto-post (product delete) failed:', accErr.message)
      }
    }

    res.json({ message: 'Product deleted successfully' })
  } catch (err) {
    next(err)
  }
})

export default router
