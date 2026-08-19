-- ============================================================
-- db_pos — Fase 2: Data & Produk (SPEC.md §3)
-- DDL idempotent — AMAN dijalankan berulang (CREATE IF NOT EXISTS /
-- ADD COLUMN IF NOT EXISTS). Dieksekusi oleh `bun run db:migrate`
-- SETELAH ddl.sql (tahap 2).
--
-- Perubahan vs skema Fase 1 (semua backward-compatible, §3.9):
--   products          +3 kolom (has_variants, track_stock, expiry_date)
--   transaction_items +3 kolom (product_variant_id, unit, unit_factor)
--   stock_movements   +1 kolom (product_variant_id)
--   6 tabel baru: product_variants, product_units, warehouses,
--                 warehouse_stocks, stock_transfers, stock_adjustments
--
-- Rollback (urutan terbalik): drop 6 tabel baru (stock_adjustments,
-- stock_transfers, warehouse_stocks, warehouses, product_units,
-- product_variants) lalu drop 8 kolom baru.
-- ============================================================

-- ---------- ALTER products (+3 kolom) ----------
ALTER TABLE products ADD COLUMN IF NOT EXISTS has_variants BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS track_stock  BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS expiry_date  DATE;

-- ---------- product_variants (tabel baru) ----------
CREATE TABLE IF NOT EXISTS product_variants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name           VARCHAR(200) NOT NULL,
  sku            VARCHAR(50),
  barcode        VARCHAR(100),
  cost_price     BIGINT NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  selling_price  BIGINT NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
  stock_on_hand  NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (stock_on_hand >= 0),
  min_stock      NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_variants_sku_active
  ON product_variants (sku) WHERE deleted_at IS NULL AND sku IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_variants_barcode_active
  ON product_variants (barcode) WHERE deleted_at IS NULL AND barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_variants_product
  ON product_variants (product_id, is_active);

-- ---------- ALTER transaction_items (+3 kolom, snapshot R1) ----------
-- unit/unit_factor berdefault sehingga baris lama otomatis valid ('pcs', 1).
ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS product_variant_id UUID
  REFERENCES product_variants(id) ON DELETE SET NULL;
ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS unit VARCHAR(20) NOT NULL DEFAULT 'pcs';
ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS unit_factor NUMERIC(12,3) NOT NULL DEFAULT 1
  CHECK (unit_factor > 0);

-- ---------- ALTER stock_movements (+1 kolom) ----------
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS product_variant_id UUID
  REFERENCES product_variants(id) ON DELETE SET NULL;

-- ---------- product_units (tabel baru, SPEC §3.3 — menggantikan unit_conversions) ----------
CREATE TABLE IF NOT EXISTS product_units (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit              VARCHAR(20) NOT NULL,
  factor            NUMERIC(12,3) NOT NULL CHECK (factor > 0),
  sell_price        BIGINT NOT NULL DEFAULT 0 CHECK (sell_price >= 0),
  is_sellable       BOOLEAN NOT NULL DEFAULT TRUE,
  is_purchase_unit  BOOLEAN NOT NULL DEFAULT FALSE,
  min_qty           NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (min_qty > 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_units_product_unit
  ON product_units (product_id, unit);
CREATE INDEX IF NOT EXISTS idx_product_units_product
  ON product_units (product_id);

-- ---------- warehouses (tabel baru, schema P0 — CRUD Fase 3) ----------
CREATE TABLE IF NOT EXISTS warehouses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(20) NOT NULL,
  name        VARCHAR(150) NOT NULL,
  address     TEXT,
  pic         VARCHAR(100),
  capacity    NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouses_code_active
  ON warehouses (code) WHERE deleted_at IS NULL;

-- ---------- warehouse_stocks (tabel baru, SPEC §3.7) ----------
CREATE TABLE IF NOT EXISTS warehouse_stocks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id       UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  product_id         UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity           NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  min_stock          NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Unique parsial: NULL variant tidak boleh bentrok dengan stok produk non-varian
CREATE UNIQUE INDEX IF NOT EXISTS uq_wh_stocks_product
  ON warehouse_stocks (warehouse_id, product_id) WHERE product_variant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wh_stocks_variant
  ON warehouse_stocks (warehouse_id, product_id, product_variant_id) WHERE product_variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wh_stocks_product
  ON warehouse_stocks (product_id);

-- ---------- stock_transfers (tabel baru, schema P0 — API Fase 3) ----------
CREATE TABLE IF NOT EXISTS stock_transfers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_warehouse_id  UUID NOT NULL REFERENCES warehouses(id),
  to_warehouse_id    UUID NOT NULL REFERENCES warehouses(id),
  product_id         UUID NOT NULL REFERENCES products(id),
  product_variant_id UUID REFERENCES product_variants(id),
  quantity           NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  notes              TEXT,
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_warehouse_id <> to_warehouse_id)
);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_from ON stock_transfers (from_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to   ON stock_transfers (to_warehouse_id);

-- ---------- stock_adjustments (tabel baru, schema P0 — API Fase 3) ----------
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id       UUID NOT NULL REFERENCES warehouses(id),
  product_id         UUID NOT NULL REFERENCES products(id),
  product_variant_id UUID REFERENCES product_variants(id),
  quantity_delta     NUMERIC(12,3) NOT NULL CHECK (quantity_delta <> 0),
  reason             VARCHAR(50) NOT NULL,
  note               TEXT,
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_wh ON stock_adjustments (warehouse_id);

-- ---------- Trigger updated_at untuk tabel baru ----------
-- set_updated_at() dibuat di ddl.sql (CREATE OR REPLACE) — aman dirujuk.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['product_variants', 'product_units', 'warehouses']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                   WHERE tgname = format('trg_%s_updated_at', t) AND tgrelid = format('%I', t)::regclass) THEN
      EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I
                      FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
    END IF;
  END LOOP;
END $$;

-- ---------- Verifikasi backfill (SPEC §8.2.3) ----------
-- Kolom baru berdefault, jadi tidak perlu backfill manual:
--   SELECT count(*) FROM transaction_items WHERE unit IS NULL;  -- harus 0
