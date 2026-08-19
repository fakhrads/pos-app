-- ============================================================
-- db_pos — Fase 4: Kasir / Mobile POS (SPEC.md §3, §8.2)
-- DDL idempotent — AMAN dijalankan berulang. Dieksekusi oleh
-- `bun run db:migrate` SETELAH ddl-phase3.sql (tahap 4).
--
-- Perubahan vs skema Fase 3 (semua non-breaking, §3.5):
--   enum baru        shift_status ('open', 'closed')
--   tabel baru       shifts      (SPEC §3.2 — snapshot statistik saat close)
--   tabel baru       held_carts  (SPEC §3.3 — snapshot JSONB tanpa harga)
--   settings         +7 key baru (SPEC §3.4)
--
-- TIDAK ada ALTER tabel existing (keputusan §1.3.3 — atribusi shift
-- via window waktu [opened_at, closed_at), bukan kolom shift_id).
--
-- Rollback (SPEC §8.2.8): drop held_carts, shifts, drop type
-- shift_status (urut terbalik; drop type butuh tabel kosong).
-- ============================================================

-- ---------- Enum shift_status (idempotent) ----------
DO $$
BEGIN
  CREATE TYPE shift_status AS ENUM ('open', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------- Tabel shifts (SPEC §3.2) ----------
CREATE TABLE IF NOT EXISTS shifts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_number      VARCHAR(30) NOT NULL,
  outlet_id         BIGINT NOT NULL DEFAULT 1,
  user_id           UUID NOT NULL REFERENCES users(id),
  status            shift_status NOT NULL DEFAULT 'open',
  opened_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at         TIMESTAMPTZ,
  opening_cash      BIGINT NOT NULL DEFAULT 0,
  cash_sales        BIGINT NOT NULL DEFAULT 0,
  qris_sales        BIGINT NOT NULL DEFAULT 0,
  transfer_sales    BIGINT NOT NULL DEFAULT 0,
  refunds           BIGINT NOT NULL DEFAULT 0,
  expected_cash     BIGINT NOT NULL DEFAULT 0,
  actual_cash       BIGINT,
  discrepancy       BIGINT NOT NULL DEFAULT 0,
  transaction_count INTEGER NOT NULL DEFAULT 0,
  return_count      INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_shifts_number UNIQUE (shift_number),
  CONSTRAINT ck_shifts_opening_cash   CHECK (opening_cash   >= 0),
  CONSTRAINT ck_shifts_cash_sales     CHECK (cash_sales     >= 0),
  CONSTRAINT ck_shifts_qris_sales     CHECK (qris_sales     >= 0),
  CONSTRAINT ck_shifts_transfer_sales CHECK (transfer_sales >= 0),
  CONSTRAINT ck_shifts_refunds        CHECK (refunds        >= 0)
);

CREATE INDEX IF NOT EXISTS idx_shifts_user_status ON shifts (user_id, status);
CREATE INDEX IF NOT EXISTS idx_shifts_opened_at   ON shifts (opened_at);
CREATE INDEX IF NOT EXISTS idx_shifts_status      ON shifts (status);

-- ---------- Tabel held_carts (SPEC §3.3) ----------
CREATE TABLE IF NOT EXISTS held_carts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_number VARCHAR(30) NOT NULL,
  outlet_id   BIGINT NOT NULL DEFAULT 1,
  user_id     UUID NOT NULL REFERENCES users(id),
  label       VARCHAR(100),
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  items       JSONB NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'held',
  expires_at  TIMESTAMPTZ NOT NULL,
  resumed_at  TIMESTAMPTZ,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_held_carts_number UNIQUE (hold_number),
  CONSTRAINT ck_held_carts_items_array CHECK (jsonb_typeof(items) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_held_carts_user_status ON held_carts (user_id, status);
CREATE INDEX IF NOT EXISTS idx_held_carts_expires     ON held_carts (expires_at);

-- ---------- Settings: +7 key Fase 4 (SPEC §3.4) ----------
INSERT INTO settings (key, value, description, updated_at) VALUES
  ('shift.enforce_checkout',     'true',   'Guard route: checkout/retur/hold wajib shift terbuka milik user. false = dev/demo tanpa shift.', now()),
  ('shift.cash_tolerance',       '0',      'Ambang selisih kas yang TIDAK memerlukan catatan. |discrepancy| > tolerance → notes wajib saat close.', now()),
  ('store.whatsapp_number',      '""',     'Nomor WA toko format internasional 628xxx — fallback kirim struk saat pelanggan tanpa nomor.', now()),
  ('receipt.print_width_mm',     '80',     'Lebar kertas struk (80/58) — dipakai frontend pilih class CSS print.', now()),
  ('receipt.show_verification_qr','false', 'Cetak QR verifikasi FPOS|TRX-...|<id> di struk.', now()),
  ('receipt.show_qris_qr',       'false',  'Cetak QRIS statis toko di struk (butuh store.qris_payload terisi; kosong → QR di-skip).', now()),
  ('pos.hold_per_day_limit',     '20',     'Maks hold aktif per kasir per hari.', now())
ON CONFLICT (key) DO NOTHING;

-- ---------- Verifikasi (SPEC §8.2.3) ----------
--   SELECT status, count(*) FROM shifts GROUP BY status;          -- 0 baris
--   SELECT count(*) FROM held_carts;                               -- 0 baris
--   SELECT key FROM settings WHERE key LIKE 'shift.%' OR key LIKE 'receipt.%' OR key = 'store.whatsapp_number' OR key = 'pos.hold_per_day_limit';
