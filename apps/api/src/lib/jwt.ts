/**
 * JWT (HS256 via jose) + refresh token opaque.
 *  - Access token: 30 menit, claim { sub, role, name, email, outletId, iat, exp }
 *  - Refresh token: random 48-byte hex, disimpan HASH (sha256) di user_sessions,
 *    rotasi tiap refresh, umur default 7 hari (api-design.md §1.4).
 */
import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { env } from '../env';

export interface AccessTokenClaims {
  sub: string; // user id
  role: string;
  name: string;
  email: string;
  outletId: number;
}

const enc = (s: string) => new TextEncoder().encode(s);

/** Daftar secret yang dicoba saat verifikasi: aktif + rotasi (JWT_SECRET_PREVIOUS). */
function verificationSecrets(): Uint8Array[] {
  return [env.JWT_SECRET, ...env.JWT_SECRET_PREVIOUS].map(enc);
}

export async function signAccessToken(user: {
  id: string;
  role: string;
  name: string;
  email: string;
  outletId: number;
}): Promise<string> {
  return new SignJWT({ role: user.role, name: user.name, email: user.email, outletId: user.outletId })
    .setProtectedHeader({ alg: 'HS256', kid: env.JWT_KID })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(env.JWT_ACCESS_TTL)
    .sign(enc(env.JWT_SECRET));
}

/** Verifikasi access token; throw jose error (JWTExpired untuk token kedaluwarsa). */
export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  let lastError: unknown = new Error('no secret matched');
  for (const secret of verificationSecrets()) {
    try {
      const { payload } = await jwtVerify(token, secret);
      return {
        sub: String(payload.sub ?? ''),
        role: String(payload.role ?? ''),
        name: String(payload.name ?? ''),
        email: String(payload.email ?? ''),
        outletId: Number(payload.outletId ?? 1),
      };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

export function isTokenExpired(e: unknown): boolean {
  return e instanceof joseErrors.JWTExpired;
}

/* ---------------- Refresh token ---------------- */

export function generateRefreshToken(): string {
  return randomBytes(48).toString('hex');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
