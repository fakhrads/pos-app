/**
 * Middleware auth & role guard (api-design.md §1.4, features.md §5).
 *  - mustAuth:     semua role, user aktif dicek setiap request
 *  - mustManager:  admin + manager
 *  - mustAdmin:    admin saja
 * User aktif di-attach ke `store.user` → dibaca route via `getUser(ctx)`.
 */
import { Elysia } from 'elysia';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import { verifyAccessToken, isTokenExpired } from '../lib/jwt';
import { fail } from '../lib/errors';

export type Role = 'admin' | 'manager' | 'kasir';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  outletId: number;
}

/** Konteks route yang dipakai handler (Elysia menyediakan runtime object ini).
 *  `set` sengaja `any`: tipe Elysia 1.4 (StatusMap/HTTPHeaders) terlalu spesifik
 *  dan berubah antar versi — akses `ctx.set.status`/`ctx.set.headers` tetap aman. */
export interface RouteCtx {
  body: any;
  query: Record<string, string | undefined>;
  params: Record<string, string>;
  headers: Record<string, string | undefined>;
  set: any;
  store: { user?: AuthUser } & Record<string, unknown>;
  request: Request;
}

/** Ambil user terautentikasi di dalam handler route. */
export function getUser(ctx: RouteCtx): AuthUser {
  const u = ctx.store.user;
  if (!u) fail('UNAUTHORIZED', 'Belum login', 401);
  return u;
}

interface GuardCtx {
  headers: Record<string, string | undefined>;
  store: Record<string, unknown>;
}

async function authenticate(headers: Record<string, string | undefined>, store: Record<string, unknown>): Promise<void> {
  const auth = headers.authorization ?? '';
  const [scheme, token] = auth.split(' ');
  if (scheme !== 'Bearer' || !token) fail('UNAUTHORIZED', 'Header Authorization Bearer wajib', 401);

  let payload;
  try {
    payload = await verifyAccessToken(token);
  } catch (e) {
    if (isTokenExpired(e)) fail('TOKEN_EXPIRED', 'Token sudah kedaluwarsa, silakan refresh', 401);
    fail('UNAUTHORIZED', 'Token tidak valid', 401);
  }

  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.id, payload.sub), isNull(users.deletedAt)))
    .limit(1);

  const user = rows[0];
  if (!user) fail('UNAUTHORIZED', 'User tidak ditemukan', 401);
  if (!user.isActive) fail('ACCOUNT_DISABLED', 'Akun dinonaktifkan. Hubungi admin.', 403);

  store.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    outletId: Number(user.outletId),
  };
}

/** Semua role, wajib login & aktif.
 *  `as: 'scoped'` (default) — TERUJI EMPIRIS di Elysia 1.4.29:
 *   - 'local'  → hook TIDAK dijalankan oleh instance yang .use() (auth mati total)
 *   - 'global' → hook bocor ke SEMUA route setelahnya di group (kasir kena mustAdmin → 403)
 *   - 'scoped' → hanya route pada instance pemakai yang kena guard (benar) */
export const mustAuth = new Elysia().derive({ as: 'scoped' }, async ({ headers, store }: GuardCtx) => {
  await authenticate(headers, store);
});

/** Manager + admin. */
export const mustManager = new Elysia().derive({ as: 'scoped' }, async ({ headers, store }: GuardCtx) => {
  await authenticate(headers, store);
  const role = (store.user as AuthUser | undefined)?.role;
  if (role !== 'admin' && role !== 'manager') fail('FORBIDDEN', 'Aksi ini khusus manager/admin', 403);
});

/** Admin saja. */
export const mustAdmin = new Elysia().derive({ as: 'scoped' }, async ({ headers, store }: GuardCtx) => {
  await authenticate(headers, store);
  const role = (store.user as AuthUser | undefined)?.role;
  if (role !== 'admin') fail('FORBIDDEN', 'Aksi ini khusus admin', 403);
});
