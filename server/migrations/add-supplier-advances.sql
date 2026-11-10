-- Supplier advances (prepayments) and PO deposits.
--
-- An advance is money paid to a supplier before anything is owed: it posts
-- to asset account 1150 "Supplier Advances" (never to AP), and is consumed
-- FIFO against later supplier settlements -- the settlement debits AP in
-- full, credits 1150 for the applied part, and credits cash/bank for the
-- remainder (see payments.js + services/advanceLedger.js).

CREATE TABLE IF NOT EXISTS supplier_advances (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  consumed_amount NUMERIC NOT NULL DEFAULT 0,
  payment_id BIGINT REFERENCES payments(id) ON DELETE SET NULL,
  po_id BIGINT REFERENCES purchase_orders(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT consumed_within_amount CHECK (consumed_amount >= 0 AND consumed_amount <= amount)
);

CREATE INDEX IF NOT EXISTS idx_supplier_advances_tenant_supplier
  ON supplier_advances(tenant_id, supplier_id);

-- Tenant-scoped, same pattern as the core tables in supabase-schema.sql.
-- The server talks to PostgREST with the service key, which bypasses RLS;
-- this is deny-by-default for any other key.
ALTER TABLE supplier_advances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON supplier_advances;
CREATE POLICY "tenant_isolation" ON supplier_advances
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant', true)::bigint)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::bigint);

-- Account 1150 for tenants whose chart was seeded before this migration.
-- (New tenants get it from seedChartOfAccounts; the code also lazily
-- creates it on first use, so this row is belt-and-braces.)
INSERT INTO accounts (tenant_id, code, name, account_type)
SELECT t.id, '1150', 'Supplier Advances', 'asset'
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a WHERE a.tenant_id = t.id AND a.code = '1150'
);
