// Manufacturing (MRP) cost engine — pure functions, no I/O, unit-testable.
//
// Every number surfaced on an MO (component cost, conversion cost, per-unit
// cost, waste quantities) is computed here; routes only fetch rows and hand
// them over.
//
// Conventions:
//   * quantities: 4dp (matches how products.stock_quantity is used)
//   * money: 2dp, per-unit cost: 4dp
//   * a BOM expresses quantities per `output_quantity` of the main product;
//     an MO for `quantity` units therefore consumes `quantity /
//     output_quantity` BOM runs (outputScale).
//   * by-products are OUTPUTS (is_byproduct): they take stock, they are
//     never consumed, and their value stays with the main product in v1.

// Allowed MO state transitions. Anything not listed here is rejected with
// 409 ORDER_STATE — including on the RPC, which re-checks server-side.
export const TRANSITIONS = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['in_progress', 'cancelled'],
  in_progress: ['paused', 'quality_check', 'cancelled'],
  paused: ['in_progress', 'quality_check', 'cancelled'],
  quality_check: ['in_progress', 'done', 'cancelled'],
  done: [],
  cancelled: [],
}

// States from which completion is accepted. All imply the components were
// frozen at start; a failed run must be cancelled (nothing is consumed
// until completion, so cancel is always clean).
export const COMPLETABLE = ['in_progress', 'paused', 'quality_check']

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to)
}

export function round(n, dp = 4) {
  const f = 10 ** dp
  return Math.round((Number(n) + Number.EPSILON) * f) / f
}

export function money(n) {
  return round(n, 2)
}

/**
 * Sums rows that share a product_id (a BOM may list the same component on
 * two lines). The completion RPC matches production_order_items by
 * product_id and stock checks are per product, so payloads must be unique
 * per product.
 */
export function mergeByProduct(rows = []) {
  const map = new Map()
  for (const r of rows) {
    const key = Number(r.product_id)
    const prev = map.get(key)
    if (prev) {
      prev.quantity = round((Number(prev.quantity) || 0) + (Number(r.quantity) || 0))
      if (r.unit_cost !== undefined && prev.unit_cost === undefined) prev.unit_cost = r.unit_cost
    } else {
      map.set(key, { ...r, quantity: Number(r.quantity) || 0 })
    }
  }
  return [...map.values()]
}

/**
 * Plan an MO from its BOM (used at start — this is what gets frozen).
 *
 * @param {object}   args
 * @param {object}   args.bom          row with output_quantity
 * @param {Array}    args.items        bom_items rows (+ injected unit_cost)
 * @param {Array}    args.operations   bom_operations rows
 * @param {Array}    args.workCenters  work_centers rows
 * @param {number}   args.quantity     MO quantity (main product units)
 */
export function computeBomPlan({ bom = {}, items = [], operations = [], workCenters = [], quantity = 0 }) {
  const outputQuantity = Number(bom.output_quantity) || 1
  const qty = Number(quantity) || 0
  const outputScale = qty / outputQuantity

  const consumption = []
  const scrap = []
  const byproducts = []
  let componentCost = 0

  const inputs = mergeByProduct(items.filter((i) => !i.is_byproduct))
  for (const raw of inputs) {
    const planned = round((Number(raw.quantity) || 0) * outputScale)
    const waste = round(planned * (Number(raw.waste_factor) || 0) / 100)
    const unitCost = round(Number(raw.unit_cost) || 0)
    if (planned <= 0) continue
    componentCost += (planned + waste) * unitCost
    consumption.push({ product_id: raw.product_id, quantity: planned, unit_cost: unitCost })
    if (waste > 0) scrap.push({ product_id: raw.product_id, quantity: waste, unit_cost: unitCost })
  }

  for (const bp of mergeByProduct(items.filter((i) => i.is_byproduct))) {
    const made = round((Number(bp.quantity) || 0) * outputScale)
    if (made > 0) byproducts.push({ product_id: bp.product_id, quantity: made })
  }

  let operationsCost = 0
  for (const op of operations) {
    const wc = workCenters.find((w) => Number(w.id) === Number(op.work_center_id))
    const minutes = (Number(op.expected_minutes) || 0) * outputScale
    operationsCost += (minutes / 60) * (Number(wc && wc.cost_per_hour) || 0)
  }

  const totalCost = componentCost + operationsCost
  return {
    outputScale: round(outputScale, 6),
    consumption,
    scrap,
    byproducts,
    componentCost: money(componentCost),
    operationsCost: money(operationsCost),
    totalCost: money(totalCost),
    unitCost: qty > 0 ? round(totalCost / qty, 4) : 0,
  }
}

/**
 * Recompute costs from the FROZEN production_order_items at completion.
 * Planned/waste quantities come from the freeze (immune to later BOM
 * edits); work-center rates are read live (rates are operational data,
 * not part of the freeze).
 */
export function computeFrozenPlan({ items = [], workOrders = [], workCenters = [], quantity = 0, produced = 0 }) {
  const inputs = items.filter((i) => !i.is_byproduct)
  const consumption = []
  const scrap = []
  let componentCost = 0

  for (const row of inputs) {
    const planned = Number(row.quantity_planned) || 0
    const waste = Number(row.scrap_quantity) || 0
    const unitCost = round(Number(row.unit_cost) || 0)
    componentCost += (planned + waste) * unitCost
    if (planned > 0) consumption.push({ product_id: row.product_id, quantity: planned, unit_cost: unitCost })
    if (waste > 0) scrap.push({ product_id: row.product_id, quantity: waste, unit_cost: unitCost })
  }

  const byproducts = items
    .filter((i) => i.is_byproduct && (Number(i.quantity_planned) || 0) > 0)
    .map((i) => ({ product_id: i.product_id, quantity: round(Number(i.quantity_planned) || 0) }))

  // Skipped steps were not performed — their expected cost is not incurred.
  let operationsCost = 0
  for (const wo of workOrders) {
    if (wo.status === 'skipped') continue
    const wc = workCenters.find((w) => Number(w.id) === Number(wo.work_center_id))
    const minutes = Number(wo.expected_minutes) || 0
    operationsCost += (minutes / 60) * (Number(wc && wc.cost_per_hour) || 0)
  }

  const totalCost = componentCost + operationsCost
  return {
    consumption,
    scrap,
    byproducts,
    componentCost: money(componentCost),
    operationsCost: money(operationsCost),
    totalCost: money(totalCost),
    unitCost: produced > 0 ? round(totalCost / produced, 4) : 0,
  }
}

/**
 * Completion gate: every recorded check must be resolved and passing.
 * No checks at all is fine (QC is optional per order).
 */
export function qcGate(checks = []) {
  const pending = checks.filter((c) => c.result === 'pending').length
  const failed = checks.filter((c) => c.result === 'fail').length
  return { ok: pending === 0 && failed === 0, pending, failed }
}

/**
 * Completion gate: if the BOM has routings, every work order must be
 * finished or explicitly skipped first.
 */
export function workOrdersGate(workOrders = []) {
  const remaining = workOrders.filter((w) => w.status === 'pending' || w.status === 'running').length
  return { ok: remaining === 0, remaining }
}
