/**
 * FakhriPOS Design Tokens v2
 * 
 * Modern flat design — referensi: Linear, Vercel Dashboard, Tokopedia
 * Accent: Blue (#0066FF) — netral, profesional
 */

// ============================================================
// COLORS — Light Mode
// ============================================================
export const lightColors = {
  // Surface scale
  surface: {
    DEFAULT: "#FAFBFC",
    raised: "#FFFFFF",
    sunken: "#F1F3F5",
  },

  // Border scale
  border: {
    DEFAULT: "#E2E5E9",
    strong: "#CDD1D6",
  },

  // Text scale
  text: {
    primary: "#1A1D21",
    secondary: "#5F6B7A",
    muted: "#8C95A0",
  },

  // Brand accent — Blue
  accent: {
    DEFAULT: "#0066FF",
    hover: "#0052CC",
    subtle: "#EBF2FF",
    fg: "#FFFFFF",
  },

  // Semantic colors
  success: {
    DEFAULT: "#16A34A",
    subtle: "#DCFCE7",
    fg: "#FFFFFF",
  },
  warning: {
    DEFAULT: "#D97706",
    subtle: "#FEF3C7",
    fg: "#FFFFFF",
  },
  danger: {
    DEFAULT: "#DC2626",
    subtle: "#FEE2E2",
    fg: "#FFFFFF",
  },
  info: {
    DEFAULT: "#2563EB",
    subtle: "#DBEAFE",
    fg: "#FFFFFF",
  },

  // Skeleton
  skeleton: {
    base: "#E8EBED",
    shine: "#F4F5F7",
  },
} as const;

// ============================================================
// COLORS — Dark Mode
// ============================================================
export const darkColors = {
  // Surface scale — blue-tinted dark
  surface: {
    DEFAULT: "#0F1218",
    raised: "#1A1F2B",
    sunken: "#0A0D12",
  },

  // Border scale
  border: {
    DEFAULT: "#2A3040",
    strong: "#3D4556",
  },

  // Text scale — not pure white
  text: {
    primary: "#EBEDF0",
    secondary: "#8B95A5",
    muted: "#5C6678",
  },

  // Brand accent — brighter for dark bg
  accent: {
    DEFAULT: "#4D94FF",
    hover: "#3D80E6",
    subtle: "#1A2744",
    fg: "#FFFFFF",
  },

  // Semantic colors — brighter for dark bg
  success: {
    DEFAULT: "#34D399",
    subtle: "#0D3326",
    fg: "#FFFFFF",
  },
  warning: {
    DEFAULT: "#FBBF24",
    subtle: "#3D2E0A",
    fg: "#000000",
  },
  danger: {
    DEFAULT: "#F87171",
    subtle: "#3D1212",
    fg: "#FFFFFF",
  },
  info: {
    DEFAULT: "#60A5FA",
    subtle: "#0F1D3D",
    fg: "#FFFFFF",
  },

  // Skeleton — lighter than surface in dark mode
  skeleton: {
    base: "#1E2430",
    shine: "#283040",
  },
} as const;

// ============================================================
// SPACING — 4px grid
// ============================================================
export const spacing = {
  px: "1px",
  0: "0",
  0.5: "2px",
  1: "4px",
  1.5: "6px",
  2: "8px",
  2.5: "10px",
  3: "12px",
  3.5: "14px",
  4: "16px",
  5: "20px",
  6: "24px",
  7: "28px",
  8: "32px",
  9: "36px",
  10: "40px",
  12: "48px",
  14: "56px",
  16: "64px",
  20: "80px",
  24: "96px",
} as const;

// ============================================================
// RADIUS — 3 levels per spec
// ============================================================
export const radius = {
  none: "0",
  sm: "8px",   // badge, input, tombol kecil
  md: "12px",  // card, dropdown
  lg: "16px",  // sheet, modal, dialog
  full: "9999px",
} as const;

// ============================================================
// SHADOW — 3 levels
// ============================================================
export const shadows = {
  sm: "0 1px 2px rgba(0,0,0,.06)",
  md: "0 4px 12px rgba(0,0,0,.08)",
  lg: "0 12px 32px rgba(0,0,0,.12)",
} as const;

// Dark mode: borders replace shadows
export const darkShadows = {
  sm: "none",
  md: "none",
  lg: "none",
} as const;

// ============================================================
// TYPOGRAPHY
// ============================================================
export const typography = {
  fontSize: {
    xs: "0.75rem",    // 12px — caption, badge
    sm: "0.875rem",   // 14px — body kecil, helper
    base: "1rem",     // 16px — body utama
    lg: "1.125rem",   // 18px — heading
    xl: "1.25rem",    // 20px — nominal angka
    "2xl": "1.5rem",  // 24px — sub-judul
    "3xl": "1.75rem", // 28px — total bayar kasir
  },
  fontWeight: {
    normal: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
  },
  lineHeight: {
    tight: "1.25",
    normal: "1.5",
    relaxed: "1.625",
  },
} as const;

// ============================================================
// DENSITY — touch targets & row heights
// ============================================================
export const density = {
  // Minimum touch target
  touchMin: "48px",
  // Table rows
  tableRow: "48px",
  tableRowCompact: "40px",
  // Inputs
  inputSm: "36px",
  inputMd: "40px",
  inputLg: "48px",
  // Buttons
  btnSm: "36px",
  btnMd: "40px",
  btnLg: "48px",
  // Bottom nav height
  bottomNav: "64px",
} as const;

// ============================================================
// TRANSITIONS
// ============================================================
export const transitions = {
  fast: "150ms cubic-bezier(0.4, 0, 0.2, 1)",
  normal: "200ms cubic-bezier(0.4, 0, 0.2, 1)",
  slow: "300ms cubic-bezier(0.4, 0, 0.2, 1)",
} as const;

// ============================================================
// TERM MAPPING — Bahasa manusia
// ============================================================
export const termMapping: Record<string, string> = {
  // Developer → User
  "SKU": "Kode Barang",
  "COGS": "Modal Barang",
  "HPP": "Modal Barang",
  "Stock Adjustment": "Koreksi Stok",
  "Reconciliation": "Cocokkan Uang Kas",
  "Void Transaction": "Batalkan Transaksi",
  "Gross Margin": "Untung Kotor",
  "Outstanding AR": "Piutang Belum Dibayar",
  "Cost Price": "Harga Modal",
  "Selling Price": "Harga Jual",
  "Stock On Hand": "Stok Tersedia",
  "Min Stock": "Stok Minimum",
  "Is Active": "Aktif",
  "Is Taxable": "Kena Pajak",
  "Payment Method": "Cara Bayar",
  "Payment Status": "Status Bayar",
  "Transaction Status": "Status Transaksi",
  "Discount Type": "Jenis Diskon",
  "Discount Scope": "Cakupan Diskon",
  "Refund Method": "Cara Refund",
  "Return Status": "Status Retur",
  "Point Movement": "Pergerakan Poin",
  "Movement Type": "Jenis Pergerakan",
  "Audit Log": "Riwayat Aktivitas",
  "Created At": "Dibuat",
  "Updated At": "Diubah",
  "Deleted At": "Dihapus",
  "User Role": "Peran Pengguna",
  "Membership Tier": "Level Member",
};
