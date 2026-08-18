/**
 * Error bisnis — satu titik untuk envelope { ok:false, error:{ code, message, details } }.
 * Dipakai oleh semua route; ditangkap di onError global (src/index.ts).
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Throw AppError — helper ringkas: `fail('NOT_FOUND', 'Produk tidak ditemukan', 404)` */
export function fail(code: string, message: string, status = 400, details?: unknown): never {
  throw new AppError(code, message, status, details);
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
