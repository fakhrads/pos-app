import type { CartDiscount, Category, Product, ProductUnit, ProductVariant } from "@/lib/types";

// ============================================================
// IndexedDB — cache offline FakhriPOS (SPEC Fase 7 §3.1)
// DB  : fakhripos-idb (versi 1)
//  ▶ products        : snapshot katalog (id = product id)
//  ▶ offline_orders  : antrean transaksi offline (key = clientTxId)
//  ▶ sync_state      : stamp sinkronisasi (key = string)
// ============================================================

const DB_NAME = "fakhripos-idb";
const DB_VERSION = 1;

export type OfflineOrderStatus = "queued" | "syncing" | "done" | "conflict";

export interface IDBProduct {
  id: string;
  categoryId: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  categoryName: string | null;
  unit: string;
  sellingPrice: number;
  trackStock: boolean;
  stockOnHand: number;
  minStock: number;
  isTaxable: boolean;
  hasVariants: boolean;
  variantCount: number;
  updatedAt: string;
  variants: IDBVariant[];
  units: IDBUnit[];
}

export interface IDBVariant {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  sellingPrice: number;
  stockOnHand: number;
}

export interface IDBUnit {
  unit: string;
  factor: number;
  sellPrice: number;
  isSellable: boolean;
}

export interface OfflineOrderItem {
  productId: string;
  name: string;
  variantId?: string | null;
  unit?: string;
  unitFactor?: number;
  quantity: number;
  unitPrice: number;
  discount?: CartDiscount | null;
}

export interface OfflineOrderPayment {
  method: "cash" | "qris" | "transfer";
  amount: number;
  cashReceived?: number;
  referenceNumber?: string;
  paid?: boolean;
}

export interface OfflineOrder {
  clientTxId: string;
  status: OfflineOrderStatus;
  createdAt: string;
  shiftId?: string | null;
  items: OfflineOrderItem[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  redeemValue: number;
  payments: OfflineOrderPayment[];
  customerId?: string | null;
  manualDiscount?: CartDiscount | null;
  redeemPoints?: number;
  serverResponse?: unknown;
  conflictMessage?: string | null;
  syncAttempts: number;
  operatorName?: string;
  storeName?: string;
}

export interface SyncStateValue {
  key: string;
  value: string | number | boolean;
  updatedAt: string;
}

/** Map produk dengan detail dari server → bentuk ringkas IDB */
export function toIDBProduct(p: Product): IDBProduct {
  return {
    id: p.id,
    categoryId: p.categoryId,
    sku: p.sku ?? null,
    barcode: p.barcode ?? null,
    name: p.name,
    categoryName: p.category?.name ?? null,
    unit: p.unit,
    sellingPrice: p.sellingPrice,
    trackStock: p.trackStock !== false,
    stockOnHand: p.stockOnHand,
    minStock: p.minStock,
    isTaxable: p.isTaxable,
    hasVariants: p.hasVariants === true,
    variantCount: p.variantCount ?? (p.variants?.length ?? 0),
    updatedAt: p.updatedAt?.toString() ?? p.categoryId,
    variants: (p.variants ?? []).map((v: ProductVariant) => ({
      id: v.id,
      name: v.name,
      sku: v.sku ?? null,
      barcode: v.barcode ?? null,
      sellingPrice: v.sellingPrice,
      stockOnHand: v.stockOnHand,
    })),
    units: (p.units ?? []).map((u: ProductUnit) => ({
      unit: u.unit,
      factor: u.factor,
      sellPrice: u.sellPrice,
      isSellable: u.isSellable,
    })),
  };
}

/**
 * Map IDBProduct → Product lengkap utk UI kasir.
 * `costPrice` = 0 (kasir TIDAK menerima harga modal di cache — SPEC §9.3).
 */
export function idbToProduct(p: IDBProduct): Product {
  const variants: ProductVariant[] = p.variants.map((v) => ({
    id: v.id,
    productId: p.id,
    name: v.name,
    sku: v.sku,
    barcode: v.barcode,
    costPrice: 0,
    sellingPrice: v.sellingPrice,
    stockOnHand: v.stockOnHand,
    minStock: 0,
    isActive: true,
  }));
  const units: ProductUnit[] = p.units.map((u, i) => ({
    id: `${p.id}-unit-${i}`,
    productId: p.id,
    unit: u.unit,
    factor: u.factor,
    sellPrice: u.sellPrice,
    isSellable: u.isSellable,
    isPurchaseUnit: false,
    minQty: 0,
  }));
  return {
    id: p.id,
    categoryId: p.categoryId,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    unit: p.unit,
    costPrice: 0,
    sellingPrice: p.sellingPrice,
    stockOnHand: p.stockOnHand,
    minStock: p.minStock,
    isActive: true,
    isTaxable: p.isTaxable,
    hasVariants: p.hasVariants,
    trackStock: p.trackStock,
    variantCount: p.variantCount,
    updatedAt: p.updatedAt,
    category: p.categoryName ? { name: p.categoryName } as Category : null,
    variants,
    units,
  };
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB tidak tersedia"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("products")) {
        const store = db.createObjectStore("products", { keyPath: "id" });
        store.createIndex("by_sku_barcode", "barcode");
        store.createIndex("by_name", "name");
      }
      if (!db.objectStoreNames.contains("offline_orders")) {
        const store = db.createObjectStore("offline_orders", { keyPath: "clientTxId" });
        store.createIndex("by_status", "status");
        store.createIndex("by_created", "createdAt");
      }
      if (!db.objectStoreNames.contains("sync_state")) {
        db.createObjectStore("sync_state", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.onerror = () => reject(t.error);
      })
  );
}

