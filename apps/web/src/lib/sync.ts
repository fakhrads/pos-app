import { api, ApiError } from "@/lib/api";
import {
  countOfflineOrders,
  getPendingOfflineOrders,
  getSyncState,
  IDBProduct,
  OfflineOrder,
  putProducts,
  setSyncState,
  toIDBProduct,
  updateOfflineOrder,
} from "@/lib/offline-db";
import type { CheckoutResult, Product } from "@/lib/types";

// ============================================================
// Sync engine offline (SPEC Fase 7 §4, §6.3)
//  ▶ pull katalog: GET /sync/catalog (fallback /products) → IDB products
//  ▶ kirim transaksi offline: POST /transactions + Idempotency-Key (FIFO)
//  ▶ dipicu oleh: event online, tab focus, dan background sync SW
// ============================================================

export const SYNC_EVENT = "fakhripos:sync";

/** Beri tahu UI (indicator/panel) bahwa state antrean berubah */
export function emitSyncChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SYNC_EVENT));
}

let syncing = false;
let listening = false;

/** Pull katalog → IDB. `since` = delta; default full snapshot. */
export async function pullCatalog(since?: string): Promise<{ count: number; serverTime?: string }> {
  try {
    const data = await api.get<{
      items: Product[];
      deletedIds?: string[];
      serverTime?: string;
    }>("/sync/catalog", since ? { since } : undefined);
    const items = (data.items ?? []).map(toIDBProduct);
    await putProducts(items);
    await setSyncState("products.lastSyncedAt", new Date().toISOString());
    if (data.serverTime) await setSyncState("products.serverTime", data.serverTime);
    emitSyncChange();
    return { count: items.length, serverTime: data.serverTime };
  } catch (err) {
    // Endpoint /sync/catalog bisa belum ada (backend masih dikerjakan).
    // Fallback: pakai /products page-1 agar katalog tetap ter-cache.
    if (err instanceof ApiError && (err.status === 404 || err.status === 405)) {
      try {
        const data = await api.get<{ items: Product[] }>("/products", {
          isActive: true,
          perPage: 200,
          page: 1,
        });
        const items = (data.items ?? []).map(toIDBProduct);
        await putProducts(items);
        await setSyncState("products.lastSyncedAt", new Date().toISOString());
        emitSyncChange();
        return { count: items.length };
      } catch {
        throw err;
      }
    }
    throw err;
  }
}

/** Konversi order offline → body POST /transactions (SPEC §4.2) */
function toCheckoutBody(order: OfflineOrder) {
  return {
    customerId: order.customerId ?? undefined,
    items: order.items.map((i) => ({
      productId: i.productId,
      variantId: i.variantId ?? undefined,
      unit: i.unit ?? undefined,
      quantity: i.quantity,
      discount: i.discount ?? undefined,
    })),
    manualDiscount: order.manualDiscount ?? undefined,
    redeemPoints: order.redeemPoints && order.redeemPoints > 0 ? order.redeemPoints : undefined,
    payments: order.payments.map((p) => ({
      method: p.method,
      amount: p.amount,
      cashReceived: p.method === "cash" && p.cashReceived != null ? p.cashReceived : undefined,
      referenceNumber:
        p.method === "transfer" && p.referenceNumber?.trim()
          ? p.referenceNumber.trim()
          : undefined,
    })),
  };
}

const CONFLICT_CODES = new Set(["STOCK_INSUFFICIENT", "SHIFT_REQUIRED", "VALIDATION"]);

