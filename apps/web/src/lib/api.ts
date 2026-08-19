// ============================================================
// API client — fetch wrapper menuju backend (Bun + Elysia).
// - Base URL: NEXT_PUBLIC_API_URL (default http://localhost:3001/api/v1)
// - Envelope respons: { ok, data, error }
// - Auto-attach JWT Bearer + auto-refresh saat 401 (sekali, lalu retry)
// ============================================================

import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  getStoredUser,
  saveSession,
} from "./auth-storage";
import type { Envelope, User } from "./types";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Lewati auto-refresh (dipakai internal saat refresh token) */
  skipAuthRetry?: boolean;
  signal?: AbortSignal;
}

export async function rawFetch<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = "GET", body, headers = {}, skipAuthRetry = false, signal } = options;

  // FormData (multipart upload, mis. import Excel) — jangan set Content-Type,
  // biarkan browser mengisi boundary secara otomatis.
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  const finalHeaders: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...headers,
  };

  const token = getAccessToken();
  if (token) finalHeaders.Authorization = `Bearer ${token}`;

  const url = path.startsWith("http") ? path : `${API_URL}${path}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: finalHeaders,
      body: body !== undefined ? (isFormData ? body : JSON.stringify(body)) : undefined,
      signal,
    });
  } catch {
    throw new ApiError(
      "NETWORK_ERROR",
      "Tidak dapat terhubung ke server. Pastikan backend berjalan.",
      0
    );
  }

  // 401 → coba refresh sekali, lalu retry request asli
  if (res.status === 401 && !skipAuthRetry && !path.startsWith("/auth/")) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return rawFetch<T>(path, { ...options, skipAuthRetry: true });
    }
    clearSession();
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new ApiError("UNAUTHORIZED", "Sesi berakhir, silakan login kembali.", 401);
  }

  let envelope: Envelope<T> | null = null;
  try {
    envelope = (await res.json()) as Envelope<T>;
  } catch {
    // respons non-JSON (mis. proxy error)
    if (!res.ok) {
      throw new ApiError("INTERNAL", `Server merespons ${res.status}`, res.status);
    }
  }

  if (!envelope || !envelope.ok) {
    const err = envelope?.error;
    throw new ApiError(
      err?.code ?? "INTERNAL",
      err?.message ?? "Terjadi kesalahan pada server.",
      res.status,
      err?.details
    );
  }

  return envelope.data as T;
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const data = await rawFetch<{ accessToken: string; refreshToken: string }>(
      "/auth/refresh",
      {
        method: "POST",
        body: { refreshToken },
        skipAuthRetry: true,
      }
    );
    const user = getStoredUser();
    if (user) saveSession(data.accessToken, data.refreshToken, user);
    else saveSession(data.accessToken, data.refreshToken, {} as User);
    return true;
  } catch {
    return false;
  }
}

export const api = {
  get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    options?: RequestOptions
  ) {
    const qs = params
      ? Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== null && v !== "")
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join("&")
      : "";
    const url = qs ? `${path}?${qs}` : path;
    return rawFetch<T>(url, { ...options, method: "GET" });
  },

  post<T>(path: string, body?: unknown, options?: RequestOptions) {
    return rawFetch<T>(path, { ...options, method: "POST", body });
  },

  patch<T>(path: string, body?: unknown, options?: RequestOptions) {
    return rawFetch<T>(path, { ...options, method: "PATCH", body });
  },

  delete<T>(path: string, options?: RequestOptions) {
    return rawFetch<T>(path, { ...options, method: "DELETE" });
  },
};