// ---------- Products ----------
export async function putProduct(p: IDBProduct): Promise<void> {
  await tx("products", "readwrite", (s) => s.put(p));
}

export async function putProducts(list: IDBProduct[]): Promise<void> {
  await openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction("products", "readwrite");
        const s = t.objectStore("products");
        list.forEach((p) => s.put(p));
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      })
  );
}

export async function clearProducts(): Promise<void> {
  await tx("products", "readwrite", (s) => s.clear());
}

export async function getAllProducts(): Promise<IDBProduct[]> {
  return tx<IDBProduct[]>("products", "readonly", (s) => s.getAll());
}

export async function getProduct(id: string): Promise<IDBProduct | undefined> {
  return tx<IDBProduct | undefined>("products", "readonly", (s) => s.get(id));
}

export async function searchProducts(q: string): Promise<IDBProduct[]> {
  const all = await getAllProducts();
  const needle = q.trim().toLowerCase();
  if (!needle) return all;
  return all.filter(
    (p) =>
      p.name.toLowerCase().includes(needle) ||
      (p.sku ?? "").toLowerCase().includes(needle) ||
      (p.barcode ?? "").toLowerCase().includes(needle) ||
      (p.categoryName ?? "").toLowerCase().includes(needle) ||
      p.variants.some(
        (v) =>
          (v.name ?? "").toLowerCase().includes(needle) ||
          (v.sku ?? "").toLowerCase().includes(needle) ||
          (v.barcode ?? "").toLowerCase().includes(needle)
      )
  );
}

export async function findProductByBarcode(barcode: string): Promise<IDBProduct | undefined> {
  const all = await getAllProducts();
  const needle = barcode.trim().toLowerCase();
  return all.find((p) => (p.barcode ?? "").toLowerCase() === needle);
}

// ---------- Offline orders ----------
export async function queueOfflineOrder(order: OfflineOrder): Promise<void> {
  await tx("offline_orders", "readwrite", (s) => s.put(order));
}

export async function updateOfflineOrder(
  clientTxId: string,
  patch: Partial<OfflineOrder>
): Promise<void> {
  const existing = await getOfflineOrder(clientTxId);
  if (!existing) return;
  await tx("offline_orders", "readwrite", (s) =>
    s.put({ ...existing, ...patch })
  );
}

export async function getOfflineOrder(
  clientTxId: string
): Promise<OfflineOrder | undefined> {
  return tx<OfflineOrder | undefined>("offline_orders", "readonly", (s) => s.get(clientTxId));
}

export async function getAllOfflineOrders(): Promise<OfflineOrder[]> {
  const all = await tx<OfflineOrder[]>("offline_orders", "readonly", (s) => s.getAll());
  return all.sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
  );
}

export async function getPendingOfflineOrders(): Promise<OfflineOrder[]> {
  const all = await getAllOfflineOrders();
  return all.filter((o) => o.status === "queued" || o.status === "conflict");
}

export async function deleteOfflineOrder(clientTxId: string): Promise<void> {
  await tx("offline_orders", "readwrite", (s) => s.delete(clientTxId));
}

export async function countOfflineOrders(): Promise<number> {
  const all = await getAllOfflineOrders();
  return all.filter((o) => o.status !== "done").length;
}

// ---------- Sync state ----------
export async function setSyncState(key: string, value: string | number | boolean): Promise<void> {
  await tx("sync_state", "readwrite", (s) =>
    s.put({ key, value, updatedAt: new Date().toISOString() } satisfies SyncStateValue)
  );
}

export async function getSyncState(key: string): Promise<SyncStateValue | undefined> {
  return tx<SyncStateValue | undefined>("sync_state", "readonly", (s) => s.get(key));
}
