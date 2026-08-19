// ---------- Warehouse ----------
export interface Warehouse {
  id: string;
  code: string;
  name: string;
  address?: string | null;
  pic?: string | null; // Person in Charge
  capacity: number; // in units/sqm
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface WarehousePayload {
  code: string;
  name: string;
  address: string;
  pic: string;
  capacity: number;
  isActive?: boolean;
}

// ---------- Warehouse Stock ----------
export interface WarehouseStock {
  id: string;
  warehouseId: string;
  productId: string;
  /** Fase 2 (SPEC §3.7): NULL = stok produk non-varian; terisi = stok varian */
  productVariantId?: string | null;
  quantity: number;
  minStock: number;
  updatedAt: string;
  // Joined fields
  warehouse?: Warehouse;
  product?: {
    id: string;
    name: string;
    sku?: string;
    unit: string;
    costPrice: number;
    sellingPrice: number;
  };
}

// ---------- Stock Transfer ----------
export interface StockTransfer {
  id: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  productId: string;
  /** Fase 2 (SPEC §3.8): terisi saat transfer stok varian */
  productVariantId?: string | null;
  quantity: number;
  notes?: string;
  createdAt: string;
  createdBy: string;
  // Joined fields
  fromWarehouse?: Warehouse;
  toWarehouse?: Warehouse;
  product?: {
    id: string;
    name: string;
    sku?: string;
    unit: string;
  };
  user?: {
    name: string;
  };
}

export interface StockTransferPayload {
  fromWarehouseId: string;
  toWarehouseId: string;
  productId: string;
  quantity: number;
  notes?: string;
}

// ---------- Stock Adjustment ----------
export interface StockAdjustment {
  id: string;
  warehouseId: string;
  productId: string;
  /** Fase 2 (SPEC §3.8): terisi saat adjustment stok varian */
  productVariantId?: string | null;
  quantityDelta: number; // positive = tambah, negative = kurang
  reason: string;
  createdAt: string;
  createdBy: string;
  // Joined fields
  warehouse?: Warehouse;
  product?: {
    id: string;
    name: string;
    sku?: string;
    unit: string;
  };
  user?: {
    name: string;
  };
}

export interface StockAdjustmentPayload {
  warehouseId: string;
  productId: string;
  quantityDelta: number;
  reason: string;
}

// ---------- Stock Mutation Log ----------
export type MutationType =
  | "transfer_in"
  | "transfer_out"
  | "adjustment_in"
  | "adjustment_out"
  | "initial"
  | "purchase_in";

export interface StockMutation {
  id: string;
  warehouseId: string;
  productId: string;
  /** Fase 2: terisi saat mutasi stok varian */
  productVariantId?: string | null;
  type: MutationType;
  quantityBefore: number;
  quantityDelta: number;
  quantityAfter: number;
  reference?: string; // e.g., transfer ID, adjustment ID
  notes?: string;
  createdAt: string;
  createdBy: string;
  // Joined fields
  warehouse?: Warehouse;
  product?: {
    id: string;
    name: string;
    sku?: string;
    unit: string;
  };
  user?: {
    name: string;
  };
}

export const MUTATION_TYPE_LABEL: Record<MutationType, string> = {
  transfer_in: "Transfer Masuk",
  transfer_out: "Transfer Keluar",
  adjustment_in: "Adjustment (+)",
  adjustment_out: "Adjustment (-)",
  initial: "Stok Awal",
  purchase_in: "Pembelian",
};

export const MUTATION_TYPE_COLOR: Record<MutationType, string> = {
  transfer_in: "text-success",
  transfer_out: "text-destructive",
  adjustment_in: "text-success",
  adjustment_out: "text-destructive",
  initial: "text-muted-foreground",
  purchase_in: "text-accent",
};
