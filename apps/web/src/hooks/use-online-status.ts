"use client";

import { useEffect, useState } from "react";

/**
 * useOnlineStatus — deteksi koneksi online/offline (SPEC Fase 7 §3.2, US-02).
 * Memakai `navigator.onLine` (nilai awal) + listener `online`/`offline`
 * sehingga banner muncul < 2 detik setelah jaringan putus/pulih.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);

    // Sinkronkan nilai awal (redundan, aman bila browser menunda event)
    setOnline(navigator.onLine);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    // Fallback utk browser tanpa event (jarang)
    document.addEventListener("visibilitychange", () => {
      setOnline(navigator.onLine);
    });

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", () => {
        setOnline(navigator.onLine);
      });
    };
  }, []);

  return online;
}
