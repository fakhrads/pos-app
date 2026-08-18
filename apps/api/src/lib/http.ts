/**
 * Helper HTTP umum: envelope respons, pagination, CSV, slug, format Rupiah.
 * Envelope konsisten: { ok: true, data } / { ok: false, error: { code, message, details? } }
 * (api-design.md §1.2)
 */

export function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

export function errorEnvelope(
  code: string,
  message: string,
  details?: unknown,
): { ok: false; error: { code: string; message: string; details?: unknown } } {
  return { ok: false, error: details === undefined ? { code, message } : { code, message, details } };
}

/* ---------------- Pagination (api-design.md §1.3) ---------------- */

export interface PaginationQuery {
  page: number;
  perPage: number;
}

export function parsePagination(q: Record<string, string | undefined>): PaginationQuery {
  const page = Math.max(1, Number.parseInt(q.page ?? '1', 10) || 1);
  const perPageRaw = Number.parseInt(q.perPage ?? '20', 10) || 20;
  const perPage = Math.min(100, Math.max(1, perPageRaw));
  return { page, perPage };
}

export function paginationMeta(page: number, perPage: number, total: number) {
  return {
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

/** Parse query `sort=-created_at` → order oleh pemanggil; whitelist kolom di route. */
export function parseSort(q: Record<string, string | undefined>, allowed: string[]): { field: string; dir: 'asc' | 'desc' } | null {
  const raw = q.sort;
  if (!raw) return null;
  const dir: 'asc' | 'desc' = raw.startsWith('-') ? 'desc' : 'asc';
  const field = (dir === 'desc' ? raw.slice(1) : raw).trim();
  if (!allowed.includes(field)) return null;
  return { field, dir };
}

/* ---------------- CSV (api-design.md §2.11, REP-05) ---------------- */

/**
 * Konversi array of objects → CSV. Nilai dipisah `;` (Excel id-ID pakai ;
 * sebagai delimiter — kompatibel Excel & Google Sheets). Prefix BOM UTF-8.
 */
export function toCsv(rows: Record<string, unknown>[], columns?: { key: string; label: string }[]): string {
  if (rows.length === 0) return '\uFEFF';
  const cols =
    columns ??
    Object.keys(rows[0]!).map((k) => ({
      key: k,
      label: k,
    }));
  const escape = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.map((c) => escape(c.label)).join(';');
  const lines = rows.map((r) => cols.map((c) => escape(r[c.key])).join(';'));
  return '\uFEFF' + [header, ...lines].join('\r\n');
}

/* ---------------- Misc ---------------- */

/** Slug sederhana untuk kategori: "Makanan & Minuman" → "makanan-minuman" */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export function formatIdr(n: number): string {
  return `Rp ${new Intl.NumberFormat('id-ID').format(n)}`;
}

/** Ambil IP klien dari header proxy (Dokploy/Traefik); null bila tidak diketahui.
 *  Jangan pernah mengirim string 'unknown' ke kolom INET — PG menolak (22P02). */
export function clientIp(headers: Record<string, string | undefined>): string | null {
  const fwd = headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0]!.trim();
  const real = headers['x-real-ip'];
  if (real && real.trim() !== '') return real.trim();
  return null;
}

/** Rentang waktu hari ini dalam timezone toko (default Asia/Jakarta) → [start, end) UTC. */
export function todayRangeWib(tz = 'Asia/Jakarta'): { from: Date; to: Date } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = fmt.formatToParts(now);
  const map = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const y = Number(map.year);
  const m = Number(map.month);
  const d = Number(map.day);
  // Waktu 00:00 WIB dikonversi ke UTC: WIB = UTC+7
  const from = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 7 * 3600 * 1000);
  const to = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0) - 7 * 3600 * 1000);
  return { from, to };
}
