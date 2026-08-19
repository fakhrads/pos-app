import type {
  Warehouse,
  WarehouseStock,
  StockTransfer,
  StockAdjustment,
  StockMutation,
} from "@/lib/types-warehouse";
import { PRODUCTS } from "./products";

// ============ WAREHOUSES (4 gudang) ============
export const WAREHOUSES: Warehouse[] = [
  {
    id: "wh-1",
    code: "GUD-PUSAT",
    name: "Gudang Pusat",
    address: "Jl. Raya Utama No. 123, Jakarta Selatan",
    pic: "Budi Santoso",
    capacity: 5000,
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "wh-2",
    code: "GUD-BANDUNG",
    name: "Gudang Bandung",
    address: "Jl. Dago No. 45, Bandung",
    pic: "Siti Rahayu",
    capacity: 3000,
    isActive: true,
    createdAt: "2026-01-15T00:00:00Z",
  },
  {
    id: "wh-3",
    code: "GUD-SURABAYA",
    name: "Gudang Surabaya",
    address: "Jl. Pemuda No. 78, Surabaya",
    pic: "Andi Wijaya",
    capacity: 4000,
    isActive: true,
    createdAt: "2026-02-01T00:00:00Z",
  },
  {
    id: "wh-4",
    code: "GUD-MEDAN",
    name: "Gudang Medan",
    address: "Jl. Asia No. 12, Medan",
    pic: "Rina Putri",
    capacity: 2000,
    isActive: false,
    createdAt: "2026-03-01T00:00:00Z",
  },
];

// Helper to get product info
function getProductInfo(p: (typeof PRODUCTS)[0]) {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku ?? undefined,
    unit: p.unit,
    costPrice: p.costPrice,
    sellingPrice: p.sellingPrice,
  };
}

function getProductInfoShort(p: (typeof PRODUCTS)[0]) {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku ?? undefined,
    unit: p.unit,
  };
}

// ============ WAREHOUSE STOCK ============
function generateStock(): WarehouseStock[] {
  const stocks: WarehouseStock[] = [];
  let stockId = 1;

  // Gudang Pusat
  for (const product of PRODUCTS) {
    if (product.stockOnHand === 0) continue;
    const ratio = 0.5 + Math.random() * 0.3;
    const qty = Math.floor(product.stockOnHand * ratio);
    stocks.push({
      id: `ws-${String(stockId++).padStart(3, "0")}`,
      warehouseId: "wh-1",
      productId: product.id,
      quantity: qty,
      minStock: Math.floor(product.minStock * 0.5),
      updatedAt: "2026-08-15T10:00:00Z",
      product: getProductInfo(product),
    });
  }

  // Gudang Bandung
  const bandungProducts = PRODUCTS.filter(() => Math.random() > 0.4);
  for (const product of bandungProducts) {
    const ratio = 0.15 + Math.random() * 0.25;
    const qty = Math.max(1, Math.floor(product.stockOnHand * ratio));
    stocks.push({
      id: `ws-${String(stockId++).padStart(3, "0")}`,
      warehouseId: "wh-2",
      productId: product.id,
      quantity: qty,
      minStock: Math.floor(product.minStock * 0.3),
      updatedAt: "2026-08-14T10:00:00Z",
      product: getProductInfo(product),
    });
  }

  // Gudang Surabaya
  const surabayaProducts = PRODUCTS.filter(() => Math.random() > 0.6);
  for (const product of surabayaProducts) {
    const ratio = 0.1 + Math.random() * 0.15;
    const qty = Math.max(1, Math.floor(product.stockOnHand * ratio));
    stocks.push({
      id: `ws-${String(stockId++).padStart(3, "0")}`,
      warehouseId: "wh-3",
      productId: product.id,
      quantity: qty,
      minStock: Math.floor(product.minStock * 0.2),
      updatedAt: "2026-08-13T10:00:00Z",
      product: getProductInfo(product),
    });
  }

  return stocks;
}

export const WAREHOUSE_STOCKS = generateStock();

