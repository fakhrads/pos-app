"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Loader2,
  Package,
  Store,
  Tags,
  Users,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  type OnboardingProfile,
  DEFAULT_ONBOARDING,
  getOnboarding,
  saveOnboarding,
} from "@/lib/phase6-storage";

/**
 * RC-02 — Onboarding Wizard (6 langkah)
 *
 * Tampil full-screen pertama kali aplikasi dibuka (ketika `onboarding.completed` = false).
 * Data disimpan ke localStorage, dan modul yang tidak relevan disembunyikan otomatis.
 *
 * Langkah:
 *  1. Nama usaha
 *  2. Jenis usaha (gambar/pilihan)
 *  3. Jumlah outlet
 *  4. Jual barang / jasa / keduanya
 *  5. Pakai stok atau tidak (hanya relevan jika jual barang)
 *  6. Ada karyawan atau tidak
 */
export const BUSINESS_TYPES = [
  {
    id: "retail",
    label: "Toko / Ritel",
    description: "Minimarket, warung, clothing store",
    emoji: "🛒",
  },
  {
    id: "fnb",
    label: "Makanan & Minuman",
    description: "Kafe, restoran, warung makan",
    emoji: "🍜",
  },
  {
    id: "service",
    label: "Jasa",
    description: "Laundry, servis, salon",
    emoji: "🧼",
  },
  {
    id: "barber",
    label: "Barbershop / Salon",
    description: "Potong rambut, perawatan",
    emoji: "💈",
  },
  {
    id: "wholesale",
    label: "Grosir",
    description: "Jual dalam jumlah banyak",
    emoji: "📦",
  },
  {
    id: "other",
    label: "Lainnya",
    description: "Jenis usaha lainnya",
    emoji: "🏪",
  },
] as const;

export const STEP_LABELS = [
  "Nama Usaha",
  "Jenis Usaha",
  "Jumlah Outlet",
  "Barang / Jasa",
  "Stok",
  "Karyawan",
] as const;

interface StepBaseProps {
  profile: OnboardingProfile;
  setProfile: (p: OnboardingProfile) => void;
  onNext: () => void;
}

