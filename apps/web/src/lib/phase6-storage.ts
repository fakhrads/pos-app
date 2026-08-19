"use client";

/**
 * Phase 6 — Rich Content (frontend-only) localStorage helper
 *
 * Menyimpan semua data "Rich Content" secara client-side:
 * - onboarding (profil usaha dari wizard 6 langkah)
 * - practice mode (mode latihan)
 * - module intros (daftar pengantar modul yang sudah dilihat)
 *
 * Referensi: SPEC Fase 6 §3 (Model Data) — semua disimpan di localStorage,
 * bukan di server. Key prefix `fakhripos.phase6.` untuk menghindari bentrok.
 */

export interface OnboardingProfile {
  completed: boolean;
  businessName: string;
  businessType: string;
  outlets: number;
  sellsProduct: boolean;
  sellsService: boolean;
  trackStock: boolean;
  hasStaff: boolean;
}

export const DEFAULT_ONBOARDING: OnboardingProfile = {
  completed: false,
  businessName: "",
  businessType: "",
  outlets: 1,
  sellsProduct: true,
  sellsService: false,
  trackStock: true,
  hasStaff: false,
};

export interface Phase6State {
  onboarding: OnboardingProfile;
  practiceMode: boolean;
  modulesIntrosSeen: string[];
  /** Transaksi latihan (practice) — hanya tersimpan di sini, tidak ke server */
  practiceTransactions: unknown[];
}

const KEYS = {
  onboarding: "fakhripos.phase6.onboarding",
  practiceMode: "fakhripos.phase6.practiceMode",
  intros: "fakhripos.phase6.modulesIntrosSeen",
  transactions: "fakhripos.phase6.practiceTransactions",
} as const;

function safeRead<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWrite(key: string, value: unknown): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // localStorage penuh / private mode — kasus tepi SPEC §7.1
    return false;
  }
}

function safeRemove(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}

// ============================================================
// ONBOARDING
// ============================================================

export function getOnboarding(): OnboardingProfile {
  const stored = safeRead<Partial<OnboardingProfile>>(KEYS.onboarding, {});
  return { ...DEFAULT_ONBOARDING, ...stored };
}

export function isOnboardingCompleted(): boolean {
  return getOnboarding().completed;
}

/**
 * Simpan profil onboarding. Kembalikan `false` jika localStorage gagal
 * (mis. penyimpanan penuh) — wizard harus menampilkan pesan error.
 */
export function saveOnboarding(profile: OnboardingProfile): boolean {
  return safeWrite(KEYS.onboarding, profile);
}

/** Reset onboarding (dipanggil dari Pengaturan, dengan konfirmasi) */
export function resetOnboarding(): void {
  safeRemove(KEYS.onboarding);
}

// ============================================================
// PRACTICE MODE
// ============================================================

export function getPracticeMode(): boolean {
  return safeRead<boolean>(KEYS.practiceMode, false);
}

/**
 * Aktifkan/nonaktifkan Mode Latihan.
 * Ketika NONAKTIF → data latihan dihapus dari localStorage (SPEC §6 Mode Latihan).
 * Mengembalikan `false` jika gagal menyimpan (penyimpanan penuh).
 */
export function setPracticeMode(active: boolean): boolean {
  if (!active) {
    safeRemove(KEYS.transactions);
    return safeWrite(KEYS.practiceMode, false);
  }
  return safeWrite(KEYS.practiceMode, true);
}

// ============================================================
// MODULE INTROS
// ============================================================

export function getModulesIntrosSeen(): string[] {
  return safeRead<string[]>(KEYS.intros, []);
}

/**
 * Tandai sebuah modul sudah dilihat pengantarnya.
 * Daftar disimpan di `modulesIntrosSeen[]` (SPEC §3).
 */
export function markModuleIntroSeen(moduleId: string): boolean {
  const seen = getModulesIntrosSeen();
  if (seen.includes(moduleId)) return true;
  const ok = safeWrite(KEYS.intros, [...seen, moduleId]);
  return ok;
}

export function hasSeenModuleIntro(moduleId: string): boolean {
  return getModulesIntrosSeen().includes(moduleId);
}

// ============================================================
// PRACTICE TRANSACTIONS (localStorage-only)
// ============================================================

/**
 * Simpan satu transaksi latihan ke localStorage (tidak menyentuh server).
 * Gunakan ini ketika Mode Latihan aktif.
 */
export function addPracticeTransaction(tx: unknown): boolean {
  const list = safeRead<unknown[]>(KEYS.transactions, []);
  list.push(tx);
  return safeWrite(KEYS.transactions, list);
}

export function getPracticeTransactions(): unknown[] {
  return safeRead<unknown[]>(KEYS.transactions, []);
}

export function clearPracticeTransactions(): void {
  safeRemove(KEYS.transactions);
}

/** Kapasitas localStorage tersisa (dalam byte), untuk cek "penyimpanan penuh". */
export function localStorageRemainingBytes(): number {
  if (typeof window === "undefined") return 0;
  try {
    let total = 0;
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      const v = window.localStorage.getItem(k) ?? "";
      total += k.length + v.length;
    }
    // Estimasi kuota ~ 5MB alias 5_000_000 char-unit
    return Math.max(0, 5_000_000 - total);
  } catch {
    return 0;
  }
}
