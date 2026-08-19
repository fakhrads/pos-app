/**
 * FakhriPOS Design Tokens
 * 
 * Modern flat design — referensi: Linear, Vercel Dashboard, Notion
 * 
 * Struktur:
 * - Colors: 1 accent + neutral 50-950 + semantic (success/warning/danger/info)
 * - Spacing: 4px grid
 * - Radius: 3 levels (sm/md/lg)
 * - Shadow: 3 levels
 * - Typography: 4 sizes + 2 weights
 */

// ============================================================
// COLORS — Light Mode
// ============================================================
export const lightColors = {
  // Brand accent (cyan)
  accent: {
    50: "oklch(0.97 0.02 192)",
    100: "oklch(0.93 0.04 192)",
    200: "oklch(0.87 0.08 192)",
    300: "oklch(0.78 0.12 192)",
    400: "oklch(0.68 0.16 192)",
    500: "oklch(0.55 0.15 192)", // Primary accent
    600: "oklch(0.48 0.14 192)",
    700: "oklch(0.42 0.12 192)",
    800: "oklch(0.35 0.10 192)",
    900: "oklch(0.28 0.08 192)",
    950: "oklch(0.20 0.06 192)",
  },

  // Neutral scale (zinc-like)
  neutral: {
    50: "oklch(0.985 0 0)",
    100: "oklch(0.967 0 0)",
    200: "oklch(0.922 0 0)",
    300: "oklch(0.872 0 0)",
    400: "oklch(0.708 0 0)",
    500: "oklch(0.556 0 0)",
    600: "oklch(0.439 0 0)",
    700: "oklch(0.355 0 0)",
    800: "oklch(0.269 0 0)",
    900: "oklch(0.205 0 0)",
    950: "oklch(0.145 0 0)",
  },

  // Semantic colors
  success: {
    DEFAULT: "oklch(0.55 0.18 162)",
    muted: "oklch(0.55 0.18 162 / 0.1)",
  },
  warning: {
    DEFAULT: "oklch(0.75 0.18 85)",
    muted: "oklch(0.75 0.18 85 / 0.1)",
  },
  danger: {
    DEFAULT: "oklch(0.58 0.24 27)",
    muted: "oklch(0.58 0.24 27 / 0.1)",
  },
  info: {
    DEFAULT: "oklch(0.55 0.17 280)",
    muted: "oklch(0.55 0.17 280 / 0.1)",
  },
} as const;

// ============================================================
// COLORS — Dark Mode
// ============================================================
export const darkColors = {
  // Brand accent (same hue, brighter for dark bg)
  accent: {
    50: "oklch(0.20 0.06 192)",
    100: "oklch(0.25 0.08 192)",
    200: "oklch(0.30 0.10 192)",
    300: "oklch(0.38 0.12 192)",
    400: "oklch(0.48 0.14 192)",
    500: "oklch(0.58 0.16 192)", // Primary accent
    600: "oklch(0.68 0.16 192)",
    700: "oklch(0.78 0.14 192)",
    800: "oklch(0.87 0.12 192)",
    900: "oklch(0.93 0.08 192)",
    950: "oklch(0.97 0.04 192)",
  },

  // Neutral scale (inverted for dark)
  neutral: {
    50: "oklch(0.145 0 0)",
    100: "oklch(0.18 0 0)",
    200: "oklch(0.22 0 0)",
    300: "oklch(0.28 0 0)",
    400: "oklch(0.35 0 0)",
    500: "oklch(0.45 0 0)",
    600: "oklch(0.55 0 0)",
    700: "oklch(0.65 0 0)",
    800: "oklch(0.80 0 0)",
    900: "oklch(0.90 0 0)",
    950: "oklch(0.985 0 0)",
  },

  // Semantic colors (brighter for dark bg)
  success: {
    DEFAULT: "oklch(0.65 0.18 162)",
    muted: "oklch(0.65 0.18 162 / 0.15)",
  },
  warning: {
    DEFAULT: "oklch(0.80 0.18 85)",
    muted: "oklch(0.80 0.18 85 / 0.15)",
  },
  danger: {
    DEFAULT: "oklch(0.65 0.22 27)",
    muted: "oklch(0.65 0.22 27 / 0.15)",
  },
  info: {
    DEFAULT: "oklch(0.65 0.17 280)",
    muted: "oklch(0.65 0.17 280 / 0.15)",
  },
} as const;

// ============================================================
// SPACING — 4px grid
// ============================================================
export const spacing = {
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
// RADIUS — 3 levels
// ============================================================
export const radius = {
  sm: "6px",
  md: "10px",
  lg: "14px",
  full: "9999px",
} as const;

// ============================================================
// SHADOW — 3 levels
// Light: subtle elevation
// Dark: stronger borders instead
// ============================================================
export const shadows = {
  // Level 1: Subtle (cards at rest)
  sm: "0 1px 2px rgba(0,0,0,.04), 0 1px 3px rgba(0,0,0,.06)",
  // Level 2: Medium (dropdowns, popovers)
  md: "0 2px 4px rgba(0,0,0,.04), 0 4px 12px rgba(0,0,0,.08)",
  // Level 3: High (modals, dialogs)
  lg: "0 4px 8px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.12)",
} as const;

export const darkShadows = {
  sm: "0 0 0 1px rgba(255,255,255,.06), 0 1px 2px rgba(0,0,0,.3)",
  md: "0 0 0 1px rgba(255,255,255,.08), 0 4px 12px rgba(0,0,0,.4)",
  lg: "0 0 0 1px rgba(255,255,255,.10), 0 8px 24px rgba(0,0,0,.5)",
} as const;

// ============================================================
// TYPOGRAPHY — 4 sizes + 2 weights
// ============================================================
export const typography = {
  fontSize: {
    xs: "0.75rem",    // 12px — captions, labels
    sm: "0.875rem",   // 14px — body small, table cells
    base: "1rem",     // 16px — body
    lg: "1.125rem",   // 18px — headings
  },
  fontWeight: {
    normal: "400",
    medium: "500",
    semibold: "600",
  },
  lineHeight: {
    tight: "1.25",
    normal: "1.5",
    relaxed: "1.625",
  },
  letterSpacing: {
    tight: "-0.01em",
    normal: "0",
  },
} as const;

// ============================================================
// DENSITY
// ============================================================
export const density = {
  // Table row height
  tableRow: "44px",
  // Input height
  inputSm: "32px",
  inputMd: "36px",
  inputLg: "40px",
  // Button height
  btnSm: "32px",
  btnMd: "36px",
  btnLg: "40px",
} as const;

// ============================================================
// TRANSITIONS
// ============================================================
export const transitions = {
  fast: "150ms cubic-bezier(0.4, 0, 0.2, 1)",
  normal: "200ms cubic-bezier(0.4, 0, 0.2, 1)",
  slow: "300ms cubic-bezier(0.4, 0, 0.2, 1)",
} as const;
