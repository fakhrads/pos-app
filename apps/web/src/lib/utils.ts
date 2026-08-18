import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format angka rupiah integer: 15000 -> "Rp 15.000" */
export function formatIDR(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "Rp 0";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

/** Format tanpa simbol mata uang: 15000 -> "15.000" */
export function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "0";
  return new Intl.NumberFormat("id-ID").format(value);
}

/** Tanggal + jam dalam WIB (Asia/Jakarta) */
export function formatDateTime(
  iso: string | null | undefined,
  opts: { date?: boolean; time?: boolean } = { date: true, time: true }
): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const parts: Intl.DateTimeFormatOptions = {
    timeZone: "Asia/Jakarta",
  };
  if (opts.date !== false)
    Object.assign(parts, { day: "2-digit", month: "short", year: "numeric" });
  if (opts.time !== false)
    Object.assign(parts, { hour: "2-digit", minute: "2-digit", hour12: false });
  return new Intl.DateTimeFormat("id-ID", parts).format(d);
}

/** Tanggal saja dalam WIB: 2026-08-18 */
export function formatDateWIB(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Hari ini dalam WIB sebagai YYYY-MM-DD (untuk input date) */
export function todayWIB(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** 7 hari terakhir (inklusif hari ini) dalam WIB, YYYY-MM-DD */
export function lastNDaysWIB(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    out.push(`${get("year")}-${get("month")}-${get("day")}`);
  }
  return out;
}

/** Debounce sederhana */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms = 300
) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Unduh file CSV (UTF-8 + BOM agar kompatibel Excel/Google Sheets) */
export function downloadCSV(
  filename: string,
  rows: (string | number | null | undefined)[][]
) {
  const escape = (v: string | number | null | undefined) => {
    const s = String(v ?? "");
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(escape).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Generate Idempotency-Key (UUID v4) untuk mencegah double-submit checkout */
export function uuidv4(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Label metode pembayaran */
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: "Tunai",
  qris: "QRIS",
  transfer: "Transfer",
};

/** Label role */
export const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  manager: "Manager",
  kasir: "Kasir",
};

/** Label status transaksi */
export const TX_STATUS_LABEL: Record<string, string> = {
  completed: "Selesai",
  cancelled: "Dibatalkan",
  pending: "Tertunda",
};
