/**
 * Idempotensi checkout (spec/db-schema.md §8.6, api-design.md §2.9).
 * Header `Idempotency-Key` wajib di POST /transactions → dedupe double-submit
 * tombol "Bayar" selama 5 menit. Replay mengembalikan transaksi asli.
 *
 * Implementasi in-memory (single instance homelab):
 *  - key baru        → status 'new'        (proses)
 *  - key 'processing'→ status 'processing' (request paralel → 409)
 *  - key 'done'      → status 'replay'     (kembalikan transaksi tersimpan)
 */
interface IdemEntry {
  state: 'processing' | 'done';
  transactionId?: string;
  at: number;
}

const store = new Map<string, IdemEntry>();
const TTL_MS = 5 * 60_000;

export type IdemReserve =
  | { status: 'new' }
  | { status: 'processing' }
  | { status: 'replay'; transactionId: string };

export function reserveIdempotency(key: string): IdemReserve {
  const now = Date.now();
  sweep(now);
  const existing = store.get(key);
  if (existing && now - existing.at < TTL_MS) {
    if (existing.state === 'processing') return { status: 'processing' };
    return { status: 'replay', transactionId: existing.transactionId! };
  }
  store.set(key, { state: 'processing', at: now });
  return { status: 'new' };
}

export function completeIdempotency(key: string, transactionId: string): void {
  const e = store.get(key);
  if (e) {
    e.state = 'done';
    e.transactionId = transactionId;
    e.at = Date.now();
  }
}

export function clearIdempotency(key: string): void {
  store.delete(key);
}

function sweep(now: number): void {
  if (store.size < 500) return;
  for (const [k, v] of store) {
    if (now - v.at >= TTL_MS) store.delete(k);
  }
}