// ============ STOCK TRANSFERS ============
export const STOCK_TRANSFERS: StockTransfer[] = [
  {
    id: "tf-001",
    fromWarehouseId: "wh-1",
    toWarehouseId: "wh-2",
    productId: PRODUCTS[0].id,
    quantity: 24,
    notes: "Restok mingguan",
    createdAt: "2026-08-10T09:00:00Z",
    createdBy: "user-1",
    product: getProductInfoShort(PRODUCTS[0]),
    fromWarehouse: WAREHOUSES[0],
    toWarehouse: WAREHOUSES[1],
    user: { name: "Budi Santoso" },
  },
  {
    id: "tf-002",
    fromWarehouseId: "wh-1",
    toWarehouseId: "wh-3",
    productId: PRODUCTS[4].id,
    quantity: 36,
    notes: "Permintaan Surabaya",
    createdAt: "2026-08-11T10:30:00Z",
    createdBy: "user-1",
    product: getProductInfoShort(PRODUCTS[4]),
    fromWarehouse: WAREHOUSES[0],
    toWarehouse: WAREHOUSES[2],
    user: { name: "Budi Santoso" },
  },
  {
    id: "tf-003",
    fromWarehouseId: "wh-2",
    toWarehouseId: "wh-1",
    productId: PRODUCTS[12].id,
    quantity: 48,
    notes: "Pengembalian dari Bandung",
    createdAt: "2026-08-12T14:00:00Z",
    createdBy: "user-2",
    product: getProductInfoShort(PRODUCTS[12]),
    fromWarehouse: WAREHOUSES[1],
    toWarehouse: WAREHOUSES[0],
    user: { name: "Siti Rahayu" },
  },
  {
    id: "tf-004",
    fromWarehouseId: "wh-1",
    toWarehouseId: "wh-2",
    productId: PRODUCTS[30].id,
    quantity: 100,
    notes: "Stok untuk promosi",
    createdAt: "2026-08-13T08:15:00Z",
    createdBy: "user-1",
    product: getProductInfoShort(PRODUCTS[30]),
    fromWarehouse: WAREHOUSES[0],
    toWarehouse: WAREHOUSES[1],
    user: { name: "Budi Santoso" },
  },
  {
    id: "tf-005",
    fromWarehouseId: "wh-1",
    toWarehouseId: "wh-3",
    productId: PRODUCTS[38].id,
    quantity: 12,
    notes: "Restok Surabaya",
    createdAt: "2026-08-14T11:00:00Z",
    createdBy: "user-1",
    product: getProductInfoShort(PRODUCTS[38]),
    fromWarehouse: WAREHOUSES[0],
    toWarehouse: WAREHOUSES[2],
    user: { name: "Budi Santoso" },
  },
  {
    id: "tf-006",
    fromWarehouseId: "wh-3",
    toWarehouseId: "wh-1",
    productId: PRODUCTS[44].id,
    quantity: 5,
    notes: "Transfer ke gudang pusat",
    createdAt: "2026-08-15T09:30:00Z",
    createdBy: "user-3",
    product: getProductInfoShort(PRODUCTS[44]),
    fromWarehouse: WAREHOUSES[2],
    toWarehouse: WAREHOUSES[0],
    user: { name: "Andi Wijaya" },
  },
  {
    id: "tf-007",
    fromWarehouseId: "wh-1",
    toWarehouseId: "wh-2",
    productId: PRODUCTS[50].id,
    quantity: 20,
    notes: "Restok Bandung",
    createdAt: "2026-08-16T10:00:00Z",
    createdBy: "user-1",
    product: getProductInfoShort(PRODUCTS[50]),
    fromWarehouse: WAREHOUSES[0],
    toWarehouse: WAREHOUSES[1],
    user: { name: "Budi Santoso" },
  },
  {
    id: "tf-008",
    fromWarehouseId: "wh-2",
    toWarehouseId: "wh-3",
    productId: PRODUCTS[1].id,
    quantity: 12,
    notes: "Pindah stok antar cabang",
    createdAt: "2026-08-17T13:45:00Z",
    createdBy: "user-2",
    product: getProductInfoShort(PRODUCTS[1]),
    fromWarehouse: WAREHOUSES[1],
    toWarehouse: WAREHOUSES[2],
    user: { name: "Siti Rahayu" },
  },
  {
    id: "tf-009",
    fromWarehouseId: "wh-1",
    toWarehouseId: "wh-3",
    productId: PRODUCTS[20].id,
    quantity: 6,
    notes: "Trial produk baru di Surabaya",
    createdAt: "2026-08-17T15:00:00Z",
    createdBy: "user-1",
    product: getProductInfoShort(PRODUCTS[20]),
    fromWarehouse: WAREHOUSES[0],
    toWarehouse: WAREHOUSES[2],
    user: { name: "Budi Santoso" },
  },
  {
    id: "tf-010",
    fromWarehouseId: "wh-1",
    toWarehouseId: "wh-2",
    productId: PRODUCTS[5].id,
    quantity: 18,
    notes: "Restok rutin",
    createdAt: "2026-08-18T08:00:00Z",
    createdBy: "user-1",
    product: getProductInfoShort(PRODUCTS[5]),
    fromWarehouse: WAREHOUSES[0],
    toWarehouse: WAREHOUSES[1],
    user: { name: "Budi Santoso" },
  },
];

