import { Router } from 'express'
import supabase from '../db/supabase.js'
import { overlayBranchStock } from '../services/branchStock.js'

const router = Router()

// Attaches a branch filter when one is active (null keeps the legacy
// whole-tenant scope).
function branchScoped(query, branchId) {
  return branchId ? query.eq('branch_id', branchId) : query
}

// Get sales report
router.get('/sales', async (req, res, next) => {
  try {
    const { range = 'week' } = req.query

    // Calculate date range
    const now = new Date()
    let startDate

    switch (range) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        break
      case 'week':
        startDate = new Date(now.setDate(now.getDate() - 7))
        break
      case 'month':
        startDate = new Date(now.setMonth(now.getMonth() - 1))
        break
      case 'year':
        startDate = new Date(now.setFullYear(now.getFullYear() - 1))
        break
      default:
        startDate = new Date(now.setDate(now.getDate() - 7))
    }

    // Get orders in range — branch-scoped so the report (and the
    // dashboard, which calls this with range=today) reflects the active
    // location.
    let ordersQuery = supabase
      .from('orders')
      .select('*')
      .eq('tenant_id', req.user.tenantId)
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: false })
    if (req.branchId) ordersQuery = ordersQuery.eq('branch_id', req.branchId)

    const { data: orders, error: ordersError } = await ordersQuery

    if (ordersError) throw ordersError

    const safeOrders = orders || []

    // Calculate stats
    const totalSales = safeOrders.reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0)
    const totalOrders = safeOrders.length
    const avgOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0

    // Get order items for top products
    const orderIds = safeOrders.map(o => o.id)
    let itemsSold = 0
    let topProducts = []

    if (orderIds.length > 0) {
      const { data: orderItems } = await supabase
        .from('order_items')
        .select('*, products(name)')
        .in('order_id', orderIds)
        .eq('tenant_id', req.user.tenantId)

      if (orderItems) {
        itemsSold = orderItems.reduce((sum, i) => sum + (i.quantity || 0), 0)

        // Group by product
        const productSales = {}
        orderItems.forEach(item => {
          const productId = item.product_id
          if (!productSales[productId]) {
            productSales[productId] = {
              id: productId,
              name: item.products?.name || 'Unknown',
              quantitySold: 0,
              revenue: 0
            }
          }
          productSales[productId].quantitySold += item.quantity
          productSales[productId].revenue += parseFloat(item.total) || 0
        })

        topProducts = Object.values(productSales)
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 10)
      }
    }

    // Daily sales for chart
    const dailySales = []
    const daysInRange = Math.ceil((new Date() - startDate) / (1000 * 60 * 60 * 24))
    for (let i = 0; i < Math.min(daysInRange, 30); i++) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0]
      const dayOrders = orders.filter(o => o.created_at?.startsWith(dateStr))
      const dayTotal = dayOrders.reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0)
      dailySales.unshift({ date: dateStr, sales: dayTotal })
    }

    // Hourly distribution across the range — which parts of the day are
    // busiest. Computed from the orders already fetched, so no extra query.
    const hourlySales = Array.from({ length: 24 }, (_, hour) => ({ hour, sales: 0, orders: 0 }))
    safeOrders.forEach(o => {
      if (!o.created_at) return
      const hour = new Date(o.created_at).getHours()
      if (hour >= 0 && hour < 24) {
        hourlySales[hour].sales += parseFloat(o.total) || 0
        hourlySales[hour].orders += 1
      }
    })

    res.json({
      totalSales,
      totalOrders,
      avgOrderValue,
      itemsSold,
      topProducts,
      dailySales,
      hourlySales
    })
  } catch (err) {
    next(err)
  }
})

