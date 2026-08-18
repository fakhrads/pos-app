-- ============================================================
-- db_pos — PostgreSQL 16+  (FakhriPOS)
-- DDL final dari spec/db-schema.md §6 — dieksekusi oleh `bun run db:migrate`
--
-- CATATAN URUTAN: PostgreSQL menolak FK yang menunjuk tabel yang belum
-- dibuat (ERROR 42P01) — jadi tabel diurutkan sesuai dependensi:
--   users → user_sessions → categories → products → customers →
--   memberships → discounts → tax_rates → transactions →
--   transaction_items → payments → returns → return_items →
--   stock_movements → point_movements → audit_logs → settings
-- (stock_movements & point_movements memakai forward-FK ke transactions/returns)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- trusted extension (PG13+), untuk GIN name search

-- ---------- ENUM TYPES ----------
CREATE TYPE user_role AS ENUM ('admin', 'manager', 'kasir');
CREATE TYPE membership_tier AS ENUM ('bronze', 'silver', 'gold');
CREATE TYPE movement_type AS ENUM ('initial', 'purchase_in', 'sale_out', 'return_in', 'adjustment', 'cancellation');
CREATE TYPE transaction_status AS ENUM ('pending', 'completed', 'cancelled');
CREATE TYPE payment_status AS ENUM ('unpaid', 'partial', 'paid', 'refunded', 'failed');
CREATE TYPE payment_method AS ENUM ('cash', 'qris', 'transfer');
CREATE TYPE payment_type AS ENUM ('sale', 'refund');
CREATE TYPE discount_type AS ENUM ('percentage', 'fixed');
CREATE TYPE discount_scope AS ENUM ('global', 'category', 'product');
CREATE TYPE refund_method AS ENUM ('cash', 'qris', 'transfer', 'points');
CREATE TYPE return_status AS ENUM ('completed', 'cancelled');
CREATE TYPE point_movement_type AS ENUM ('earned', 'redeemed', 'adjustment');

-- ---------- 1. USERS ----------
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(255) NOT NULL,
  phone         VARCHAR(30),
  password_hash TEXT NOT NULL,
  role          user_role NOT NULL DEFAULT 'kasir',
  outlet_id     BIGINT NOT NULL DEFAULT 1,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_users_email_active ON users (email) WHERE deleted_at IS NULL;

-- ---------- 2. USER SESSIONS (refresh token) ----------
CREATE TABLE user_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL,
  user_agent         TEXT,
  ip_address         INET,
  expires_at         TIMESTAMPTZ NOT NULL,
  revoked_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_sessions_user    ON user_sessions (user_id);
CREATE INDEX idx_user_sessions_expires ON user_sessions (expires_at);

-- ---------- 3. CATEGORIES (1 level, BA PROD-02) ----------
CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  slug        VARCHAR(120) NOT NULL,
  description TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_categories_slug_active ON categories (slug) WHERE deleted_at IS NULL;

-- ---------- 4. PRODUCTS ----------
CREATE TABLE products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id   UUID NOT NULL REFERENCES categories(id),
  name          VARCHAR(200) NOT NULL,
  sku           VARCHAR(50),
  barcode       VARCHAR(100),
  description   TEXT,
  unit          VARCHAR(20) NOT NULL DEFAULT 'pcs',
  cost_price    BIGINT NOT NULL DEFAULT 0 CHECK (cost_price >= 0),      -- rupiah
  selling_price BIGINT NOT NULL DEFAULT 0 CHECK (selling_price >= 0),   -- rupiah
  stock_on_hand NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (stock_on_hand >= 0),
  min_stock     NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  outlet_id     BIGINT NOT NULL DEFAULT 1,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  is_taxable    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_products_sku_active     ON products (sku) WHERE deleted_at IS NULL AND sku IS NOT NULL;
CREATE UNIQUE INDEX uq_products_barcode_active ON products (barcode) WHERE deleted_at IS NULL AND barcode IS NOT NULL;
CREATE INDEX idx_products_category  ON products (category_id);
CREATE INDEX idx_products_name_trgm ON products USING GIN (name gin_trgm_ops);
CREATE INDEX idx_products_low_stock ON products (min_stock)
  WHERE deleted_at IS NULL AND is_active AND stock_on_hand <= min_stock;

-- ---------- 5. CUSTOMERS ----------
CREATE TABLE customers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(150) NOT NULL,
  phone      VARCHAR(30),
  email      VARCHAR(255),
  address    TEXT,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_customers_phone_active ON customers (phone) WHERE deleted_at IS NULL AND phone IS NOT NULL;
CREATE INDEX idx_customers_name_trgm ON customers USING GIN (name gin_trgm_ops);