// ============ STOCK ADJUSTMENTS ============
export const STOCK_ADJUSTMENTS: StockAdjustment[] = [
  {
    id: "adj-001",
    warehouseId: "wh-1",
    productId: PRODUCTS[0].id,
    quantityDelta: -5,
    reason: "Rusak karena jatuh",
    createdAt: "2026-08-10T11:00:00Z",
    createdBy: "user-1",
    product: getProductInfoShort(PRODUCTS[0]),
    warehouse: WAREHOUSES[0],
    user: { name: "Budi Santoso" },
  },
  {
    id: "adj-002",
    warehouseId: "wh-2",
    productId: PRODUCTS[12].id,
    quantityDelta: -12,
    reason: "Kadaluarsa",
    createdAt: "2026-08-11T09:30:00Z",
    createdBy: "user-2",
    product: getProductInfoShort(PRODUCTS[12]),
    warehouse: WAREHOUSES[1],
    user: { name: "Siti Rahayu" },
  },
  {
    id: "adj-003",
    warehouseId: "wh-1",
    productId: PRODUCTS[30].id,
    quantityDelta: 50,
    reason: "Koreksi stok setelah audit fisik",
    createdAt: "2026-08-12T14:30:00Z",
    createdBy: "user-1",
    product: getProductInfoShort(PRODUCTS[30]),
    warehouse: WAREHOUSES[0],
    user: { name: "Budi Santoso" },
  },
  {
    id: "adj-004",
    warehouseId: "wh-3",
    productId: PRODUCTS[38].id,
    quantityDelta: -3,
    reason: "Sample untuk uji kualitas",
    createdAt: "2026-08-13T10:00:00Z",
    createdBy: "user-3",
    product: getProductInfoShort(PRODUCTS[38]),
    warehouse: WAREHOUSES[2],
    user: { name: "Andi Wijaya" },
  },
  {
    id: "adj-005",
    warehouseId: "wh-1",
    productId: PRODUCTS[44].id,
    quantityDelta: -2,
    reason: "Bocor dari karung",
    createdAt: "2026-08-14T08:45:00Z",
    createdBy: "user-1",
    product: getProductInfoShort(PRODUCTS[44]),
    warehouse: WAREHOUSES[0],
    user: { name: "Budi Santoso" },
  },
  {
    id: "adj-006",
    warehouseId: "wh-2",
    productId: PRODUCTS[20].id,
    quantityDelta: 10,
    reason: "Temuan stok di gudang tidak tercatat",
    createdAt: "2026-08-15T11:15:00Z",
    createdBy: "user-2",
    product: getProductInfoShort(PRODUCTS[20]),
    warehouse: WAREHOUSES[1],
    user: { name: "Siti Rahayu" },
  },
  {
    id: "adj-007",
    warehouseId: "wh-1",
    productId: PRODUCTS[50].id,
    quantityDelta: -8,
    reason: "Retur ke supplier",
    createdAt: "2026-08-16T09:00:00Z",
    createdBy: "user-1",
    product: getProductInfoShort(PRODUCTS[50]),
    warehouse: WAREHOUSES[0],
    user: { name: "Budi Santoso" },
  },
  {
    id: "adj-008",
    warehouseId: "wh-3",
    productId: PRODUCTS[1].id,
    quantityDelta: -6,
    reason: "Pecah saat pemuatan",
    createdAt: "2026-08-17T14:20:00Z",
    createdBy: "user-3",
    product: getProductInfoShort(PRODUCTS[1]),
    warehouse: WAREHOUSES[2],
    user: { name: "Andi Wijaya" },
  },
  {
    id: "adj-009",
    warehouseId: "wh-1",
    productId: PRODUCTS[3].id,
    quantityDelta: 24,
    reason: "Koreksi setelah penerimaan PO",
    createdAt: "2026-08-17T16:00:00Z",
    createdBy: "user-1",
    product: getProductInfoShort(PRODUCTS[3]),
    warehouse: WAREHOUSES[0],
    user: { name: "Budi Santoso" },
  },
  {
    id: "adj-010",
    warehouseId: "wh-2",
    productId: PRODUCTS[5].id,
    quantityDelta: -4,
    reason: "Exp date sudah lewat",
    createdAt: "2026-08-18T10:30:00Z",
    createdBy: "user-2",
    product: getProductInfoShort(PRODUCTS[5]),
    warehouse: WAREHOUSES[1],
    user: { name: "Siti Rahayu" },
  },
];