// Get stock report
router.get('/stock', async (req, res, next) => {
  try {
    const tid = req.user.tenantId

    // Get all products WITHOUT FK join
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, name, stock_quantity, price, cost_price, low_stock_threshold, category_id')
      .eq('tenant_id', tid)
      .order('name')

    if (productsError) throw productsError

    // Value/low-stock math below runs on the ACTIVE BRANCH's quantities.
    await overlayBranchStock(products, req.user.tenantId, req.branchId)

    const safeProducts = products || []

    // Get categories separately
    const catIds = [...new Set(safeProducts.map(p => p.category_id).filter(Boolean))]
    let catMap = {}
    if (catIds.length > 0) {
      const { data: cats } = await supabase
        .from('categories')
        .select('id, name')
        .eq('tenant_id', tid)
        .in('id', catIds)
      if (cats) cats.forEach(c => { catMap[c.id] = c.name })
    }

    const totalProducts = safeProducts.length
    const lowStockProducts = safeProducts.filter(p => p.stock_quantity <= (p.low_stock_threshold || 10))
    const lowStockCount = lowStockProducts.length
    const totalValue = safeProducts.reduce((sum, p) => sum + ((p.stock_quantity || 0) * (p.price || 0)), 0)
    const totalCost = safeProducts.reduce((sum, p) => sum + ((p.stock_quantity || 0) * (p.cost_price || 0)), 0)
    const potentialProfit = totalValue - totalCost

    // Category breakdown with cost
    const categoryMap = {}
    safeProducts.forEach(p => {
      const catName = catMap[p.category_id] || 'Uncategorized'
      if (!categoryMap[catName]) {
        categoryMap[catName] = { name: catName, value: 0, cost: 0 }
      }
      categoryMap[catName].value += p.stock_quantity || 0
      categoryMap[catName].cost += (p.stock_quantity || 0) * (p.cost_price || 0)
    })

    // Top products by stock value
    const topByValue = products
      .map(p => ({
        id: p.id,
        name: p.name,
        stock: p.stock_quantity,
        costPrice: p.cost_price || 0,
        sellPrice: p.price || 0,
        totalCost: (p.stock_quantity || 0) * (p.cost_price || 0),
        totalValue: (p.stock_quantity || 0) * (p.price || 0),
      }))
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, 10)

    res.json({
      totalProducts,
      lowStockCount,
      lowStockProducts,
      totalValue,
      totalCost,
      potentialProfit,
      categoryBreakdown: Object.values(categoryMap),
      topByValue
    })
  } catch (err) {
    next(err)
  }
})

// Get expenses summary
router.get('/expenses', async (req, res, next) => {
  try {
    const { range = 'month' } = req.query
    const now = new Date()
    let startDate

    switch (range) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        break
      case 'week':
        startDate = new Date(now.setDate(now.getDate() - 7))
        break
      case 'month':
        startDate = new Date(now.setMonth(now.getMonth() - 1))
        break
      case 'year':
        startDate = new Date(now.setFullYear(now.getFullYear() - 1))
        break
      default:
        startDate = new Date(now.setMonth(now.getMonth() - 1))
    }

    let expensesQuery = supabase
      .from('expenses')
      .select('*')
      .eq('tenant_id', req.user.tenantId)
      .gte('created_at', startDate.toISOString())
    if (req.branchId) expensesQuery = expensesQuery.eq('branch_id', req.branchId)

    const { data: expenses, error } = await expensesQuery

    if (error) throw error

    const safeExpenses = expenses || []

    const totalExpenses = safeExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0)

    const categoryMap = {}
    safeExpenses.forEach(e => {
      const cat = e.category || 'Other'
      if (!categoryMap[cat]) categoryMap[cat] = { name: cat, total: 0 }
      categoryMap[cat].total += parseFloat(e.amount) || 0
    })

    const dailyExpenses = []
    const daysInRange = Math.ceil((new Date() - startDate) / (1000 * 60 * 60 * 24))
    for (let i = 0; i < Math.min(daysInRange, 30); i++) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0]
      const dayTotal = safeExpenses
        .filter(e => e.created_at?.startsWith(dateStr))
        .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0)
      dailyExpenses.unshift({ date: dateStr, expenses: dayTotal })
    }

    res.json({
      totalExpenses,
      expenseCount: safeExpenses.length,
      categoryBreakdown: Object.values(categoryMap).sort((a, b) => b.total - a.total),
      dailyExpenses
    })
  } catch (err) {
    next(err)
  }
})

