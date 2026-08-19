// ============================================================
// Tipe data Stok & Gudang — Fase 3 (SPEC docs/phase3/SPEC.md §4)
// Diselaraskan 1:1 dengan serializer backend (routes/warehouses.routes.ts,
// routes/stock-transfers.routes.ts, routes/stock-adjustments.routes.ts,
// routes/reports.routes.ts §low-stock).
// Konvensi: qty number (NUMERIC(12,3)), uang integer rupiah, waktu ISO (WIB saat tampil).
// ============================================================

// ---------- Warehouse ----------
export interface Warehouse {
  id: string;
  code: string;
  name: string;
  address?: string | null;
  pic?: string | null; // Person in Charge
  capacity: number; // dalam satuan unit/m²
  isActive: boolean;
  /** Fase 3: gudang penjualan default (settings['stock.default_warehouse_id']) */
  isDefault: boolean;
  /** Fase 3: jumlah baris stok (produk×varian) di gudang ini */
  itemCount: number;
  /** Fase 3: Σ quantity semua baris stok gudang ini */
  totalQty: number;
  createdAt: string;
  updatedAt?: string | null;
}

export interface WarehousePayload {
  code: string;
  name: string;
  address?: string;
  pic?: string;
  capacity?: number;
  isActive?: boolean;
}

/** GET /warehouses/:id — detail + ringkasan stok */
export interface WarehouseDetail {
  warehouse: Warehouse;
  isDefault: boolean;
  stockSummary: { itemCount: number; totalQty: number };
}

// ---------- Stok per gudang (GET /warehouses/:id/stocks) ----------
/** Satu baris = satu (produk, varian|null) di satu gudang. */
export interface WarehouseStock {
  warehouseId: string;
  productId: string;
  /** Terisi untuk stok varian */
  variantId?: string | null;
  sku?: string | null;
  barcode?: string | null;
  name: string;
  variantName?: string | null;
  unit: string;
  quantity: number;
  /** Threshold per gudang (0 = nonaktif kecuali stok 0) */
  minStock: number;
  /** Threshold per produk (products.min_stock) */
  productMinStock: number;
  status: "ok" | "low" | "out";
  sellingPrice: number;
  /** HANYA untuk role manager+ — serializer backend menyembunyikan dari kasir (AC-02.1) */
  costPrice?: number;
  updatedAt: string;
}

// ---------- Transfer Stok (Fase 3 §4.3) ----------
export interface StockTransferLine {
  id: string;
  productId: string;
  variantId?: string | null;
  sku?: string | null;
  name: string;
  variantName?: string | null;
  unit: string;
  quantity: number;
  notes?: string | null;
}

export interface WarehouseRef {
  id: string;
  code: string;
  name: string;
}

export interface UserRef {
  id: string;
  name: string;
}

/** GET /stock-transfers — 1 dokumen transfer dikelompokkan per transferNumber */
export interface StockTransferGroup {
  transferNumber: string;
  createdAt: string;
  createdBy: UserRef | null;
  fromWarehouse: WarehouseRef;
  toWarehouse: WarehouseRef;
  lineCount: number;
  totalQty: number;
  lines: StockTransferLine[];
}

/** GET /stock-transfers/:transferNumber */
export interface StockTransferDetail {
  transfer: Omit<StockTransferGroup, "lines">;
  lines: StockTransferLine[];
}

/** POST /stock-transfers — payload multi-item */
export interface StockTransferPayload {
  fromWarehouseId: string;
  toWarehouseId: string;
  items: {
    productId: string;
    variantId?: string | null;
    quantity: number;
    notes?: string | null;
  }[];
  /** Catatan level dokumen — disalin ke tiap baris oleh backend */
  notes?: string | null;
}

/** POST /stock-transfers — respons 201 */
export interface StockTransferResult {
  transferNumber: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  createdAt: string;
  createdBy: UserRef;
  items: {
    id: string;
    productId: string;
    variantId: string | null;
    quantity: number;
    fromBefore: number;
    fromAfter: number;
    toBefore: number;
    toAfter: number;
  }[];
}

// ---------- Koreksi Stok / Adjustment (Fase 3 §4.4) ----------
export interface StockAdjustment {
  id: string;
  warehouse: WarehouseRef;
  product: { id: string; sku?: string | null; name: string };
  variant?: { id: string; name: string };
  /** positif = tambah, negatif = kurang */
  quantityDelta: number;
  reason: string;
  reasonLabel: string;
  note?: string | null;
  createdBy: UserRef | null;
  createdAt: string;
}

export interface StockAdjustmentPayload {
  warehouseId: string;
  productId: string;
  variantId?: string | null;
  quantityDelta: number;
  reason: string;
  note?: string | null;
}

/** POST /stock-adjustments — respons 201 */
export interface StockAdjustmentResult {
  adjustment: {
    id: string;
    warehouseId: string;
    productId: string;
    variantId: string | null;
    quantityDelta: number;
    reason: string;
    note: string | null;
    createdBy: UserRef;
    createdAt: string;
  };
  beforeQty: number;
  afterQty: number;
}

// ---------- Kartu Stok / Mutasi (Fase 3 §4.5) ----------
/** movement_type — selaras enum DB + 2 nilai baru Fase 3 (SPEC §3.1). */
export type MovementType =
  | "initial"
  | "purchase_in"
  | "sale_out"
  | "return_in"
  | "adjustment"
  | "cancellation"
  | "transfer_out"
  | "transfer_in";

/** GET /warehouses/:id/stock-movements — read-only, wajib di-scope per productId */
export interface StockMovement {
  id: string;
  type: MovementType;
  typeLabel: string;
  /** Selalu positif — arah tercermin di beforeQty/afterQty */
  quantity: number;
  beforeQty: number;
  afterQty: number;
  /** TRF-... untuk transfer; id adjustment untuk koreksi; invoice untuk sale_out */
  reference?: string | null;
  note?: string | null;
  createdAt: string;
  createdBy: UserRef | null;
}

export const MUTATION_TYPE_LABEL: Record<MovementType, string> = {
  initial: "Stok Awal",
  purchase_in: "Pembelian",
  sale_out: "Penjualan",
  return_in: "Retur Masuk",
  adjustment: "Koreksi Stok",
  cancellation: "Pembatalan",
  transfer_out: "Transfer Keluar",
  transfer_in: "Transfer Masuk",
};

export const MUTATION_TYPE_COLOR: Record<MovementType, string> = {
  initial: "text-muted-foreground",
  purchase_in: "text-accent",
  sale_out: "text-destructive",
  return_in: "text-success",
  adjustment: "text-warning",
  cancellation: "text-muted-foreground",
  transfer_out: "text-destructive",
  transfer_in: "text-success",
};

// ---------- Alasan adjustment (SPEC §1.3.5, R2 — daftar tetap) ----------
export const ADJUSTMENT_REASONS = [
  "rusak",
  "expired",
  "hilang",
  "salah_catat",
  "selisih_supplier",
  "laimnya",
] as const;

export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const ADJUSTMENT_REASON_LABEL: Record<string, string> = {
  rusak: "Rusak",
  expired: "Expired / Kedaluwarsa",
  hilang: "Hilang",
  salah_catat: "Salah Catat",
  selisih_supplier: "Selisih Supplier",
  lainnya: "Lainnya",
};
