"use client";

import { useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";
import {
  getPracticeMode,
} from "@/lib/phase6-storage";

/**
 * RC-03 — Banner Mode Latihan
 *
 * Banner oranye jelas di atas layar ketika Mode Latihan aktif:
 * "Mode Latihan — Data tidak disimpan ke database."
 * Fixed di atas (mobile: SPEC §9), mengikuti konteks halaman.
 */
export function PracticeModeBanner() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setActive(getPracticeMode());
    // Ikuti perubahan dari tab lain / toggle di Pengaturan
    const onStorage = () => setActive(getPracticeMode());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (!active) return null;

  return (
    <div className="sticky top-0 z-40 flex items-center justify-center gap-2 border-b border-warning/40 bg-warning px-4 py-2 text-center text-sm font-medium text-warning-fg">
      <FlaskConical className="size-4 shrink-0" />
      <span>Mode Latihan — Data tidak disimpan ke database</span>
    </div>
  );
}