// Get profit/loss summary
router.get('/profit-loss', async (req, res, next) => {
  try {
    const { range = 'month' } = req.query
    const now = new Date()
    let startDate

    switch (range) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        break
      case 'week':
        startDate = new Date(now.setDate(now.getDate() - 7))
        break
      case 'month':
        startDate = new Date(now.setMonth(now.getMonth() - 1))
        break
      case 'year':
        startDate = new Date(now.setFullYear(now.getFullYear() - 1))
        break
      default:
        startDate = new Date(now.setMonth(now.getMonth() - 1))
    }

    // Branch-scoped P&L: orders/expenses filter directly; refunds carry no
    // branch_id, so when a branch is active they join through their order
    // (inner) — only refunds against THIS branch's orders count here.
    const branchId = req.branchId
    const ordersQ = branchScoped(
      supabase.from('orders').select('total, created_at').eq('tenant_id', req.user.tenantId).gte('created_at', startDate.toISOString()),
      branchId
    )
    const expensesQ = branchScoped(
      supabase.from('expenses').select('amount, created_at').eq('tenant_id', req.user.tenantId).gte('created_at', startDate.toISOString()),
      branchId
    )
    const refundsBase = supabase.from('refunds').select('amount, created_at').eq('tenant_id', req.user.tenantId).gte('created_at', startDate.toISOString())
    const refundsQ = branchId
      ? supabase
          .from('refunds')
          .select('amount, created_at, orders!inner(branch_id)')
          .eq('tenant_id', req.user.tenantId)
          .gte('created_at', startDate.toISOString())
          .eq('orders.branch_id', branchId)
      : refundsBase

    const [ordersRes, expensesRes, refundsRes] = await Promise.all([ordersQ, expensesQ, refundsQ])

    const orders = ordersRes.data || []
    const expenses = expensesRes.data || []
    const refunds = refundsRes.data || []

    const totalRevenue = orders.reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0)
    const totalExpenses = expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0)
    const totalRefunds = refunds.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0)
    const netRevenue = totalRevenue - totalRefunds
    const grossProfit = netRevenue - totalExpenses

    res.json({
      totalRevenue,
      totalExpenses,
      totalRefunds,
      netRevenue,
      grossProfit,
      orderCount: orders.length,
      expenseCount: expenses.length,
      refundCount: refunds.length,
      margin: netRevenue > 0 ? ((grossProfit / netRevenue) * 100).toFixed(1) : 0
    })
  } catch (err) {
    next(err)
  }
})

