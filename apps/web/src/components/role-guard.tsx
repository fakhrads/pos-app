"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/providers/auth-provider";
import type { Role } from "@/lib/types";

interface RoleGuardProps {
  /** Role yang diizinkan melihat konten */
  allow?: Role[];
  /** Fallback: jika user tidak punya akses, redirect ke sini */
  redirectTo?: string;
  children: ReactNode;
}

/**
 * Guard akses berbasis role di sisi klien.
 * Keamanan sesungguhnya dipegang middleware (Next.js) & backend (Elysia).
 */
export function RoleGuard({ allow, redirectTo = "/pos", children }: RoleGuardProps) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (allow && !allow.includes(user.role)) {
      router.replace(redirectTo);
    }
  }, [user, loading, allow, redirectTo, router]);

  if (loading || !user) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Memuat…
      </div>
    );
  }
  if (allow && !allow.includes(user.role)) return null;

  return <>{children}</>;
}

/** Hanya admin (untuk halaman users, settings, audit) */
export function AdminOnly({ children }: { children: ReactNode }) {
  return (
    <RoleGuard allow={["admin"]} redirectTo="/dashboard">
      {children}
    </RoleGuard>
  );
}

/** Manager atau admin */
export function ManagerOnly({ children }: { children: ReactNode }) {
  return (
    <RoleGuard allow={["admin", "manager"]} redirectTo="/pos">
      {children}
    </RoleGuard>
  );
}
