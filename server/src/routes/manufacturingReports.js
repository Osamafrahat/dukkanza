import { Router } from 'express'
import supabase from '../db/supabase.js'

// Manufacturing reports — cost and yield over completed runs. Read-only,
// tenant-scoped, date-range optional (ISO YYYY-MM-DD, completed_at based).

const router = Router()

function parseRange(req) {
  const out = {}
  if (req.query.from) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from))) return { error: 'Invalid from (YYYY-MM-DD)' }
    out.from = String(req.query.from)
  }
  if (req.query.to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to))) return { error: 'Invalid to (YYYY-MM-DD)' }
    out.to = String(req.query.to)
  }
  return out
}

function applyRange(query, range) {
  if (range.from) query = query.gte('completed_at', `${range.from}T00:00:00.000Z`)
  if (range.to) query = query.lte('completed_at', `${range.to}T23:59:59.999Z`)
  return query
}

const sum = (rows, key) => Math.round(rows.reduce((a, r) => a + (Number(r[key]) || 0), 0) * 100) / 100

// Per-order cost breakdown for completed runs + totals
router.get('/costs', async (req, res, next) => {
  try {
    const range = parseRange(req)
    if (range.error) return res.status(400).json({ error: range.error })
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200)

    let query = supabase
      .from('production_orders')
      .select('id, order_number, product_id, products(name, sku), quantity, quantity_produced, component_cost, operations_cost, total_cost, unit_cost, completed_at')
      .eq('tenant_id', req.user?.tenantId)
      .eq('status', 'done')
      .order('completed_at', { ascending: false })
      .limit(limit)
    query = applyRange(query, range)

    const { data, error } = await query
    if (error) throw error
    const orders = data || []

    res.json({
      orders,
      totals: {
        runs: orders.length,
        planned: Math.round(orders.reduce((a, r) => a + (Number(r.quantity) || 0), 0) * 100) / 100,
        produced: Math.round(orders.reduce((a, r) => a + (Number(r.quantity_produced) || 0), 0) * 100) / 100,
        componentCost: sum(orders, 'component_cost'),
        operationsCost: sum(orders, 'operations_cost'),
        totalCost: sum(orders, 'total_cost'),
      },
    })
  } catch (err) {
    next(err)
  }
})

// Yield: planned vs produced vs wasted, across completed runs
router.get('/yield', async (req, res, next) => {
  try {
    const range = parseRange(req)
    if (range.error) return res.status(400).json({ error: range.error })

    let query = supabase
      .from('production_orders')
      .select('id, quantity, quantity_produced, completed_at')
      .eq('tenant_id', req.user?.tenantId)
      .eq('status', 'done')
      .order('completed_at', { ascending: false })
      .limit(500)
    query = applyRange(query, range)

    const { data, error } = await query
    if (error) throw error
    const orders = data || []

    // Scrap value comes from the frozen rows of those runs
    let scrapValue = 0
    if (orders.length > 0) {
      const { data: items, error: itemsErr } = await supabase
        .from('production_order_items')
        .select('scrap_quantity, unit_cost')
        .eq('tenant_id', req.user?.tenantId)
        .in('order_id', orders.map((o) => o.id))
      if (itemsErr) throw itemsErr
      scrapValue = Math.round((items || []).reduce(
        (a, i) => a + (Number(i.scrap_quantity) || 0) * (Number(i.unit_cost) || 0), 0,
      ) * 100) / 100
    }

    const planned = orders.reduce((a, r) => a + (Number(r.quantity) || 0), 0)
    const produced = orders.reduce((a, r) => a + (Number(r.quantity_produced) || 0), 0)

    res.json({
      runs: orders.length,
      planned,
      produced,
      yieldPercent: planned > 0 ? Math.round((produced / planned) * 10000) / 100 : 0,
      scrapValue,
    })
  } catch (err) {
    next(err)
  }
})

export default router
