-- ============================================================
-- db_pos — Fase 3: Stok & Gudang (SPEC.md §3, §8.2)
-- DDL idempotent — AMAN dijalankan berulang. Dieksekusi oleh
-- `bun run db:migrate` SETELAH ddl-phase2.sql (tahap 3).
--
-- Perubahan vs skema Fase 2 (semua non-breaking, §3.5):
--   movement_type     +2 nilai enum: transfer_out, transfer_in
--   stock_movements   +1 kolom: warehouse_id (NULL, FK SET NULL) + index
--   stock_transfers   +1 kolom: transfer_number (VARCHAR(30) NOT NULL) + 2 index
--   settings          +1 key: stock.default_warehouse_id
--
-- Catatan PostgreSQL (SPEC §8.2.1): ALTER TYPE ... ADD VALUE tidak bisa
-- memakai nilai baru di transaksi yang sama — migrasi ini TIDAK menulis
-- baris dengan tipe transfer_* (backfill hanya warehouse_id/transfer_number),
-- jadi aman dieksekusi dalam satu implicit transaction. Dua ADD VALUE untuk
-- type yang sama dalam satu transaksi aman di PostgreSQL 12+.
--
-- Rollback (SPEC §8.2.7): drop index & kolom baru; nilai enum tidak bisa
-- di-drop (rekomendasi: biarkan — harmless).
-- ============================================================

-- ---------- ALTER TYPE movement_type (+2 nilai) ----------
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'transfer_out';
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'transfer_in';

-- ---------- ALTER stock_movements (+1 kolom warehouse_id) ----------
-- NULL hanya untuk baris legacy yang gagal backfill (tidak boleh terjadi).
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS warehouse_id UUID
  REFERENCES warehouses(id) ON DELETE SET NULL;

-- Backfill: seluruh baris existing → gudang default saat migrasi
-- (settings['stock.default_warehouse_id'] bila ada, else gudang aktif pertama
-- urut created_at ASC — konsisten invariant seed Fase 2: seluruh stok di
-- gudang pertama). Konsisten dengan §3.1 & AC-05.6.
UPDATE stock_movements
SET warehouse_id = COALESCE(
  (SELECT (value #>> '{}')::uuid FROM settings WHERE key = 'stock.default_warehouse_id' LIMIT 1),
  (SELECT id FROM warehouses
   WHERE deleted_at IS NULL AND is_active
   ORDER BY created_at ASC LIMIT 1)
)
WHERE warehouse_id IS NULL;

-- Index kartu stok per gudang (F3-5, §3.1)
CREATE INDEX IF NOT EXISTS idx_stock_movements_wh_product
  ON stock_movements (warehouse_id, product_id, created_at);

-- ---------- ALTER stock_transfers (+1 kolom transfer_number) ----------
-- Satu nomor = satu dokumen transfer multi-item (n baris berbagi nomor).
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS transfer_number VARCHAR(30);

-- Backfill data dev (seed Fase 2 = 0 baris): generate TRF-YYYYMMDD-XXXX
-- berurutan per tanggal (pola lib/sequence.ts).
DO $$
DECLARE
  r RECORD;
  seq INTEGER;
  d TEXT;
BEGIN
  FOR r IN
    SELECT st.id, st.created_at,
           row_number() OVER (PARTITION BY to_char(st.created_at AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD')
                              ORDER BY st.created_at, st.id) AS rn
    FROM stock_transfers st
    WHERE st.transfer_number IS NULL
    ORDER BY st.created_at, st.id
  LOOP
    d := to_char(r.created_at AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD');
    UPDATE stock_transfers SET transfer_number = 'TRF-' || d || '-' || lpad(r.rn::text, 4, '0')
    WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE stock_transfers ALTER COLUMN transfer_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_transfers_number ON stock_transfers (transfer_number);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_number_created
  ON stock_transfers (transfer_number, created_at);

-- ---------- settings: key stock.default_warehouse_id (bukan skema) ----------
-- Gudang penjualan: sale_out/return_in/cancellation & PATCH /products/:id/stock
-- memotong/menambah stok gudang ini. Bila key sudah ada → biarkan (ON CONFLICT).
INSERT INTO settings (id, key, value, description, updated_at)
SELECT gen_random_uuid(),
       'stock.default_warehouse_id',
       to_jsonb(w.id),
       'Gudang penjualan default — dikelola via POST /warehouses/:id/default',
       now()
FROM warehouses w
WHERE w.deleted_at IS NULL AND w.is_active
ORDER BY w.created_at ASC
LIMIT 1
ON CONFLICT (key) DO NOTHING;

-- ---------- Verifikasi backfill (SPEC §8.2.3) ----------
--   SELECT count(*) FROM stock_movements WHERE warehouse_id IS NULL;   -- 0
--   SELECT count(*) FROM stock_transfers WHERE transfer_number IS NULL; -- 0
