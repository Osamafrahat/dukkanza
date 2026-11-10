import { Router } from 'express'
import crypto from 'crypto'
import supabase from '../db/supabase.js'
import { authenticateToken, requireSuperAdmin, generateToken } from '../middleware/auth.js'
import { body, validationResult } from 'express-validator'
import { logActivity } from '../middleware/activityLogger.js'
import { ensureDefaultBranch } from '../services/branches.js'
import { sanitizeSearch } from '../helpers/search.js'
import { sendWelcomeEmail } from '../services/emailService.js'
import { notifyOperator } from '../services/telegramNotify.js'

const router = Router()

router.use(authenticateToken, requireSuperAdmin)

// GET /api/super-admin/stats - Global stats
router.get('/stats', async (req, res) => {
  try {
    const [
      { count: totalTenants },
      { count: activeTenants },
      { count: trialingTenants },
      { count: cancelledTenants },
      { count: totalUsers },
      { count: totalProducts },
      { count: totalOrders },
    ] = await Promise.all([
      supabase.from('tenants').select('*', { count: 'exact', head: true }),
      supabase.from('tenants').select('*', { count: 'exact', head: true }).eq('subscription_status', 'active'),
      supabase.from('tenants').select('*', { count: 'exact', head: true }).eq('subscription_status', 'trialing'),
      supabase.from('tenants').select('*', { count: 'exact', head: true }).eq('subscription_status', 'cancelled'),
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('products').select('*', { count: 'exact', head: true }),
      supabase.from('orders').select('*', { count: 'exact', head: true }),
    ])

    const { data: plans } = await supabase.from('subscription_plans').select('*').order('price_monthly')
    const planMap = {}
    for (const p of (plans || [])) planMap[p.slug] = p.price_monthly

    const { data: tenants } = await supabase.from('tenants').select('subscription_tier, subscription_status')
    // MRR counts only tenants that are actually paying. Selecting tier alone
    // summed cancelled and past_due tenants into the figure and overstated it.
    const mrr = (tenants || []).reduce(
      (sum, t) => (t.subscription_status === 'active' ? sum + (planMap[t.subscription_tier] || 0) : sum),
      0
    )

    res.json({
      total_tenants: totalTenants || 0,
      active_tenants: activeTenants || 0,
      trialing_tenants: trialingTenants || 0,
      cancelled_tenants: cancelledTenants || 0,
      total_users: totalUsers || 0,
      total_products: totalProducts || 0,
      total_orders: totalOrders || 0,
      mrr,
    })
  } catch (err) {
    console.error(`[SuperAdmin] ${req.method} ${req.originalUrl} failed:`, err.message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/super-admin/tenants - List all tenants with stats
router.get('/tenants', async (req, res) => {
  try {
    const { search, status, tier, page = 1, limit = 20 } = req.query
    const offset = (Math.max(1, Number(page)) - 1) * Number(limit)

    let query = supabase.from('tenants').select('*', { count: 'exact' })
    if (search) {
      const s = sanitizeSearch(search)
      if (s) query = query.or(`name.ilike.%${s}%,slug.ilike.%${s}%,email.ilike.%${s}%`)
    }
    if (status) query = query.eq('subscription_status', status)
    if (tier) query = query.eq('subscription_tier', tier)

    const { data: tenants, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)
    if (error) throw error

    const tenantsWithStats = await Promise.all(
      (tenants || []).map(async (tenant) => {
        const [{ count: userCount }, { count: productCount }, { count: orderCount }] = await Promise.all([
          supabase.from('users').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id),
          supabase.from('products').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id),
          supabase.from('orders').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id),
        ])

        return {
          ...tenant,
          user_count: userCount || 0,
          product_count: productCount || 0,
          order_count: orderCount || 0,
        }
      })
    )

    res.json({ tenants: tenantsWithStats, total: count || 0, page: Number(page), limit: Number(limit) })
  } catch (err) {
    console.error(`[SuperAdmin] ${req.method} ${req.originalUrl} failed:`, err.message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/super-admin/tenants/:id - Get tenant details
router.get('/tenants/:id', async (req, res) => {
  try {
    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', req.params.id)
      .single()
    if (error || !tenant) return res.status(404).json({ error: 'Tenant not found' })

    const [{ count: userCount }, { count: productCount }, { count: orderCount }] = await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id),
      supabase.from('products').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id),
    ])

    const { data: users } = await supabase
      .from('users')
      .select('id, username, full_name, email, role, is_active, last_login, created_at')
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false })

    const { data: recentOrders } = await supabase
      .from('orders')
      .select('id, order_number, total_amount, status, created_at')
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false })
      .limit(10)

    res.json({
      ...tenant,
      user_count: userCount || 0,
      product_count: productCount || 0,
      order_count: orderCount || 0,
      users: users || [],
      recent_orders: recentOrders || [],
    })
  } catch (err) {
    console.error(`[SuperAdmin] ${req.method} ${req.originalUrl} failed:`, err.message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /api/super-admin/tenants - Create a new tenant manually
router.post('/tenants', [
  body('name').trim().notEmpty().withMessage('Store name is required'),
  body('adminUsername').trim().isLength({ min: 3 }).withMessage('Admin username must be at least 3 characters'),
  body('adminPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('adminEmail').isEmail().withMessage('Valid admin email is required'),
  body('adminFullName').trim().notEmpty().withMessage('Admin full name is required'),
], async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array().map(e => e.msg).join(', ') })
  }

  try {
    const { name, adminUsername, adminPassword, adminEmail, adminFullName, tier = 'free' } = req.body

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const { data: existingSlug } = await supabase.from('tenants').select('id').eq('slug', slug).maybeSingle()
    if (existingSlug) {
      return res.status(409).json({ error: 'A tenant with a similar name already exists' })
    }

    const bcrypt = await import('bcryptjs')
    const hashedPassword = await bcrypt.default.hash(adminPassword, 10)

    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .insert({
        name,
        slug,
        subscription_tier: tier,
        subscription_status: 'active',
        trial_ends_at: null,
      })
      .select('*')
      .single()
    if (tenantError) throw tenantError

    // Every new tenant starts with its Main Branch (resolution self-heals
    // too, but create it eagerly; failure is non-fatal).
    try {
      await ensureDefaultBranch(tenant.id)
    } catch (brErr) {
      console.error('[SuperAdmin] default branch creation failed:', brErr.message)
    }

    const { error: userError } = await supabase
      .from('users')
      .insert({
        tenant_id: tenant.id,
        username: adminUsername,
        password: hashedPassword,
        full_name: adminFullName,
        email: adminEmail,
        role: 'MANAGER',
        permissions: '["all"]',
        is_active: true,
        must_change_password: true,
      })
    if (userError) throw userError

    // Onboarding email to the new admin — fire-and-forget.
    sendWelcomeEmail({ to: adminEmail, name: adminFullName, storeName: name, trial: tier === 'free' }).catch((err) =>
      console.error('[EMAIL] Welcome failed:', err.message)
    )

    // Operator push — fire-and-forget; name/tier/username escaped centrally.
    notifyOperator({
      emoji: '\u{1F3EA}',
      title: 'Tenant created (super admin)',
      lines: [`Store: ${name}`, `Tier: ${tier}`, `Admin: ${adminUsername}`],
    }).catch((err) => console.error('[SuperAdmin] telegram push failed:', err.message))

    res.status(201).json({ tenant, message: 'Tenant and admin user created. Admin must change password on first login.' })
  } catch (err) {
    console.error(`[SuperAdmin] ${req.method} ${req.originalUrl} failed:`, err.message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// PUT /api/super-admin/tenants/:id - Update tenant (tier, status, limits)
router.put('/tenants/:id', async (req, res) => {
  try {
    const { subscription_status, subscription_tier, max_products, max_users, max_orders_monthly } = req.body
    const tenantId = Number(req.params.id)

    // Get current tier for activity logging
    const { data: currentTenant } = await supabase
      .from('tenants')
      .select('subscription_tier, name')
      .eq('id', tenantId)
      .single()

    const updateData = { updated_at: new Date().toISOString() }
    if (subscription_status !== undefined) updateData.subscription_status = subscription_status
    if (subscription_tier !== undefined) updateData.subscription_tier = subscription_tier

    // When tier changes, fetch limits from subscription_plans table unless explicitly overridden
    if (subscription_tier !== undefined) {
      const { data: plan } = await supabase
        .from('subscription_plans')
        .select('max_products, max_users, max_orders_monthly')
        .eq('slug', subscription_tier)
        .single()

      if (plan) {
        updateData.max_products = max_products !== undefined ? Number(max_products) : plan.max_products
        updateData.max_users = max_users !== undefined ? Number(max_users) : plan.max_users
        updateData.max_orders_monthly = max_orders_monthly !== undefined ? Number(max_orders_monthly) : plan.max_orders_monthly
      } else {
        if (subscription_tier === 'free') {
          updateData.max_products = max_products !== undefined ? Number(max_products) : 50
          updateData.max_users = max_users !== undefined ? Number(max_users) : 2
          updateData.max_orders_monthly = max_orders_monthly !== undefined ? Number(max_orders_monthly) : 100
        }
      }
    } else {
      if (max_products !== undefined) updateData.max_products = Number(max_products)
      if (max_users !== undefined) updateData.max_users = Number(max_users)
      if (max_orders_monthly !== undefined) updateData.max_orders_monthly = Number(max_orders_monthly)
    }

    const { data, error } = await supabase
      .from('tenants')
      .update(updateData)
      .eq('id', tenantId)
      .select('*')
      .single()
    if (error) throw error

    // Log subscription tier change
    if (subscription_tier && currentTenant && subscription_tier !== currentTenant.subscription_tier) {
      const tierOrder = { free: 0, pro: 1, enterprise: 2 }
      const isUpgrade = (tierOrder[subscription_tier] || 0) > (tierOrder[currentTenant.subscription_tier] || 0)
      await logActivity({
        user_id: req.user.id,
        user_name: req.user.full_name || req.user.username,
        action: isUpgrade ? 'upgraded' : 'downgraded',
        entity_type: 'subscription',
        entity_id: tenantId,
        entity_name: currentTenant.name,
        details: { from_tier: currentTenant.subscription_tier, to_tier: subscription_tier },
        tenant_id: tenantId,
      })
    }

    console.log(`[SuperAdmin] Tenant ${tenantId} updated: tier=${subscription_tier || 'unchanged'}, limits=${updateData.max_products}/${updateData.max_users}/${updateData.max_orders_monthly}`)
    res.json(data)
  } catch (err) {
    console.error(`[SuperAdmin] ${req.method} ${req.originalUrl} failed:`, err.message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// DELETE /api/super-admin/tenants/:id - Delete a tenant and all its data
router.delete('/tenants/:id', async (req, res) => {
  try {
    // Strict validation before any delete: positive integer id only
    const rawTenantId = String(req.params.id)
    if (!/^[1-9][0-9]*$/.test(rawTenantId)) {
      return res.status(400).json({ error: 'Invalid tenant id' })
    }
    const tid = Number(rawTenantId)
    if (!Number.isSafeInteger(tid)) {
      return res.status(400).json({ error: 'Invalid tenant id' })
    }

    const { data: tenant, error: findErr } = await supabase
      .from('tenants')
      .select('id, name')
      .eq('id', tid)
      .single()
    if (findErr || !tenant) return res.status(404).json({ error: 'Tenant not found' })

    const failedDeletes = []

    // Helper: parameterized delete via the Supabase client (no raw SQL).
    // `where` is an allow-listed condition built only from validated integers,
    // so no request input is ever interpolated into a query.
    const safeDel = async (table, where) => {
      if (!/^[a-z_]+$/.test(table)) throw new Error(`Invalid table name: ${table}`)
      const match = /^(tenant_id|id|order_id|refund_id|payroll_id|purchase_order_id) (= ([0-9]+)|IN \(([0-9]+(,[0-9]+)*)\))$/.exec(where)
      if (!match) throw new Error(`Unsupported delete condition for ${table}`)
      const column = match[1]
      const query = supabase.from(table).delete()
      const { error } = match[4] !== undefined
        ? await query.in(column, match[4].split(',').map(Number))
        : await query.eq(column, Number(match[3]))
      if (error) {
        console.error(`[SuperAdmin] Delete ${table}: ${error.message}`)
        failedDeletes.push(table)
      }
    }

    // 1. Collect parent IDs first
    const { data: orders } = await supabase.from('orders').select('id').eq('tenant_id', tid)
    const { data: pays } = await supabase.from('payroll').select('id').eq('tenant_id', tid)
    const { data: pos } = await supabase.from('purchase_orders').select('id').eq('tenant_id', tid)
    const { data: refs } = await supabase.from('refunds').select('id').eq('tenant_id', tid)

    const oIds = (orders || []).map(r => r.id)
    const pIds = (pays || []).map(r => r.id)
    const poIds = (pos || []).map(r => r.id)
    const rIds = (refs || []).map(r => r.id)

    // 2. Delete deepest children
    if (oIds.length) await safeDel('order_items', `order_id IN (${oIds.join(',')})`)
    if (rIds.length) await safeDel('refund_items', `refund_id IN (${rIds.join(',')})`)
    // journal_entry_lines.account_id -> accounts is NO ACTION, so the lines
    // must go before accounts below. Delete them by tenant_id - the column
    // accountingEngine sets on every insert - NOT by the parent FK column:
    // that column is named entry_id, and filtering on a guessed, nonexistent
    // name made this delete 400 and every tenant with journal data report a
    // phantom "incomplete" delete. tenant_id is also O(1): no IN-list of
    // entry ids to outgrow request limits.
    await safeDel('journal_entry_lines', `tenant_id = ${tid}`)
    if (pIds.length) await safeDel('payroll_items', `payroll_id IN (${pIds.join(',')})`)
    if (poIds.length) await safeDel('purchase_order_items', `purchase_order_id IN (${poIds.join(',')})`)
    await safeDel('payment_splits', `tenant_id = ${tid}`)
    await safeDel('stock_movements', `tenant_id = ${tid}`)
    await safeDel('review_criteria', `tenant_id = ${tid}`)
    await safeDel('subscription_payments', `tenant_id = ${tid}`)
    await safeDel('credit_payments', `tenant_id = ${tid}`)
    await safeDel('commissions', `tenant_id = ${tid}`)
    await safeDel('cash_shifts', `tenant_id = ${tid}`)
    await safeDel('product_batches', `tenant_id = ${tid}`)
    await safeDel('saved_payment_methods', `tenant_id = ${tid}`)
    await safeDel('messages', `tenant_id = ${tid}`)

    // 3. Mid-level
    await safeDel('refunds', `tenant_id = ${tid}`)
    await safeDel('orders', `tenant_id = ${tid}`)
    await safeDel('payments', `tenant_id = ${tid}`)
    await safeDel('journal_entries', `tenant_id = ${tid}`)
    await safeDel('expenses', `tenant_id = ${tid}`)
    await safeDel('attendance', `tenant_id = ${tid}`)
    await safeDel('leave_requests', `tenant_id = ${tid}`)
    await safeDel('performance_reviews', `tenant_id = ${tid}`)
    await safeDel('payroll', `tenant_id = ${tid}`)
    await safeDel('subscriptions', `tenant_id = ${tid}`)
    await safeDel('credit_sales', `tenant_id = ${tid}`)
    await safeDel('purchase_orders', `tenant_id = ${tid}`)
    await safeDel('promotions', `tenant_id = ${tid}`)
    await safeDel('activity_log', `tenant_id = ${tid}`)

    // Branch transfers: stock_transfer_items.product_id -> products and
    // stock_transfers.created_by -> users are NO ACTION, and items have no
    // tenant_id. Deleting transfers by tenant first cascades the items
    // (items.transfer_id -> stock_transfers is CASCADE), unblocking both
    // products and users below.
    await safeDel('stock_transfers', `tenant_id = ${tid}`)
    // fiscal_periods.closed_by -> users is NO ACTION and is never deleted
    // below; clear it before the users delete to avoid a second-wave failure.
    await safeDel('fiscal_periods', `tenant_id = ${tid}`)

    // Manufacturing is tenant-owned but has two RESTRICT FKs this list
    // historically ignored, so any tenant that ever ran production fails:
    //   - production_order_items.product_id and production_orders.product_id
    //     -> products are RESTRICT (NOT NULL): the products delete below
    //     500s while a production order exists. Deleting production_orders
    //     first cascades production_order_items (order_id -> production_orders
    //     is CASCADE, order_id is NOT NULL, so no orphans) and unblocks it.
    //   - bom_operations.work_center_id -> work_centers is RESTRICT: the
    //     final tenants-row cascade would delete work_centers while bom
    //     operations still referenced them. bills_of_materials cascades
    //     bom_items + bom_operations (bom_id is NOT NULL), so it must go
    //     before work_centers.
    // Children first: quality checks -> work orders -> production orders ->
    // BOMs -> work centers. Everything else in the cluster only has SET
    // NULL / cascade FKs, so this order is what matters.
    await safeDel('quality_checks', `tenant_id = ${tid}`)
    await safeDel('work_orders', `tenant_id = ${tid}`)
    await safeDel('production_orders', `tenant_id = ${tid}`)
    await safeDel('bills_of_materials', `tenant_id = ${tid}`)
    await safeDel('work_centers', `tenant_id = ${tid}`)

    // 4. Top-level
    await safeDel('products', `tenant_id = ${tid}`)
    await safeDel('categories', `tenant_id = ${tid}`)
    await safeDel('customers', `tenant_id = ${tid}`)
    await safeDel('employees', `tenant_id = ${tid}`)
    await safeDel('suppliers', `tenant_id = ${tid}`)
    await safeDel('shifts', `tenant_id = ${tid}`)
    await safeDel('leave_types', `tenant_id = ${tid}`)
    await safeDel('services', `tenant_id = ${tid}`)
    await safeDel('service_plans', `tenant_id = ${tid}`)
    await safeDel('accounts', `tenant_id = ${tid}`)
    await safeDel('account_balances', `tenant_id = ${tid}`)
    await safeDel('store_settings', `tenant_id = ${tid}`)
    await safeDel('users', `tenant_id = ${tid}`)
    await safeDel('tenant_payments', `tenant_id = ${tid}`)

    // 5. Tenant itself
    await safeDel('tenants', `id = ${tid}`)

    if (failedDeletes.length > 0) {
      const details = `Tenant delete incomplete, failed tables: ${failedDeletes.join(', ')}`
      console.error(`[SuperAdmin] ${details}`)
      // `error` stays the generic string every consumer expects; `details`
      // is what capture500 turns into the Sentry message and the operator
      // alert, so the next failure names the blocking table instead of a
      // bare "Internal server error".
      return res.status(500).json({ error: 'Internal server error', details })
    }

    res.json({ message: `Tenant "${tenant.name}" and all its data have been permanently deleted` })
  } catch (err) {
    console.error('[SuperAdmin] Delete tenant error:', err.message)
    res.status(500).json({ error: 'Internal server error', details: `Tenant delete error: ${err.message}` })
  }
})

// POST /api/super-admin/tenants/:id/impersonate - Generate impersonation token
router.post('/tenants/:id/impersonate', async (req, res) => {
  try {
    const tenantId = req.params.id

    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .select('id, name, subscription_tier, subscription_status, trial_ends_at')
      .eq('id', tenantId)
      .single()
    if (tenantErr || !tenant) return res.status(404).json({ error: 'Tenant not found' })

    // Projection mirrors /auth/login's user so the client can hydrate its store
    // identically. must_change_password is deliberately omitted: the super admin
    // is inspecting a tenant, not taking over an account that owes a password
    // change, and a forced-change screen would make impersonation unusable.
    const { data: manager, error: userErr } = await supabase
      .from('users')
      .select('id, username, full_name, email, phone, role, permissions, is_active, tenant_id')
      .eq('tenant_id', tenantId)
      .eq('role', 'MANAGER')
      .eq('is_active', true)
      .order('created_at')
      .limit(1)
      .maybeSingle()
    if (userErr || !manager) {
      return res.status(404).json({ error: 'No active manager found for this tenant' })
    }

    const sessionToken = crypto.randomUUID()
    const token = generateToken({ ...manager, session_token: sessionToken })

    await supabase
      .from('users')
      .update({ session_token: sessionToken, last_login: new Date().toISOString() })
      .eq('id', manager.id)

    res.json({ token, user: manager, tenant })
  } catch (err) {
    console.error(`[SuperAdmin] ${req.method} ${req.originalUrl} failed:`, err.message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/super-admin/plans - List subscription plans
router.get('/plans', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('subscription_plans')
      .select('*')
      .order('price_monthly')
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    console.error(`[SuperAdmin] ${req.method} ${req.originalUrl} failed:`, err.message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// PUT /api/super-admin/plans/:id - Update a subscription plan
router.put('/plans/:id', async (req, res) => {
  try {
    const { price_monthly, price_yearly, max_products, max_users, max_orders_monthly, features } = req.body
    const updateData = {}
    if (price_monthly !== undefined) updateData.price_monthly = Number(price_monthly)
    if (price_yearly !== undefined) updateData.price_yearly = Number(price_yearly)
    if (max_products !== undefined) updateData.max_products = Number(max_products)
    if (max_users !== undefined) updateData.max_users = Number(max_users)
    if (max_orders_monthly !== undefined) updateData.max_orders_monthly = Number(max_orders_monthly)
    if (features !== undefined) updateData.features = features

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No fields to update' })
    }

    console.log(`[SuperAdmin] Updating plan ${req.params.id}:`, updateData)

    const { data, error } = await supabase
      .from('subscription_plans')
      .update(updateData)
      .eq('id', req.params.id)
      .select('*')
      .single()
    if (error) {
      console.error('[SuperAdmin] Plan update error:', error)
      throw error
    }

    res.json(data)
  } catch (err) {
    console.error(`[SuperAdmin] ${req.method} ${req.originalUrl} failed:`, err.message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/super-admin/activity - Recent activity across all tenants
router.get('/activity', async (req, res) => {
  try {
    const { limit = 50, page = 1, tenant_id, entity_type, action, search } = req.query
    const offset = (Math.max(1, Number(page)) - 1) * Number(limit)

    let query = supabase
      .from('activity_log')
      .select('*, users:user_id(username, full_name)', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (tenant_id) query = query.eq('tenant_id', tenant_id)
    if (entity_type) query = query.eq('entity_type', entity_type)
    if (action) query = query.eq('action', action)
    if (search) {
      const s = sanitizeSearch(search)
      if (s) query = query.or(`user_name.ilike.%${s}%,entity_name.ilike.%${s}%,action.ilike.%${s}%`)
    }

    const { data, error, count } = await query.range(offset, offset + Number(limit) - 1)
    if (error) throw error

    // Enrich with tenant names
    const tenantIds = [...new Set((data || []).map(a => a.tenant_id).filter(Boolean))]
    let tenantMap = {}
    if (tenantIds.length > 0) {
      const { data: tenants } = await supabase
        .from('tenants')
        .select('id, name')
        .in('id', tenantIds)
      for (const t of (tenants || [])) tenantMap[t.id] = t.name
    }

    const enriched = (data || []).map(a => ({
      ...a,
      tenant_name: tenantMap[a.tenant_id] || null,
    }))

    res.json({
      data: enriched,
      pagination: { page: Number(page), limit: Number(limit), total: count || 0, totalPages: Math.ceil((count || 0) / Number(limit)) },
    })
  } catch (err) {
    console.error(`[SuperAdmin] ${req.method} ${req.originalUrl} failed:`, err.message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /api/super-admin/migrate - Run schema migration (super admin only)
router.post('/migrate', async (req, res) => {
  try {
    const results = []

    // Try adding subscription_expires_at
    const { error: e1 } = await supabase.rpc('exec_sql', {
      sql: 'ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_expires_at timestamptz'
    })
    if (e1) {
      // Fallback: try direct query to check if column exists
      const { error: checkErr } = await supabase.from('tenants').select('subscription_expires_at').limit(1)
      results.push({ column: 'subscription_expires_at', status: checkErr ? 'MISSING - run SQL manually' : 'EXISTS' })
    } else {
      results.push({ column: 'subscription_expires_at', status: 'CREATED' })
    }

    // Try adding renewal_note
    const { error: e2 } = await supabase.rpc('exec_sql', {
      sql: 'ALTER TABLE tenants ADD COLUMN IF NOT EXISTS renewal_note text'
    })
    if (e2) {
      const { error: checkErr } = await supabase.from('tenants').select('renewal_note').limit(1)
      results.push({ column: 'renewal_note', status: checkErr ? 'MISSING - run SQL manually' : 'EXISTS' })
    } else {
      results.push({ column: 'renewal_note', status: 'CREATED' })
    }

    res.json({ results, sql: 'ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_expires_at timestamptz; ALTER TABLE tenants ADD COLUMN IF NOT EXISTS renewal_note text;' })
  } catch (err) {
    console.error(`[SuperAdmin] ${req.method} ${req.originalUrl} failed:`, err.message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/super-admin/payments - All payments across tenants
router.get('/payments', async (req, res) => {
  try {
    const { limit = 50, status } = req.query
    let query = supabase
      .from('tenant_payments')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Number(limit))

    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) throw error

    // Enrich with tenant names
    const tenantIds = [...new Set((data || []).map(p => p.tenant_id).filter(Boolean))]
    let tenantMap = {}
    if (tenantIds.length > 0) {
      const { data: tenants } = await supabase
        .from('tenants')
        .select('id, name, slug, subscription_tier')
        .in('id', tenantIds)
      for (const t of (tenants || [])) tenantMap[t.id] = t
    }

    const enriched = (data || []).map(p => ({
      ...p,
      tenant: tenantMap[p.tenant_id] || null,
    }))

    res.json(enriched)
  } catch (err) {
    console.error(`[SuperAdmin] ${req.method} ${req.originalUrl} failed:`, err.message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/super-admin/analytics - Revenue and growth analytics
router.get('/analytics', async (req, res) => {
  try {
    const { period = '30d' } = req.query
    const now = new Date()
    let startDate

    if (period === '7d') startDate = new Date(now - 7 * 24 * 60 * 60 * 1000)
    else if (period === '90d') startDate = new Date(now - 90 * 24 * 60 * 60 * 1000)
    else startDate = new Date(now - 30 * 24 * 60 * 60 * 1000)

    const [
      { data: payments },
      { data: plans },
      { data: tenants },
      { data: recentTenants },
    ] = await Promise.all([
      supabase.from('tenant_payments').select('amount, currency, status, created_at, tenant_id'),
      supabase.from('subscription_plans').select('slug, price_monthly, price_yearly'),
      supabase.from('tenants').select('id, subscription_tier, subscription_status, created_at'),
      supabase.from('tenants').select('id, name, subscription_tier, created_at').order('created_at', { ascending: false }).limit(5),
    ])

    const planMap = {}
    for (const p of (plans || [])) planMap[p.slug] = p

    const totalRevenue = (payments || [])
      .filter(p => p.status === 'paid')
      .reduce((sum, p) => sum + (p.amount || 0), 0)

    const periodPayments = (payments || []).filter(p => {
      const d = new Date(p.created_at)
      return d >= startDate && p.status === 'paid'
    })

    const periodRevenue = periodPayments.reduce((sum, p) => sum + (p.amount || 0), 0)

    const dailyRevenue = {}
    for (const p of periodPayments) {
      const day = new Date(p.created_at).toISOString().split('T')[0]
      dailyRevenue[day] = (dailyRevenue[day] || 0) + (p.amount || 0)
    }

    const tierCounts = { free: 0, pro: 0, enterprise: 0 }
    for (const t of (tenants || [])) {
      const tier = t.subscription_tier || 'free'
      tierCounts[tier] = (tierCounts[tier] || 0) + 1
    }

    const estimatedMRR = (tenants || []).reduce((sum, t) => {
      const plan = planMap[t.subscription_tier]
      return sum + (plan?.price_monthly || 0)
    }, 0)

    res.json({
      total_revenue: totalRevenue,
      period_revenue: periodRevenue,
      estimated_mrr: estimatedMRR,
      total_tenants: (tenants || []).length,
      tier_distribution: tierCounts,
      daily_revenue: dailyRevenue,
      recent_tenants: recentTenants || [],
      total_payments: (payments || []).length,
      successful_payments: (payments || []).filter(p => p.status === 'paid').length,
    })
  } catch (err) {
    console.error(`[SuperAdmin] ${req.method} ${req.originalUrl} failed:`, err.message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ==================== BANNERS ====================

// List all banners (super admin)
router.get('/banners', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('banners')
      .select('*')
      .order('position', { ascending: true })
      .order('created_at', { ascending: false })
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    console.error(`[SuperAdmin] ${req.method} ${req.originalUrl} failed:`, err.message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Create banner
router.post('/banners', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { title, content, image_url, link_url, is_active, position, background_color, text_color } = req.body
    if (!title) return res.status(400).json({ error: 'Title is required' })

    const { data, error } = await supabase
      .from('banners')
      .insert({
        title,
        content: content || null,
        image_url: image_url || null,
        link_url: link_url || null,
        is_active: is_active !== false,
        position: position || 0,
        background_color: background_color || '#3b82f6',
        text_color: text_color || '#ffffff',
      })
      .select()
      .single()
    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    console.error(`[SuperAdmin] ${req.method} ${req.originalUrl} failed:`, err.message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Update banner
router.put('/banners/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { title, content, image_url, link_url, is_active, position, background_color, text_color } = req.body
    const { data, error } = await supabase
      .from('banners')
      .update({
        title, content, image_url, link_url, is_active, position, background_color, text_color,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error(`[SuperAdmin] ${req.method} ${req.originalUrl} failed:`, err.message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Delete banner
router.delete('/banners/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('banners')
      .delete()
      .eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true })
  } catch (err) {
    console.error(`[SuperAdmin] ${req.method} ${req.originalUrl} failed:`, err.message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
