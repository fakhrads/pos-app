"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Settings, SettingsResponse } from "@/lib/types";

const DEFAULTS: Settings = {
  "store.name": "FakhriPOS",
  "store.address": "",
  "store.phone": "",
  "receipt.footer": "Terima kasih atas kunjungan Anda",
  "points.earn_per_idr": 1000,
  "points.redeem_value": 10,
  "low_stock.default_threshold": 5,
  "discount.manual_max_percent": 20,
  "discount.manual_max_amount": 50000,
  "return.max_days": 7,
  "report.timezone": "Asia/Jakarta",
};

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const data = await api.get<SettingsResponse>("/settings");
      setSettings({ ...DEFAULTS, ...data.settings });
    } catch {
      setSettings(DEFAULTS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { settings, loading, reload };
}

/** Akses aman nilai setting dengan default */
export function useSetting<T extends string | number>(
  settings: Settings | null,
  key: string,
  fallback: T
): T {
  const raw = settings?.[key];
  if (raw === undefined) return fallback;
  if (typeof raw === "number") return raw as T;
  if (typeof raw === "string" && typeof fallback === "number") {
    const n = Number(raw);
    return (Number.isNaN(n) ? fallback : n) as T;
  }
  return raw as T;
}
