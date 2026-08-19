-- ============================================================================
-- FASE 7: Offline / PWA — DDL idempotent (Fase 7, SPEC §3.2 / §4)
--
-- Isi:
--  1. Enum baru `transaction_source` ('online','offline')
--  2. Kolom baru `transactions.source` (default 'online', backward-compatible)
--  3. Index pendukung filter transaksi offline (`idx_transactions_source`)
--  4. Settings default offline (SPEC §3.2): offline.enabled, offline.auto_sync,
--     offline.sync_mode, offline.stale_after_days
--
-- Semua pernyataan IDEMPOTENT (IF NOT EXISTS / DO $$ guard / ON CONFLICT
-- DO NOTHING) — aman dijalankan ulang berkali-kali (pola Fase 3/4/5).
-- ============================================================================

-- ---------- 1. Enum transaction_source ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_source') THEN
    CREATE TYPE transaction_source AS ENUM ('online', 'offline');
  END IF;
END $$;

-- ---------- 2. Kolom transactions.source ----------
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS source transaction_source NOT NULL DEFAULT 'online';

-- ---------- 3. Index filter transaksi offline ----------
CREATE INDEX IF NOT EXISTS idx_transactions_source ON transactions (source);

-- ---------- 4. Settings default Fase 7 ----------
INSERT INTO settings (key, value, description, updated_at) VALUES
  ('offline.enabled',          'true',           'Mode offline aktif: SW menyimpan katalog & kasir bisa transaksi offline (default true).', now()),
  ('offline.auto_sync',        'true',           'Background sync otomatis saat koneksi pulih (default true).', now()),
  ('offline.sync_mode',        '"auto"',         'Cara sinkronisasi: auto (otomatis saat online) atau manual (tombol Sync Now).', now()),
  ('offline.stale_after_days', '14',             'Cache katalog dianggap basi setelah N hari tanpa pull (default 14).', now())
ON CONFLICT (key) DO NOTHING;

-- ---------- Verifikasi (SPEC §8) ----------
--   SELECT typname FROM pg_type WHERE typname = 'transaction_source';
--   SELECT column_name, data_type, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'transactions' AND column_name = 'source';
--   SELECT key FROM settings WHERE key LIKE 'offline.%';
