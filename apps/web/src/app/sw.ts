/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();

// ---------- Background sync offline (SPEC Fase 7 §6.3, US-07) ----------
// SW menerima event 'sync' dari browser (setelah koneksi pulih) lalu
// memberitahu semua tab agar menjalankan sinkronisasi antrean transaksi.
self.addEventListener("sync", (event) => {
  const syncEvent = event as unknown as { tag?: string };
  if (syncEvent.tag === "fakhripos-sync") {
    event.waitUntil(
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clients) => {
          clients.forEach((client) =>
            client.postMessage({ type: "FAKHRI_SYNC" })
          );
        })
    );
  }
});