/** Sinkronkan satu transaksi offline → server (idempotent via Idempotency-Key) */
export async function syncOneOrder(order: OfflineOrder): Promise<OfflineOrder["status"]> {
  if (order.status === "done") return "done";

  await updateOfflineOrder(order.clientTxId, {
    status: "syncing",
    syncAttempts: (order.syncAttempts || 0) + 1,
  });
  emitSyncChange();

  try {
    const result = await api.post<CheckoutResult>(
      "/transactions",
      toCheckoutBody(order),
      { headers: { "Idempotency-Key": order.clientTxId } }
    );
    await updateOfflineOrder(order.clientTxId, {
      status: "done",
      serverResponse: result,
      conflictMessage: null,
    });
    emitSyncChange();
    return "done";
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        // Token kedaluwarsa → pause, jangan hapus antrean
        await updateOfflineOrder(order.clientTxId, {
          status: order.status === "conflict" ? "conflict" : "queued",
        });
        emitSyncChange();
        return "queued";
      }
      if (err.status === 409 && CONFLICT_CODES.has(err.code)) {
        await updateOfflineOrder(order.clientTxId, {
          status: "conflict",
          conflictMessage: `${err.message} (${err.code})`,
        });
        emitSyncChange();
        return "conflict";
      }
      // 5xx / 4xx lain → jaringan/proxy masalah → retry nanti
      await updateOfflineOrder(order.clientTxId, {
        status: order.status === "conflict" ? "conflict" : "queued",
      });
      emitSyncChange();
      return "queued";
    }
    // NETWORK_ERROR → retry nanti
    await updateOfflineOrder(order.clientTxId, {
      status: order.status === "conflict" ? "conflict" : "queued",
    });
    emitSyncChange();
    return "queued";
  }
}

/**
 * Jalankan sinkronisasi antrean (FIFO). `includeConflict=false` saat otomatis
 * (konflik butuh intervensi manual → dilewati, tidak memblokir antrean).
 * Setelah semua selesai → refresh katalog agar stok & harga terbaru.
 */
export async function runSync({
  force = false,
  includeConflict = false,
}: { force?: boolean; includeConflict?: boolean } = {}): Promise<{
  done: number;
  conflict: number;
  skipped: number;
}> {
  if (typeof navigator !== "undefined" && !navigator.onLine && !force) {
    return { done: 0, conflict: 0, skipped: 0 };
  }
  if (syncing) return { done: 0, conflict: 0, skipped: 0 };
  syncing = true;
  const result = { done: 0, conflict: 0, skipped: 0 };
  try {
    const pending = await getPendingOfflineOrders();
    for (const order of pending) {
      // Konflik tidak diproses otomatis tanpa `includeConflict`
      if (order.status === "conflict" && !includeConflict) {
        result.skipped += 1;
        continue;
      }
      const status = await syncOneOrder(order);
      if (status === "done") result.done += 1;
      else if (status === "conflict") result.conflict += 1;
      else result.skipped += 1;
    }

    // Refresh katalog setelah antrean bersih (SPEC §6.3)
    const remaining = await countOfflineOrders();
    if (remaining === 0) {
      try {
        await pullCatalog();
      } catch {
        // pull gagal → abaikan, belum tentu fatal
      }
    }
    emitSyncChange();
    return result;
  } finally {
    syncing = false;
  }
}

/** Tangani pesan dari service worker (mis. pemicu background sync) */
function onMessage(event: MessageEvent) {
  const data = event.data as { type?: string } | undefined;
  if (data?.type === "FAKHRI_SYNC") {
    void runSync();
  }
}

/** Registrasi background sync native (jika didukung) + fallback online/focus */
export async function registerBackgroundSync(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  // Pemicu dari SW (doa event 'sync' di sw.ts)
  navigator.serviceWorker.addEventListener("message", onMessage);

  // Fallback 1: event online
  window.addEventListener("online", () => void runSync());

  // Fallback 2: tab kembali fokus
  window.addEventListener("focus", () => void runSync());

  // Registrasi tag background sync native
  try {
    const reg = await navigator.serviceWorker.ready;
    const sync = (reg as unknown as { sync?: { register: (tag: string) => Promise<void> } }).sync;
    if (sync) {
      await sync.register("fakhripos-sync");
    }
  } catch {
    // tidak didukung / private mode → fallback online/focus sudah cukup
  }

  // Jalankan sekali saat aplikasi dibuka (recovery crash — SPEC §7.3.6)
  if (typeof navigator !== "undefined" && navigator.onLine) {
    void runSync();
  }
}

/** Katalog kira-kira basi (SPEC §3.2: stale_after_days)? null = belum pernah sync */
export async function catalogAgeMs(): Promise<number | null> {
  const st = await getSyncState("products.lastSyncedAt");
  if (!st) return null;
  const last = new Date(String(st.value)).getTime();
  if (Number.isNaN(last)) return null;
  return Date.now() - last;
}

/** Tandai cache produk basi dibanding ambang (hari) */
export async function isCatalogStale(staleAfterDays: number): Promise<boolean> {
  const age = await catalogAgeMs();
  if (age === null) return true;
  return age > staleAfterDays * 24 * 60 * 60 * 1000;
}