-- ---------- 6. MEMBERSHIPS ----------
CREATE TABLE memberships (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         UUID NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  member_code         VARCHAR(30) NOT NULL UNIQUE,
  tier                membership_tier NOT NULL DEFAULT 'bronze',
  points_balance      BIGINT NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  points_earned_total BIGINT NOT NULL DEFAULT 0,
  points_redeemed_total BIGINT NOT NULL DEFAULT 0,
  joined_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 7. DISCOUNTS ----------
CREATE TABLE discounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                VARCHAR(100) NOT NULL,
  code                VARCHAR(50),
  type                discount_type NOT NULL,
  value               NUMERIC(10,2) NOT NULL CHECK (value > 0),  -- % atau rupiah tergantung type
  scope               discount_scope NOT NULL DEFAULT 'global',
  product_id          UUID REFERENCES products(id) ON DELETE CASCADE,
  category_id         UUID REFERENCES categories(id) ON DELETE CASCADE,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  valid_from          TIMESTAMPTZ,
  valid_to            TIMESTAMPTZ,
  max_discount_amount BIGINT CHECK (max_discount_amount IS NULL OR max_discount_amount >= 0),
  usage_limit         BIGINT CHECK (usage_limit IS NULL OR usage_limit > 0),
  used_count          BIGINT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_discounts_code_active ON discounts (code) WHERE code IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_discounts_active ON discounts (is_active, valid_from, valid_to);

-- ---------- 8. TAX RATES ----------
CREATE TABLE tax_rates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(100) NOT NULL,
  rate         NUMERIC(5,2) NOT NULL CHECK (rate >= 0),   -- persen, 11.00 = 11%
  is_inclusive BOOLEAN NOT NULL DEFAULT FALSE,
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 9. TRANSACTIONS ----------
CREATE TABLE transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number        VARCHAR(30) NOT NULL UNIQUE,   -- TRX-YYYYMMDD-XXXX
  outlet_id             BIGINT NOT NULL DEFAULT 1,
  customer_id           UUID REFERENCES customers(id) ON DELETE SET NULL,
  user_id               UUID NOT NULL REFERENCES users(id),
  status                transaction_status NOT NULL DEFAULT 'completed',
  subtotal              BIGINT NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total        BIGINT NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_total             BIGINT NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total                 BIGINT NOT NULL DEFAULT 0 CHECK (total >= 0),
  discount_id           UUID REFERENCES discounts(id) ON DELETE SET NULL,
  discount_name         VARCHAR(100),
  points_earned         BIGINT NOT NULL DEFAULT 0,
  points_redeemed       BIGINT NOT NULL DEFAULT 0,
  redeemed_points_value BIGINT NOT NULL DEFAULT 0,
  payment_status        payment_status NOT NULL DEFAULT 'paid',
  notes                 TEXT,
  sold_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (total = subtotal - discount_total + tax_total - redeemed_points_value)
);
CREATE INDEX idx_transactions_sold_at    ON transactions (sold_at);
CREATE INDEX idx_transactions_customer   ON transactions (customer_id);
CREATE INDEX idx_transactions_user       ON transactions (user_id);
CREATE INDEX idx_transactions_status     ON transactions (status);
CREATE INDEX idx_transactions_sold_completed ON transactions (sold_at) WHERE status = 'completed';

-- ---------- 10. TRANSACTION ITEMS ----------
CREATE TABLE transaction_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id    UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  product_id        UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name      VARCHAR(200) NOT NULL,
  product_sku       VARCHAR(50) NOT NULL,
  quantity          NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit_price        BIGINT NOT NULL CHECK (unit_price >= 0),   -- rupiah
  cost_price        BIGINT NOT NULL DEFAULT 0 CHECK (cost_price >= 0),  -- rupiah, snapshot
  discount_amount   BIGINT NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_amount        BIGINT NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total        BIGINT NOT NULL CHECK (line_total >= 0),
  returned_quantity NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tx_items_transaction ON transaction_items (transaction_id);
CREATE INDEX idx_tx_items_product     ON transaction_items (product_id);

-- ---------- 11. PAYMENTS ----------
CREATE TABLE payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id   UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  outlet_id        BIGINT NOT NULL DEFAULT 1,
  type             payment_type NOT NULL DEFAULT 'sale',
  method           payment_method NOT NULL,
  amount           BIGINT NOT NULL CHECK (amount > 0),       -- rupiah
  cash_received    BIGINT CHECK (cash_received IS NULL OR cash_received >= 0),
  change_amount    BIGINT CHECK (change_amount IS NULL OR change_amount >= 0),
  reference_number VARCHAR(100),
  status           payment_status NOT NULL DEFAULT 'paid',
  paid_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_transaction ON payments (transaction_id);
CREATE INDEX idx_payments_paid_at     ON payments (paid_at);

-- ---------- 12. RETURNS ----------
CREATE TABLE returns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number    VARCHAR(30) NOT NULL UNIQUE,   -- RET-YYYYMMDD-XXXX
  outlet_id        BIGINT NOT NULL DEFAULT 1,
  transaction_id   UUID NOT NULL REFERENCES transactions(id),
  customer_id      UUID REFERENCES customers(id) ON DELETE SET NULL,
  user_id          UUID NOT NULL REFERENCES users(id),
  status           return_status NOT NULL DEFAULT 'completed',
  refund_method    refund_method NOT NULL,
  refund_payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  total_refund     BIGINT NOT NULL CHECK (total_refund >= 0),
  points_reversed  BIGINT NOT NULL DEFAULT 0,
  reason           TEXT,
  notes            TEXT,
  returned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_returns_transaction ON returns (transaction_id);