export function OnboardingWizard({
  open,
  onComplete,
}: {
  open: boolean;
  onComplete: () => void;
}) {
  const [profile, setProfile] = useState<OnboardingProfile>(DEFAULT_ONBOARDING);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Muat profil tersimpan saat dibuka
  useEffect(() => {
    if (open) {
      setProfile(getOnboarding());
      setStep(0);
      setError(null);
    }
  }, [open]);

  const update = useCallback(
    (p: Partial<OnboardingProfile>) => setProfile((prev) => ({ ...prev, ...p })),
    []
  );

  const canNext = useCallback((): string | null => {
    if (step === 0 && !profile.businessName.trim()) return "Nama usaha belum diisi.";
    if (step === 1 && !profile.businessType) return "Pilih jenis usaha dulu.";
    if (step === 2 && (!profile.outlets || profile.outlets < 1))
      return "Jumlah outlet minimal 1.";
    return null;
  }, [step, profile]);

  const handleFinish = useCallback(() => {
    const ok = saveOnboarding({ ...profile, completed: true });
    if (!ok) {
      setError(
        "Penyimpanan penuh sehingga data onboarding tidak bisa disimpan. Kosongkan sebagian data peramban, lalu coba lagi."
      );
      return;
    }
    setSaving(true);
    onComplete();
  }, [profile, onComplete]);

  // Keyboard navigation — aksesibilitas (SPEC §9)
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    containerRef.current?.focus();
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !saving) {
        const invalid = canNext();
        if (invalid) {
          setError(invalid);
          return;
        }
        e.preventDefault();
        if (step < 5) setStep((s) => s + 1);
        else handleFinish();
      }
      if (e.key === "ArrowLeft" && step > 0) setStep((s) => s - 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, step, canNext, saving, handleFinish]);

  if (!open) return null;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Onboarding — Langkah ${step + 1} dari 6: ${STEP_LABELS[step]}`}
      tabIndex={-1}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onKeyDown={(e) => {
        if (e.key === "Escape" && step > 0) setStep((s) => s - 1);
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-lg">
        {/* Header progress */}
        <div className="border-b border-border px-6 pt-5 pb-4">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-cyan-600">
              <Store className="size-4 text-background" />
            </div>
            <div>
              <p className="text-sm font-semibold">Selamat datang di FakhriPOS 👋</p>
              <p className="text-xs text-muted-foreground">
                Isi 6 langkah singkat agar aplikasi pas dengan usahamu.
              </p>
            </div>
          </div>
          {/* Progress bar */}
          <div className="flex gap-1.5">
            {STEP_LABELS.map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  i <= step ? "bg-accent" : "bg-muted"
                )}
              />
            ))}
          </div>
          <p className="mt-2 text-center text-xs font-medium text-muted-foreground" aria-live="polite">
            Langkah {step + 1} dari 6 · {STEP_LABELS[step]}
          </p>
        </div>

        {/* Body */}
        <div className="min-h-[260px] px-6 py-6">
          {error && (
            <div
              className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {error}
            </div>
          )}

          {step === 0 && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-subtle">
                  <Building2 className="size-5 text-accent" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Nama usahamu apa?</h2>
                  <p className="text-sm text-muted-foreground">
                    Nama ini dipakai di struk dan laporan. Bisa diubah nanti.
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ow-name">Nama Usaha</Label>
                <Input
                  id="ow-name"
                  autoFocus
                  placeholder="cth. Toko Berkah Jaya"
                  value={profile.businessName}
                  onChange={(e) => {
                    update({ businessName: e.target.value });
                    setError(null);
                  }}
                  className="min-h-12"
                />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-subtle">
                  <Tags className="size-5 text-accent" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Jenis usahamu apa?</h2>
                  <p className="text-sm text-muted-foreground">
                    Pilih yang paling mendekati. Ini menentukan modul yang ditampilkan.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {BUSINESS_TYPES.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      update({ businessType: b.id });
                      setError(null);
                    }}
                    className={cn(
                      "flex min-h-[72px] flex-col items-start gap-1 rounded-xl border p-3 text-left transition-smooth",
                      profile.businessType === b.id
                        ? "border-accent bg-accent-subtle ring-1 ring-accent"
                        : "border-border hover:border-accent/40"
                    )}
                  >
                    <span className="text-2xl">{b.emoji}</span>
                    <span className="text-sm font-medium">{b.label}</span>
                    <span className="text-[11px] leading-tight text-muted-foreground">
                      {b.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-subtle">
                  <Warehouse className="size-5 text-accent" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Berapa outlet/lokasimu?</h2>
                  <p className="text-sm text-muted-foreground">
                    Kalau lebih dari satu, kamu bisa kelola stok per gudang.
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ow-outlets">Jumlah Outlet</Label>
                <Input
                  id="ow-outlets"
                  type="number"
                  min={1}
                  max={99}
                  value={profile.outlets}
                  onChange={(e) => {
                    update({ outlets: Math.max(1, Number(e.target.value) || 1) });
                    setError(null);
                  }}
                  className="min-h-12"
                />
                {profile.outlets > 1 && (
                  <p className="text-xs text-muted-foreground">
                    Outlet {profile.outlets} → aktivasikan pengelolaan multi-gudang.
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-subtle">
                  <Package className="size-5 text-accent" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Kamu jual apa?</h2>
                  <p className="text-sm text-muted-foreground">
                    Boleh dua-duanya. Pilih sesuai yang kamu jual.
                  </p>
                </div>
              </div>
              <div className="grid gap-2">
                {[
                  {
                    key: "sellsProduct" as const,
                    label: "Barang",
                    desc: "Produk fisik dengan stok",
                    emoji: "📦",
                  },
                  {
                    key: "sellsService" as const,
                    label: "Jasa",
                    desc: "Layanan, tidak punya stok",
                    emoji: "🛠️",
                  },
                ].map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => update({ [o.key]: !profile[o.key] })}
                    className={cn(
                      "flex min-h-14 items-center gap-3 rounded-xl border p-3 text-left transition-smooth",
                      profile[o.key]
                        ? "border-accent bg-accent-subtle ring-1 ring-accent"
                        : "border-border hover:border-accent/40"
                    )}
                  >
                    <span className="text-xl">{o.emoji}</span>
                    <span className="flex-1">
                      <span className="block text-sm font-medium">{o.label}</span>
                      <span className="text-xs text-muted-foreground">{o.desc}</span>
                    </span>
                    <Check
                      className={cn(
                        "size-5",
                        profile[o.key] ? "text-accent" : "text-muted/30"
                      )}
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-subtle">
                  <Warehouse className="size-5 text-accent" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Pakai stok atau tidak?</h2>
                  <p className="text-sm text-muted-foreground">
                    {profile.sellsProduct
                      ? "Kamu jual barang, jadi pantau stok biar tidak kehabisan."
                      : "Kamu tidak jual barang, jadi stok bisa dimatikan."}
                  </p>
                </div>
              </div>
              <div className="grid gap-2">
                {[
                  { value: true, label: "Ya, pantau stok", desc: "Tambah min stok & peringatan", emoji: "📈" },
                  { value: false, label: "Tidak, skip stok", desc: "Hanya jual tanpa hitung stok", emoji: "🚫" },
                ].map((o) => (
                  <button
                    key={String(o.value)}
                    type="button"
                    onClick={() => update({ trackStock: o.value })}
                    className={cn(
                      "flex min-h-14 items-center gap-3 rounded-xl border p-3 text-left transition-smooth",
                      profile.trackStock === o.value
                        ? "border-accent bg-accent-subtle ring-1 ring-accent"
                        : "border-border hover:border-accent/40"
                    )}
                  >
                    <span className="text-xl">{o.emoji}</span>
                    <span className="flex-1">
                      <span className="block text-sm font-medium">{o.label}</span>
                      <span className="text-xs text-muted-foreground">{o.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-subtle">
                  <Users className="size-5 text-accent" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Ada karyawan lain?</h2>
                  <p className="text-sm text-muted-foreground">
                    Kalau ada, kamu bisa atur kasir/manajer dengan peran & akses.
                  </p>
                </div>
              </div>
              <div className="grid gap-2">
                {[
                  { value: true, label: "Ya, ada tim", desc: "Kelola pengguna & peran", emoji: "👥" },
                  { value: false, label: "Saya sendiri", desc: "Mode tunggal, tanpa pengguna", emoji: "🙋" },
                ].map((o) => (
                  <button
                    key={String(o.value)}
                    type="button"
                    onClick={() => update({ hasStaff: o.value })}
                    className={cn(
                      "flex min-h-14 items-center gap-3 rounded-xl border p-3 text-left transition-smooth",
                      profile.hasStaff === o.value
                        ? "border-accent bg-accent-subtle ring-1 ring-accent"
                        : "border-border hover:border-accent/40"
                    )}
                  >
                    <span className="text-xl">{o.emoji}</span>
                    <span className="flex-1">
                      <span className="block text-sm font-medium">{o.label}</span>
                      <span className="text-xs text-muted-foreground">{o.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (step > 0 ? setStep((s) => s - 1) : onComplete())}
            className="min-h-12"
          >
            <ArrowLeft className="size-4" />
            {step > 0 ? "Kembali" : "Tutup"}
          </Button>
          <div className="flex items-center gap-2">
            {step < 5 ? (
              <Button
                size="sm"
                className="min-h-12"
                onClick={() => {
                  const invalid = canNext();
                  if (invalid) {
                    setError(invalid);
                    return;
                  }
                  setError(null);
                  setStep((s) => s + 1);
                }}
              >
                Lanjut
                <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button
                size="sm"
                className="min-h-12"
                onClick={handleFinish}
                disabled={saving}
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Selesai
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Hook: kembalikan true jika onboarding belum selesai (wizard harus tampil) */
export function useOnboardingPending(): boolean {
  const [pending, setPending] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setPending(!getOnboarding().completed);
  }, []);
  return pending;
}
