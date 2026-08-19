"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { glossary, type GlossaryEntry } from "@/data/glossary";
import {
  ModuleHelpButton,
} from "@/components/onboarding/module-intro";

/**
 * RC-04 — Glosarium (50+ istilah)
 *
 * Kamus istilah dengan pencarian berdasarkan istilah + arti.
 * Tiap entri: istilah, arti sehari-hari, contoh angka, tautan modul.
 */
const MODULE_LINK: Record<string, string> = {
  Produk: "/products",
  Stok: "/warehouses",
  Laporan: "/reports",
  Kasir: "/pos",
  "Keuangan": "/reports?tab=finance",
  Pelanggan: "/customers",
  Sistem: "/settings",
};

export default function GlossaryPage() {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return glossary;
    return glossary.filter(
      (g) =>
        g.term.toLowerCase().includes(query) ||
        g.plain.toLowerCase().includes(query) ||
        g.definition.toLowerCase().includes(query) ||
        g.example.toLowerCase().includes(query)
    );
  }, [q]);

  const grouped = useMemo(() => {
    const map = new Map<string, GlossaryEntry[]>();
    for (const e of filtered) {
      const g = map.get(e.relatedModule) ?? [];
      g.push(e);
      map.set(e.relatedModule, g);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <>
      <PageHeader
        title="Glosarium"
        description={`Kamus ${glossary.length} istilah untuk memudahkan kamu memahami FakhriPOS. Cari berdasarkan istilah atau arti.`}
        actions={
          <>
            <ModuleHelpButton moduleId="glossary" />
          </>
        }
      />

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Cari istilah / arti / contoh…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-h-11 pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Search className="size-7" />}
          title="Istilah tidak ditemukan"
          description={`Tidak ada istilah cocok dengan "${q}". Coba kata kunci lain.`}
          action={
            <Button variant="outline" size="sm" onClick={() => setQ("")}>
              Hapus Pencarian
            </Button>
          }
        />
      ) : (
        <div className="space-y-8">
          {grouped.map(([module, entries]) => {
            const href = MODULE_LINK[module];
            return (
              <section key={module}>
                <div className="mb-3 flex items-center gap-2">
                  <BookOpen className="size-4 text-accent" />
                  <h2 className="text-sm font-semibold">{module}</h2>
                  <span className="text-xs text-muted-foreground">
                    {entries.length} istilah
                  </span>
                  {href && (
                    <Link
                      href={href}
                      className="ml-auto text-xs text-accent hover:underline"
                    >
                      Buka modul →
                    </Link>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {entries.map((g) => (
                    <Card key={g.id} className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold">{g.term}</p>
                        <Badge variant="outline" className="shrink-0">
                          {g.plain}
                        </Badge>
                      </div>
                      <p className="mt-1.5 text-sm text-text-secondary">
                        {g.definition}
                      </p>
                      <p className="mt-2 rounded-md bg-muted/50 px-2.5 py-1.5 font-mono text-xs text-text-secondary">
                        💡 {g.example}
                      </p>
                    </Card>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
