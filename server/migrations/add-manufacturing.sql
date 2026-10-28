-- ============================================================
-- MIGRATION: Manufacturing (MRP) module
-- Run in Supabase SQL Editor (user-applied, per project rules).
--
-- Adds 8 tenant-scoped tables + the atomic completion RPC, modeled on
-- the house patterns in create_branches.sql:
--   * mfg_complete_order() mirrors execute_stock_transfer(): locks the
--     source product_stock rows FOR UPDATE so concurrent POS sales can
--     never spend the same unit twice, raises typed codes
--     (ORDER_NOT_FOUND / ORDER_STATE / ORDER_EMPTY / ORDER_INVALID /
--     STOCK_INSUFFICIENT) that the API maps to 4xx, and rolls everything
--     back on failure (stock + order state are one transaction).
--   * adjust_product_stock() is reused for every branch write, so the
--     products.stock_quantity = sum(branch rows) invariant holds.
--   * Deny-all RLS (RLS on, no policies) on all 8 tables — access goes
--     through the service role only, same posture as branches/
--     product_stock/stock_transfers.
--   * Stock movement types added: production_out (components),
--     production_scrap (yield loss), production_in (finished goods).
--
-- After apply, verify:
--   * \df mfg_complete_order  -> argument list matches the JS call
--     (13 params, order matters), EXECUTE granted to service_role only.
--   * One active BOM per product per tenant (partial unique index).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Bills of Materials (recipes / assemblies)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bills_of_materials (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  output_quantity NUMERIC NOT NULL DEFAULT 1 CHECK (output_quantity > 0),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'archived')),
  version INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_boms_tenant_product
  ON bills_of_materials(tenant_id, product_id);
CREATE INDEX IF NOT EXISTS idx_boms_tenant_status
  ON bills_of_materials(tenant_id, status);
-- Odoo rule: one ACTIVE recipe per product; drafts/archives may stack.
CREATE UNIQUE INDEX IF NOT EXISTS idx_boms_one_active_per_product
  ON bills_of_materials(tenant_id, product_id) WHERE status = 'active';

