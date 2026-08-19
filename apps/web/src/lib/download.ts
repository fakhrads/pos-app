// ============================================================
// Unduhan file (blob) dari API — dipakai Export Excel & template import.
// Mengikuti pola api client: auto-attach JWT Bearer, envelope error.
// ============================================================

import { API_URL, ApiError } from "./api";
import { getAccessToken } from "./auth-storage";

export async function apiDownload(path: string, filename: string): Promise<void> {
  const token = getAccessToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    throw new ApiError("NETWORK_ERROR", "Gagal terhubung ke server. Coba lagi.", 0);
  }

  if (!res.ok) {
    let message = "Gagal mengunduh file.";
    let details: unknown;
    try {
      const env = (await res.json()) as { error?: { message?: string; details?: unknown } };
      if (env?.error?.message) message = env.error.message;
      details = env?.error?.details;
    } catch {
      // respons non-JSON — pakai pesan default
    }
    throw new ApiError("DOWNLOAD_FAILED", message, res.status, details);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

