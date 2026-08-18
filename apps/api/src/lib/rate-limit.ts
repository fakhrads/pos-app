/**
 * Rate limit in-memory (single instance homelab):
 *  - login: 5 percobaan gagal beruntun per akun+IP → blokir 5 menit (429 RATE_LIMITED)
 *  - umum: 120 req/mnt/user; POST /transactions 30 req/mnt/user
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const loginFails = new Map<string, { count: number; blockedUntil: number }>();

const LOGIN_MAX_FAILS = 5;
const LOGIN_BLOCK_MS = 5 * 60_000;

/** Fixed-window limiter. Return true = diizinkan, false = rate limited. */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= max) return false;
  b.count += 1;
  return true;
}

export function loginBlocked(key: string): boolean {
  const f = loginFails.get(key);
  return !!f && f.blockedUntil > Date.now();
}

export function recordLoginFail(key: string): void {
  const now = Date.now();
  const f = loginFails.get(key);
  if (!f) {
    loginFails.set(key, { count: 1, blockedUntil: 0 });
    return;
  }
  // Blokir lama sudah kedaluwarsa → mulai hitung ulang (blockedUntil=0 = belum pernah blokir)
  if (f.blockedUntil > 0 && now >= f.blockedUntil) {
    loginFails.set(key, { count: 1, blockedUntil: 0 });
    return;
  }
  f.count += 1;
  if (f.count >= LOGIN_MAX_FAILS) {
    f.blockedUntil = now + LOGIN_BLOCK_MS;
    f.count = 0;
  }
}

export function resetLoginFails(key: string): void {
  loginFails.delete(key);
}

// Pembersihan berkala map rate-limit (jangan membesar tanpa batas)
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k);
  for (const [k, f] of loginFails) if (f.blockedUntil > 0 && now >= f.blockedUntil) loginFails.delete(k);
}, 60_000).unref?.();