CREATE INDEX idx_returns_returned_at ON returns (returned_at);

-- ---------- 13. RETURN ITEMS ----------
CREATE TABLE return_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id           UUID NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  transaction_item_id UUID NOT NULL REFERENCES transaction_items(id),
  product_id          UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name        VARCHAR(200) NOT NULL,
  quantity            NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit_price          BIGINT NOT NULL CHECK (unit_price >= 0),
  subtotal            BIGINT NOT NULL CHECK (subtotal >= 0),
  reason              TEXT NOT NULL,   -- wajib (BA RET-04)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_return_items_return  ON return_items (return_id);
CREATE INDEX idx_return_items_tx_item ON return_items (transaction_item_id);

-- ---------- 14. STOCK MOVEMENTS (ledger) ----------
CREATE TABLE stock_movements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID NOT NULL REFERENCES products(id),
  type           movement_type NOT NULL,
  quantity       NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  before_qty     NUMERIC(12,3) NOT NULL,
  after_qty      NUMERIC(12,3) NOT NULL,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  return_id      UUID REFERENCES returns(id) ON DELETE SET NULL,
  reference      VARCHAR(100),
  note           TEXT,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_movements_product ON stock_movements (product_id, created_at DESC);
CREATE INDEX idx_stock_movements_tx      ON stock_movements (transaction_id);
CREATE INDEX idx_stock_movements_return  ON stock_movements (return_id);

-- ---------- 15. POINT MOVEMENTS ----------
CREATE TABLE point_movements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id  UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  type           point_movement_type NOT NULL,
  points         BIGINT NOT NULL CHECK (points <> 0),
  balance_after  BIGINT NOT NULL,
  note           TEXT,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_point_movements_membership ON point_movements (membership_id, created_at DESC);

-- ---------- 16. AUDIT LOGS (append-only) ----------
CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id   UUID,
  old_values  JSONB,
  new_values  JSONB,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity  ON audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_logs (created_at DESC);
CREATE INDEX idx_audit_user    ON audit_logs (user_id);
-- REVOKE UPDATE, DELETE ON audit_logs FROM pos_app;  -- jalankan setelah role aplikasi dibuat

-- ---------- 17. SETTINGS ----------
CREATE TABLE settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         VARCHAR(100) NOT NULL UNIQUE,
  value       JSONB NOT NULL,
  description TEXT,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- TRIGGER updated_at ----------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','categories','products','customers','memberships',
                          'discounts','tax_rates','transactions','returns']
  LOOP
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

-- ============================================================
-- SEED DATA (spec/db-schema.md §7) — via migration
-- ============================================================

-- Kategori awal (BA §9)
INSERT INTO categories (name, slug, sort_order) VALUES
  ('Makanan', 'makanan', 1),
  ('Minuman', 'minuman', 2),
  ('Snack',   'snack',   3),
  ('Lainnya', 'lainnya', 4)
ON CONFLICT DO NOTHING;

-- Pajak default PPN 11% (bisa 0%)
INSERT INTO tax_rates (name, rate, is_inclusive, is_default) VALUES
  ('PPN', 11.00, FALSE, TRUE)
ON CONFLICT DO NOTHING;

-- Pengaturan toko & aturan bisnis (BA M9)
INSERT INTO settings (key, value, description) VALUES
  ('store.name',                 '"FakhriPOS"', 'Nama toko (struk)'),
  ('store.address',              '""',          'Alamat toko (struk)'),
  ('store.phone',                '""',          'Telepon toko (struk)'),
  ('receipt.footer',             '"Terima kasih atas kunjungan Anda"', 'Footer struk'),
  ('points.earn_per_idr',        '1000',        'Rate poin: 1 poin per Rp 1.000 (BA CUST-04)'),
  ('points.redeem_value',        '10',          'Nilai redeem: 1 poin = Rp 10 (BA CUST-05)'),
  ('low_stock.default_threshold','5',           'Default threshold stok menipis (BA SET-04)'),
  ('discount.manual_max_percent','20',          'Cap diskon manual kasir, % (default 20%)'),
  ('discount.manual_max_amount', '50000',       'Cap diskon manual kasir, rupiah (default Rp 50.000)'),
  ('return.max_days',            '7',           'Batas waktu return (BA RET-06)'),
  ('report.timezone',            '"Asia/Jakarta"', 'Zona waktu laporan')
ON CONFLICT (key) DO NOTHING;

-- Akun admin awal TIDAK di-seed via SQL — dibuat aplikasi saat migrate
-- (env SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD, lihat src/db/migrate.ts)
