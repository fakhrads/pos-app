"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Eye, EyeOff, Loader2, Lock, Mail, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError("Email dan password wajib diisi.");
      return;
    }
    setSubmitting(true);
    try {
      const user = await login(email.trim(), password);
      const next = searchParams.get("next");
      const home =
        next && next.startsWith("/") && !next.startsWith("/login")
          ? next
          : user.role === "kasir"
            ? "/pos"
            : "/dashboard";
      router.replace(home);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Gagal masuk. Periksa koneksi ke server.");
      }
      setSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-md border-0 shadow-none md:border md:shadow-sm">
      <CardHeader className="space-y-1 text-center md:text-left">
        <CardTitle className="text-2xl font-semibold">Masuk ke FakhriPOS</CardTitle>
        <CardDescription>
          Gunakan akun yang sudah didaftarkan oleh admin toko.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="nama@tokomu.id"
                className="pl-9"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                className="pl-9 pr-9"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {submitting ? "Memproses…" : "Masuk"}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Belum punya akun? Hubungi admin toko.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen">
      {/* Panel branding (desktop) */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-primary p-10 text-primary-foreground lg:flex">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary-foreground/10">
            <Store className="size-5" />
          </div>
          <span className="text-lg font-semibold">FakhriPOS</span>
        </div>
        <div className="space-y-4">
          <h1 className="text-4xl font-semibold leading-tight">
            Kasir cepat.
            <br />
            Laporan rapi.
            <br />
            Toko terkontrol.
          </h1>
          <p className="max-w-md text-sm text-primary-foreground/70">
            Point of Sales untuk toko Fakhri — produk, checkout, member, diskon,
            dan laporan dalam satu aplikasi.
          </p>
        </div>
        <p className="text-xs text-primary-foreground/50">
          © {new Date().getFullYear()} FakhriPOS · Homelab
        </p>
      </div>

      {/* Form login */}
      <div className="flex flex-1 items-center justify-center p-6">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