// Dead Stock Report - products not sold in X days
router.get('/dead-stock', async (req, res, next) => {
  try {
    const { days = 90, from_date, to_date, category_id, category } = req.query

    // Resolve category name to category_id if needed
    let resolvedCategoryId = category_id
    if (category && !category_id) {
      const { data: cat } = await supabase
        .from('categories')
        .select('id')
        .eq('tenant_id', req.user.tenantId)
        .eq('name', category)
        .limit(1)
        .maybeSingle()
      if (cat) resolvedCategoryId = cat.id
    }

    // Support both from_date/to_date (from client) and days fallback
    let cutoffDate
    if (from_date) {
      cutoffDate = new Date(from_date)
    } else {
      cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - parseInt(days))
    }
    const cutoffStr = cutoffDate.toISOString()

    // Get all products with stock > 0
    let productQuery = supabase
      .from('products')
      .select('id, name, sku, stock_quantity, cost_price, price, category_id, categories(name)')
      .eq('tenant_id', req.user.tenantId)
      .gt('stock_quantity', 0)

    if (resolvedCategoryId) {
      productQuery = productQuery.eq('category_id', resolvedCategoryId)
    }

    let { data: products, error: prodErr } = await productQuery
    if (prodErr) throw prodErr

    // Re-check "in stock" against the ACTIVE BRANCH — the query's
    // stock_quantity > 0 pre-filter ran on totals, and a product can hold
    // stock centrally but none here.
    await overlayBranchStock(products, req.user.tenantId, req.branchId)
    products = (products || []).filter(p => (p.stock_quantity || 0) > 0)

    if (products.length === 0) {
      return res.json({ items: [], total_items: 0, total_value: 0 })
    }

    // Get order IDs created after cutoff (recent orders) — branch-scoped so
    // "recently sold" means sold AT THIS LOCATION.
    let recentOrdersQuery = supabase
      .from('orders')
      .select('id')
      .eq('tenant_id', req.user.tenantId)
      .gt('created_at', cutoffStr)
    if (req.branchId) recentOrdersQuery = recentOrdersQuery.eq('branch_id', req.branchId)
    const { data: recentOrders } = await recentOrdersQuery

    const recentOrderIds = (recentOrders || []).map(o => o.id)

    // Get product IDs that were sold in recent orders
    let recentlySoldIds = new Set()
    if (recentOrderIds.length > 0) {
      // Query in batches of 100 to avoid URL length issues
      for (let i = 0; i < recentOrderIds.length; i += 100) {
        const batch = recentOrderIds.slice(i, i + 100)
        const { data: recentItems } = await supabase
          .from('order_items')
          .select('product_id')
          .in('order_id', batch)
        ;(recentItems || []).forEach(item => recentlySoldIds.add(item.product_id))
      }
    }

    // Get last sale date for each product
    // First get all orders before cutoff (branch-scoped)
    let oldOrdersQuery = supabase
      .from('orders')
      .select('id, created_at')
      .eq('tenant_id', req.user.tenantId)
      .lte('created_at', cutoffStr)
      .order('created_at', { ascending: false })
    if (req.branchId) oldOrdersQuery = oldOrdersQuery.eq('branch_id', req.branchId)
    const { data: oldOrders } = await oldOrdersQuery

    const oldOrderIds = (oldOrders || []).map(o => o.id)
    const orderDateMap = {}
    ;(oldOrders || []).forEach(o => { orderDateMap[o.id] = o.created_at })

    // Build map of last sale per product from old orders
    const lastSaleMap = {}
    if (oldOrderIds.length > 0) {
      for (let i = 0; i < oldOrderIds.length; i += 100) {
        const batch = oldOrderIds.slice(i, i + 100)
        const { data: oldItems } = await supabase
          .from('order_items')
          .select('product_id, order_id')
          .in('order_id', batch)

        ;(oldItems || []).forEach(item => {
          if (!lastSaleMap[item.product_id]) {
            lastSaleMap[item.product_id] = orderDateMap[item.order_id]
          }
        })
      }
    }

    // Dead stock = products with stock > 0 but NOT sold recently
    const deadStock = (products || [])
      .filter(p => !recentlySoldIds.has(p.id))
      .map(p => ({
        id: p.id,
        product_name: p.name,
        sku: p.sku,
        stock_quantity: p.stock_quantity,
        current_stock: p.stock_quantity,
        cost_price: p.cost_price,
        price: p.price,
        cost: p.cost_price,
        category: p.categories?.name || null,
        last_sold: lastSaleMap[p.id] || null,
        last_sold_date: lastSaleMap[p.id] || null,
        days_since_sale: lastSaleMap[p.id]
          ? Math.floor((Date.now() - new Date(lastSaleMap[p.id]).getTime()) / (1000 * 60 * 60 * 24))
          : null,
        stock_value: Math.round((p.stock_quantity || 0) * (p.cost_price || 0) * 100) / 100,
      }))
      .sort((a, b) => (b.days_since_sale || 999) - (a.days_since_sale || 999))

    const totalValue = deadStock.reduce((sum, p) => sum + p.stock_value, 0)

    res.json({ items: deadStock, total_items: deadStock.length, total_value: Math.round(totalValue * 100) / 100 })
  } catch (err) {
    next(err)
  }
})

export default router
