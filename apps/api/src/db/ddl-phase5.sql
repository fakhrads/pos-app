-- ============================================================================
-- FASE 5: Laporan & Dashboard — DDL idempotent (Fase 5, SPEC §4 / §8)
--
-- Isi:
--  1. Enum baru `cash_movement_direction` ('in','out')
--  2. Tabel baru `cash_movements` (kas masuk/keluar manual — SPEC F5-6)
--  3. Index pendukung laporan stok / dead stock
--  4. Settings default laporan & dead stock
--
-- Semua pernyataan IDEMPOTENT (IF NOT EXISTS / ON CONFLICT DO NOTHING) —
-- aman dijalankan ulang berulang kali (pola Fase 3/4).
-- ============================================================================

-- ---------- 1. Enum cash_movement_direction ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cash_movement_direction') THEN
    CREATE TYPE cash_movement_direction AS ENUM ('in', 'out');
  END IF;
END $$;

-- ---------- 2. Tabel cash_movements ----------
CREATE TABLE IF NOT EXISTS cash_movements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id    BIGINT NOT NULL DEFAULT 1,
  direction    cash_movement_direction NOT NULL,      -- 'in' kas masuk | 'out' kas keluar
  amount       BIGINT NOT NULL CHECK (amount > 0),    -- integer rupiah
  method       payment_method NOT NULL DEFAULT 'cash',-- reuse enum payment_method (cash/qris/transfer)
  category     VARCHAR(50),                           -- opsional: 'setoran', 'prive', 'operasional', dll
  note         TEXT,
  reference    VARCHAR(100),
  movement_at  TIMESTAMPTZ NOT NULL DEFAULT now(),    -- tanggal mutasi (default now)
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_movements_movement_at ON cash_movements (movement_at);
CREATE INDEX IF NOT EXISTS idx_cash_movements_direction    ON cash_movements (direction);
CREATE INDEX IF NOT EXISTS idx_cash_movements_created_by   ON cash_movements (created_by);

-- ---------- 3. Index pendukung laporan ----------
-- Laporan nilai persediaan / dead stock: agregasi warehouse_stocks per produk
CREATE INDEX IF NOT EXISTS idx_warehouse_stocks_product_qty
  ON warehouse_stocks (product_id, quantity);

-- Jenis mutasi (kartu stok / laporan stok)
CREATE INDEX IF NOT EXISTS idx_stock_movements_type
  ON stock_movements (type, created_at);

-- ---------- 4. Settings default Fase 5 ----------
INSERT INTO settings (key, value, description, updated_at) VALUES
  ('report.deadstock_days',      '90',                 'Baris dead stock = produk aktif yang TIDAK terjual dalam N hari terakhir (default 90).', now()),
  ('report.inventory_valuation', '"cost"',             'Metode nilai persediaan: cost (harga beli) atau selling (harga jual).', now()),
  ('cash.category_defaults',     '["setoran","prive","operasional","lainnya"]',
                                     'Daftar kategori kas masuk/keluar yang ditawarkan frontend (bebas teks).', now())
ON CONFLICT (key) DO NOTHING;

-- ---------- Verifikasi (SPEC §8) ----------
--   SELECT count(*) FROM cash_movements;             -- 0 baris (tabel baru)
--   SELECT typname FROM pg_type WHERE typname = 'cash_movement_direction';
--   SELECT key FROM settings WHERE key LIKE 'report.%' OR key LIKE 'cash.%';