// ============ STOCK MUTATIONS ============
const transferMutations = STOCK_TRANSFERS.flatMap((tf) => {
  const base = {
    createdAt: tf.createdAt,
    createdBy: tf.createdBy,
    product: tf.product,
    user: tf.user,
  };
  return [
    {
      id: `mut-${tf.id}-out`,
      warehouseId: tf.fromWarehouseId,
      productId: tf.productId,
      type: "transfer_out" as const,
      quantityBefore: 100,
      quantityDelta: -tf.quantity,
      quantityAfter: 100 - tf.quantity,
      reference: tf.id,
      notes: tf.notes,
      warehouse: tf.fromWarehouse,
      ...base,
    },
    {
      id: `mut-${tf.id}-in`,
      warehouseId: tf.toWarehouseId,
      productId: tf.productId,
      type: "transfer_in" as const,
      quantityBefore: 50,
      quantityDelta: tf.quantity,
      quantityAfter: 50 + tf.quantity,
      reference: tf.id,
      notes: tf.notes,
      warehouse: tf.toWarehouse,
      ...base,
    },
  ];
});

const adjustmentMutations = STOCK_ADJUSTMENTS.map((adj) => ({
  id: `mut-${adj.id}`,
  warehouseId: adj.warehouseId,
  productId: adj.productId,
  type: (adj.quantityDelta > 0 ? "adjustment_in" : "adjustment_out") as "adjustment_in" | "adjustment_out",
  quantityBefore: adj.quantityDelta > 0 ? 50 : 60,
  quantityDelta: adj.quantityDelta,
  quantityAfter: adj.quantityDelta > 0 ? 50 + adj.quantityDelta : 60 + adj.quantityDelta,
  reference: adj.id,
  notes: adj.reason,
  warehouse: adj.warehouse,
  product: adj.product,
  user: adj.user,
  createdAt: adj.createdAt,
  createdBy: adj.createdBy,
}));

const initialMutations = WAREHOUSES.filter((w) => w.isActive)
  .slice(0, 3)
  .flatMap((wh) =>
    PRODUCTS.filter((p) => p.isActive).slice(0, 5).map((p) => ({
      id: `mut-init-${wh.id}-${p.id}`,
      warehouseId: wh.id,
      productId: p.id,
      type: "initial" as const,
      quantityBefore: 0,
      quantityDelta: p.stockOnHand,
      quantityAfter: p.stockOnHand,
      reference: undefined as string | undefined,
      notes: "Stok awal sistem",
      warehouse: { ...wh },
      product: getProductInfoShort(p),
      user: { name: "System" },
      createdAt: "2026-01-01T00:00:00Z",
      createdBy: "system",
    }))
  );

export const STOCK_MUTATIONS: StockMutation[] = [
  ...transferMutations,
  ...adjustmentMutations,
  ...initialMutations,
].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

// ============ STATS ============
export const WAREHOUSE_STATS = {
  totalWarehouses: WAREHOUSES.length,
  activeWarehouses: WAREHOUSES.filter((w) => w.isActive).length,
  totalProducts: PRODUCTS.length,
  totalStockValue: WAREHOUSES.filter((w) => w.isActive).reduce((sum, wh) => {
    const whStock = WAREHOUSE_STOCKS.filter((s) => s.warehouseId === wh.id);
    return (
      sum +
      whStock.reduce(
        (s, stock) => s + (stock.product?.costPrice ?? 0) * stock.quantity,
        0
      )
    );
  }, 0),
  totalMutations: STOCK_MUTATIONS.length,
  totalTransfers: STOCK_TRANSFERS.length,
  totalAdjustments: STOCK_ADJUSTMENTS.length,
};
