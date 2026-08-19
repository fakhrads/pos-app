"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  HelpCircle,
  Lightbulb,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getModuleIntro, type ModuleIntroData } from "@/data/module-intros";
import {
  hasSeenModuleIntro,
  markModuleIntroSeen,
} from "@/lib/phase6-storage";

/**
 * RC-01 + RC-05 — Pengantar Modul & ikon "?"
 *
 * - Menampilkan layar pengantar saat modul dibuka pertama kali.
 * - Setelah ditutup, tidak tampil lagi (disimpan di modulesIntrosSeen[]).
 * - Ikon "?" (via <ModuleHelpButton>) untuk membuka ulang kapan saja.
 */
export function ModuleIntro({
  moduleId,
  onClose,
}: {
  moduleId: string;
  onClose: () => void;
}) {
  const intro = useMemo(() => getModuleIntro(moduleId), [moduleId]);
  if (!intro) return null;
  return <ModuleIntroContent intro={intro} onClose={onClose} />;
}

/** Badge pengantar yang otomatis tampil sekali (untuk dipasang di PageHeader). */
export function ModuleIntroBadge({
  moduleId,
  onSeen,
}: {
  moduleId: string;
  onSeen?: () => void;
}) {
  const [show, setShow] = useState(false);
  const [firstTime, setFirstTime] = useState(false);

  useEffect(() => {
    setShow(!hasSeenModuleIntro(moduleId));
    setFirstTime(!hasSeenModuleIntro(moduleId));
  }, [moduleId]);

  if (!show) return null;
  const intro = getModuleIntro(moduleId);
  if (!intro) return null;

  return (
    <ModuleIntroContent
      intro={intro}
      firstTime={firstTime}
      onClose={() => {
        setShow(false);
        markModuleIntroSeen(moduleId);
        onSeen?.();
      }}
    />
  );
}

/** Tombol "?" untuk membuka pengantar modul kapan saja. */
export function ModuleHelpButton({
  moduleId,
  className,
}: {
  moduleId: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const intro = getModuleIntro(moduleId);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Pengantar modul"
        aria-label="Pengantar modul"
        className={className}
        onClick={() => setOpen(true)}
      >
        <HelpCircle className="size-4" />
      </Button>
      {intro && (
        <ModuleIntroContent intro={intro} onClose={() => setOpen(false)} open={open} />
      )}
    </>
  );
}

function ModuleIntroContent({
  intro,
  open = true,
  firstTime = false,
  onClose,
}: {
  intro: ModuleIntroData;
  open?: boolean;
  firstTime?: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-xl bg-accent-subtle text-2xl">
              {intro.emoji}
            </div>
            <div>
              <DialogTitle className="text-lg">{intro.title}</DialogTitle>
              <DialogDescription className="text-xs">
                {firstTime ? "Pengantar pertama" : "Pengantar modul"}
              </DialogDescription>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* Apa ini */}
          <Section icon={<Sparkles className="size-4" />} title="Apa ini?">
            <p className="text-text-secondary">{intro.what}</p>
          </Section>

          {/* Kenapa penting */}
          <Section icon={<Lightbulb className="size-4" />} title="Kenapa penting?">
            <p className="text-text-secondary">{intro.why}</p>
          </Section>

          {/* Cara pakai */}
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <CheckCircle2 className="size-3.5 text-success" /> Cara pakai
            </p>
            <ol className="space-y-1.5">
              {intro.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-text-secondary">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-[11px] font-bold text-accent">
                    {i + 1}
                  </span>
                  <span className="flex-1">{s}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Contoh nyata */}
          <InfoBlock icon={<Sparkles className="size-4" />} label="Contoh nyata">
            {intro.example}
          </InfoBlock>

          {/* Kesalahan umum */}
          <InfoBlock icon={<XCircle className="size-4" />} label="Kesalahan umum" tone="warn">
            {intro.pitfall}
          </InfoBlock>

          <p className="rounded-lg border border-accent/20 bg-accent-subtle/50 px-3 py-2 text-xs text-text-secondary">
            💡 Pengantar ini bisa dibuka lagi lewat ikon <HelpCircle className="inline size-3.5" /> di
            pojok halaman.
          </p>
        </div>

        <DialogFooter>
          <Button className="min-h-11 w-full" onClick={onClose}>
            <CheckCircle2 className="size-4" /> Mengerti
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon} {title}
      </p>
      {children}
    </div>
  );
}

function InfoBlock({
  icon,
  label,
  children,
  tone = "info",
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  tone?: "info" | "warn";
}) {
  return (
    <div
      className={
        tone === "warn"
          ? "rounded-lg border border-warning/30 bg-warning-subtle/40 px-3 py-2.5"
          : "rounded-lg border border-success/30 bg-success-subtle/40 px-3 py-2.5"
      }
    >
      <p className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </p>
      <p className="text-text-secondary">{children}</p>
    </div>
  );
}

/** Hook: auto-tampilkan pengantar pertama kali (kembalikan null sampai selesai) */
export function useModuleIntro(moduleId: string) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!hasSeenModuleIntro(moduleId)) {
      setShow(true);
    }
  }, [moduleId]);
  return {
    show,
    seen: hasSeenModuleIntro(moduleId),
    dismiss: () => {
      setShow(false);
      markModuleIntroSeen(moduleId);
    },
  };
}
