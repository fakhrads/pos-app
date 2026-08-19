"use client";

import { useEffect, useRef, useState } from "react";
import { CloudOff, RefreshCw, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { countOfflineOrders, getAllOfflineOrders } from "@/lib/offline-db";
import { runSync, SYNC_EVENT } from "@/lib/sync";
import { cn } from "@/lib/utils";

/**
 * OfflineIndicator — badge status koneksi di header.
 * Online  : "Online" (hijau) + badge jumlah antrean bila ada.
 * Offline : "Offline — N transaksi menunggu" (amber) + tombol sync.
 * Aksesibel sebagai live region (role="status", aria-live="polite").
 */
export function OfflineIndicator() {
  const online = useOnlineStatus();
  const [pending, setPending] = useState(0);
  const [conflict, setConflict] = useState(0);
  const [syncing, setSyncing] = useState(false);

  async function refresh() {
    try {
      setPending(await countOfflineOrders());
      const all = await getAllOfflineOrders();
      setConflict(all.filter((o) => o.status === "conflict").length);
    } catch {
      setPending(0);
      setConflict(0);
    }
  }

  useEffect(() => {
    void refresh();
    window.addEventListener(SYNC_EVENT, refresh);
    return () => window.removeEventListener(SYNC_EVENT, refresh);
  }, []);

  // Saat pulih dari offline → auto-sync
  const prevOnline = usePrevious(online);
  useEffect(() => {
    if (online && prevOnline === false) {
      void (async () => {
        setSyncing(true);
        try {
          await runSync();
        } finally {
          setSyncing(false);
          await refresh();
        }
      })();
    }
  }, [online, prevOnline]);

  async function manualSync() {
    setSyncing(true);
    try {
      await runSync({ includeConflict: true });
    } catch {
      // biarkan, indicator tetap tampil
    } finally {
      setSyncing(false);
      await refresh();
    }
  }

  if (online && pending === 0) {
    return (
      <Badge
        role="status"
        variant="outline"
        className="gap-1.5 border-emerald-600/40 bg-emerald-600/10 text-emerald-600"
      >
        <Wifi className="size-3.5" />
        Online
      </Badge>
    );
  }

  if (online) {
    return (
      <Badge
        role="status"
        variant="outline"
        className="gap-1.5 border-amber-600/40 bg-amber-600/10 text-amber-600"
      >
        <CloudOff className="size-3.5" />
        {pending} transaksi menunggu sync
        {conflict > 0 && <span className="text-destructive">({conflict} konflik)</span>}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-[11px]"
          onClick={manualSync}
          disabled={syncing}
        >
          <RefreshCw className={cn("size-3", syncing && "animate-spin")} />
          Sync
        </Button>
      </Badge>
    );
  }

  return (
    <Badge
      role="status"
      variant="outline"
      className="gap-1.5 border-destructive/50 bg-destructive/10 text-destructive"
    >
      <CloudOff className="size-3.5" />
      Offline — {pending > 0 ? `${pending} transaksi menunggu` : "transaksi disimpan"}
    </Badge>
  );
}

// Hook kecil utk nilai sebelumnya (deteksi transisi offline→online)
function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}