-- ------------------------------------------------------------
-- 2. BOM components (+ by-products, yield loss)
--    is_byproduct rows are OUTPUTS, not inputs: they are produced by
--    the run (quantity = units produced per output_quantity of the main
--    product). Their stock lands via production_in like the main output;
--    their value stays with the main product in v1.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bom_items (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bom_id BIGINT NOT NULL REFERENCES bills_of_materials(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  -- percent of extra consumption to cover yield loss (10 = +10%)
  waste_factor NUMERIC NOT NULL DEFAULT 0
    CHECK (waste_factor >= 0 AND waste_factor < 100),
  is_byproduct BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bom_items_bom ON bom_items(bom_id);
CREATE INDEX IF NOT EXISTS idx_bom_items_tenant ON bom_items(tenant_id);

-- ------------------------------------------------------------
-- 3. Work centers (machines / stations with an hourly cost)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_centers (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cost_per_hour NUMERIC NOT NULL DEFAULT 0 CHECK (cost_per_hour >= 0),
  time_efficiency NUMERIC NOT NULL DEFAULT 100 CHECK (time_efficiency > 0),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_work_centers_tenant ON work_centers(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_centers_tenant_name
  ON work_centers(tenant_id, name);

-- ------------------------------------------------------------
-- 4. BOM operations (routings): the ordered steps of a recipe
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bom_operations (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bom_id BIGINT NOT NULL REFERENCES bills_of_materials(id) ON DELETE CASCADE,
  work_center_id BIGINT REFERENCES work_centers(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  expected_minutes NUMERIC NOT NULL DEFAULT 0 CHECK (expected_minutes >= 0),
  description TEXT
);
CREATE INDEX IF NOT EXISTS idx_bom_operations_bom ON bom_operations(bom_id);

-- ------------------------------------------------------------
-- 5. Production orders (MO)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS production_orders (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  bom_id BIGINT REFERENCES bills_of_materials(id) ON DELETE SET NULL,
  branch_id BIGINT REFERENCES branches(id) ON DELETE SET NULL,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  quantity_produced NUMERIC NOT NULL DEFAULT 0 CHECK (quantity_produced >= 0),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'confirmed', 'in_progress', 'paused',
                      'quality_check', 'done', 'cancelled')),
  component_cost NUMERIC NOT NULL DEFAULT 0,
  operations_cost NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  journal_entry_id BIGINT REFERENCES journal_entries(id) ON DELETE SET NULL,
  notes TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_mfg_order_number UNIQUE (tenant_id, order_number)
);
CREATE INDEX IF NOT EXISTS idx_mfg_orders_tenant_status
  ON production_orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_mfg_orders_tenant_created
  ON production_orders(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mfg_orders_product ON production_orders(product_id);

-- ------------------------------------------------------------
-- 6. Production order components (frozen at start, consumed at done)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS production_order_items (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity_planned NUMERIC NOT NULL DEFAULT 0 CHECK (quantity_planned >= 0),
  quantity_consumed NUMERIC NOT NULL DEFAULT 0 CHECK (quantity_consumed >= 0),
  scrap_quantity NUMERIC NOT NULL DEFAULT 0 CHECK (scrap_quantity >= 0),
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  is_byproduct BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_mfg_items_order ON production_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_mfg_items_tenant ON production_order_items(tenant_id);

-- ------------------------------------------------------------
-- 7. Work orders (one runtime instance per routing step)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_orders (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  work_center_id BIGINT REFERENCES work_centers(id) ON DELETE SET NULL,
  sequence INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'skipped')),
  expected_minutes NUMERIC NOT NULL DEFAULT 0 CHECK (expected_minutes >= 0),
  actual_minutes NUMERIC NOT NULL DEFAULT 0 CHECK (actual_minutes >= 0),
  assigned_to BIGINT REFERENCES employees(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_work_orders_order ON work_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(tenant_id, status);

-- ------------------------------------------------------------
-- 8. Quality checks (gate before done)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quality_checks (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  work_order_id BIGINT REFERENCES work_orders(id) ON DELETE SET NULL,
  check_name TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'pending'
    CHECK (result IN ('pending', 'pass', 'fail')),
  quantity_passed NUMERIC NOT NULL DEFAULT 0 CHECK (quantity_passed >= 0),
  quantity_failed NUMERIC NOT NULL DEFAULT 0 CHECK (quantity_failed >= 0),
  inspector TEXT,
  notes TEXT,
  checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quality_checks_order ON quality_checks(order_id);
CREATE INDEX IF NOT EXISTS idx_quality_checks_tenant
  ON quality_checks(tenant_id, result);

-- ------------------------------------------------------------
-- mfg_complete_order(): atomic completion.
--   Consumes components + waste, produces finished output, finalizes
--   the order (status/costs) — one transaction. QC gate and cost
--   computation happen app-side BEFORE the call; GL posting happens
--   AFTER success (house style: accounting failures log, never block).
--
--   p_items  [{product_id, quantity, unit_cost}]  planned components
--   p_scrap  [{product_id, quantity, unit_cost}]  yield loss (extra out)
--   p_output [{product_id, quantity}]             finished + by-products
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mfg_complete_order(
  p_tenant_id bigint,
  p_order_id bigint,
  p_branch_id bigint,
  p_items jsonb,
  p_scrap jsonb,
  p_output jsonb,
  p_quantity_produced numeric,
  p_component_cost numeric,
  p_operations_cost numeric,
  p_total_cost numeric,
  p_unit_cost numeric,
  p_notes text,
  p_user_id bigint
) RETURNS bigint
LANGUAGE plpgsql
AS $function$
declare
  v_order record;
  v_item jsonb;
  v_pid bigint;
  v_qty numeric;
  v_avail numeric;

  -- One component write: branch path goes through adjust_product_stock,
  -- legacy path (no branch) locks the product total row directly.
  procedure apply_delta(p_pid bigint, p_delta numeric) is
  begin
    if p_branch_id is not null then
      select quantity into v_avail
        from public.product_stock
       where tenant_id = p_tenant_id and product_id = p_pid
         and branch_id = p_branch_id
         for update;
      if coalesce(v_avail, 0) + p_delta < 0 then
        raise exception 'STOCK_INSUFFICIENT';
      end if;
      perform public.adjust_product_stock(p_tenant_id, p_pid, p_branch_id, p_delta);
    else
      select stock_quantity into v_avail
        from public.products
       where id = p_pid and tenant_id = p_tenant_id
         for update;
      if not found then
        raise exception 'ORDER_INVALID';
      end if;
      if coalesce(v_avail, 0) + p_delta < 0 then
        raise exception 'STOCK_INSUFFICIENT';
      end if;
      update public.products
         set stock_quantity = stock_quantity + p_delta,
             updated_at = now()
       where id = p_pid and tenant_id = p_tenant_id;
    end if;
  end;
begin
  select * into v_order
    from public.production_orders
   where id = p_order_id and tenant_id = p_tenant_id
     for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if v_order.status not in ('confirmed', 'in_progress', 'paused', 'quality_check') then
    raise exception 'ORDER_STATE';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'ORDER_EMPTY';
  end if;
  if p_quantity_produced is null or p_quantity_produced < 0 then
    raise exception 'ORDER_INVALID';
  end if;

  -- Planned components (production_out)
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := (v_item->>'product_id')::bigint;
    v_qty := (v_item->>'quantity')::numeric;
    if v_pid is null or v_qty is null or v_qty <= 0 then
      raise exception 'ORDER_INVALID';
    end if;
    if not exists(select 1 from public.products
                   where id = v_pid and tenant_id = p_tenant_id) then
      raise exception 'ORDER_INVALID';
    end if;

    apply_delta(v_pid, -v_qty);

    insert into public.stock_movements
      (tenant_id, product_id, type, quantity, reference_id, notes, created_by, branch_id)
    values
      (p_tenant_id, v_pid, 'production_out', -v_qty, p_order_id,
       coalesce(p_notes, 'Production ' || v_order.order_number) || ' - components',
       coalesce(p_user_id::text, 'system'), p_branch_id);

    update public.production_order_items
       set quantity_consumed = v_qty,
           unit_cost = coalesce((v_item->>'unit_cost')::numeric, unit_cost)
     where order_id = p_order_id and product_id = v_pid and is_byproduct = false;
  end loop;

  -- Yield loss (production_scrap)
  if p_scrap is not null and jsonb_array_length(p_scrap) > 0 then
    for v_item in select * from jsonb_array_elements(p_scrap) loop
      v_pid := (v_item->>'product_id')::bigint;
      v_qty := (v_item->>'quantity')::numeric;
      if v_pid is null or v_qty is null or v_qty <= 0 then
        raise exception 'ORDER_INVALID';
      end if;
      if not exists(select 1 from public.products
                     where id = v_pid and tenant_id = p_tenant_id) then
        raise exception 'ORDER_INVALID';
      end if;

      apply_delta(v_pid, -v_qty);

      insert into public.stock_movements
        (tenant_id, product_id, type, quantity, reference_id, notes, created_by, branch_id)
      values
        (p_tenant_id, v_pid, 'production_scrap', -v_qty, p_order_id,
         coalesce(p_notes, 'Production ' || v_order.order_number) || ' - waste',
         coalesce(p_user_id::text, 'system'), p_branch_id);

      update public.production_order_items
         set scrap_quantity = v_qty
       where order_id = p_order_id and product_id = v_pid and is_byproduct = false;
    end loop;
  end if;

  -- Finished output + by-products (production_in)
  if p_output is null or jsonb_array_length(p_output) = 0 then
    raise exception 'ORDER_EMPTY';
  end if;
  for v_item in select * from jsonb_array_elements(p_output) loop
    v_pid := (v_item->>'product_id')::bigint;
    v_qty := (v_item->>'quantity')::numeric;
    if v_pid is null or v_qty is null or v_qty <= 0 then
      raise exception 'ORDER_INVALID';
    end if;
    if not exists(select 1 from public.products
                   where id = v_pid and tenant_id = p_tenant_id) then
      raise exception 'ORDER_INVALID';
    end if;

    apply_delta(v_pid, v_qty);

    insert into public.stock_movements
      (tenant_id, product_id, type, quantity, reference_id, notes, created_by, branch_id)
    values
      (p_tenant_id, v_pid, 'production_in', v_qty, p_order_id,
       coalesce(p_notes, 'Production ' || v_order.order_number) || ' - output',
       coalesce(p_user_id::text, 'system'), p_branch_id);
  end loop;

  -- Finalize the order in the same transaction
  update public.production_orders
     set status = 'done',
         quantity_produced = p_quantity_produced,
         component_cost = p_component_cost,
         operations_cost = p_operations_cost,
         total_cost = p_total_cost,
         unit_cost = p_unit_cost,
         completed_at = now(),
         updated_at = now()
   where id = p_order_id and tenant_id = p_tenant_id;

  return p_order_id;
end;
$function$;
REVOKE EXECUTE ON FUNCTION public.mfg_complete_order(bigint, bigint, bigint, jsonb, jsonb, jsonb, numeric, numeric, numeric, numeric, numeric, text, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mfg_complete_order(bigint, bigint, bigint, jsonb, jsonb, jsonb, numeric, numeric, numeric, numeric, numeric, text, bigint)
  TO service_role;

-- ------------------------------------------------------------
-- Deny-all RLS on the new tables (service role only — matches
-- branches/product_stock/stock_transfers posture).
-- ------------------------------------------------------------
ALTER TABLE bills_of_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_checks ENABLE ROW LEVEL SECURITY;
