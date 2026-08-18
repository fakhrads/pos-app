// ============================================================
// Penyimpanan sesi: localStorage (token untuk API call) +
// mirror cookie (agar Next.js middleware bisa guard route).
// Cookie bukan httpOnly — keamanan sesungguhnya dipegang backend.
// ============================================================

import type { Role, User } from "./types";

const ACCESS_KEY = "pos.accessToken";
const REFRESH_KEY = "pos.refreshToken";
const USER_KEY = "pos.user";
const COOKIE_NAME = "pos_token";

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(REFRESH_KEY);
}

export function getStoredUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function setCookie(value: string, maxAgeSeconds: number) {
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(
    value
  )}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`;
}

function clearCookie() {
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
}

export function saveSession(
  accessToken: string,
  refreshToken: string,
  user: User
) {
  window.localStorage.setItem(ACCESS_KEY, accessToken);
  window.localStorage.setItem(REFRESH_KEY, refreshToken);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  // Mirror ke cookie 30 menit (umur access token)
  setCookie(accessToken, 30 * 60);
}

export function updateStoredUser(user: User) {
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
  window.localStorage.removeItem(USER_KEY);
  clearCookie();
}

export function decodeJwtPayload(
  token: string
): { sub?: string; role?: Role; name?: string; exp?: number } | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(json) as { sub?: string; role?: Role; name?: string; exp?: number };
  } catch {
    return null;
  }
}
