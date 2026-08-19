/**
 * Unit test: Split payment (US-03, SPEC §4.5 → backend processPayments).
 * TIDAK butuh database — logika alokasi pembayaran murni (pure function).
 *
 * Cakupan (AC):
 *  - AC-03.2 : tunai 100k + qris 50k untuk total 150k → 2 leg, sisa 0, paid
 *  - AC-03.4 : cashReceived 200k utk 150k → changeAmount 50k
 *  - AC-03.5 : kembalian HANYA dari leg cash; qris tanpa change
 *  - AC-03.8 : 3 leg (cash+qris+transfer) → 3 baris, total leg = total
 *  - §5.1    : Σ payments ≠ total → 422 PAYMENT_MISMATCH
 *  - §7.2.4  : nominal leg melebihi sisa → PAYMENT_MISMATCH
 *  - Edge    : tanpa payments → PAYMENT_MISMATCH; cashReceived < amount → error
 */
import { describe, expect, test } from 'bun:test';
import { processPayments, type PaymentInput } from '../src/services/checkout.service';
import { isAppError } from '../src/lib/errors';

async function failOf(fn: () => unknown): Promise<{ code: string }> {
  try {
    fn();
  } catch (e) {
    if (isAppError(e)) return { code: e.code } as { code: string };
    throw e;
  }
  throw new Error('diharapkan throw AppError');
}

describe('split payment: campuran tunai + QRIS (AC-03.2)', () => {
  test('tunai 100k + qris 50k untuk total 150k → 2 leg lunas (AC-03.2)', () => {
    const raw: PaymentInput[] = [
      { method: 'cash', amount: 100000, cashReceived: 100000 },
      { method: 'qris', amount: 50000 },
    ];
    const out = processPayments(raw, 150000);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ method: 'cash', amount: 100000, status: 'paid' });
    expect(out[0]!.changeAmount).toBe(0);
    expect(out[1]).toMatchObject({ method: 'qris', amount: 50000, status: 'paid' });
    expect(out[1]!.changeAmount).toBeNull();
    expect(out.reduce((a, p) => a + p.amount, 0)).toBe(150000);
  });
});

describe('split payment: kembalian hanya dari leg cash (AC-03.4, AC-03.5)', () => {
  test('total 150k dibayar 200k tunai → changeAmount 50000 (AC-03.4)', () => {
    const out = processPayments([{ method: 'cash', amount: 150000, cashReceived: 200000 }], 150000);
    expect(out[0]).toMatchObject({ method: 'cash', amount: 150000, cashReceived: 200000 });
    expect(out[0]!.changeAmount).toBe(50000);
  });

  test('qris 100k + tunai 50k (cashReceived 100k) → kembalian 50k hanya leg cash (AC-03.5)', () => {
    const out = processPayments(
      [
        { method: 'qris', amount: 100000 },
        { method: 'cash', amount: 50000, cashReceived: 100000 },
      ],
      150000,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ method: 'qris', amount: 100000 });
    expect(out[0]!.changeAmount).toBeNull(); // leg non-cash tidak punya kembalian
    expect(out[1]).toMatchObject({ method: 'cash', amount: 50000 });
    expect(out[1]!.changeAmount).toBe(50000); // hanya cash yang mengembalikan
  });
});

describe('split payment: 3 leg (AC-03.8)', () => {
  test('tunai + qris + transfer → 3 baris urutan dikirim, total = total', () => {
    const out = processPayments(
      [
        { method: 'cash', amount: 50000, cashReceived: 50000 },
        { method: 'qris', amount: 60000 },
        { method: 'transfer', amount: 40000, referenceNumber: 'REF-2026' },
      ],
      150000,
    );
    expect(out).toHaveLength(3);
    expect(out.map((p) => p.method)).toEqual(['cash', 'qris', 'transfer']);
    expect(out[2]!.referenceNumber).toBe('REF-2026');
    expect(out.reduce((a, p) => a + p.amount, 0)).toBe(150000);
    // Semua leg non-cash tidak punya change
    expect(out[1]!.changeAmount).toBeNull();
    expect(out[2]!.changeAmount).toBeNull();
  });
});

describe('split payment: validasi jumlah (SPEC §5.1, §7.2.4)', () => {
  test('tanpa payments → 422 PAYMENT_MISMATCH', async () => {
    const r = await failOf(() => processPayments([], 150000));
    expect(r.code).toBe('PAYMENT_MISMATCH');
  });

  test('jumlah leg < total → 422 PAYMENT_MISMATCH', async () => {
    const r = await failOf(() => processPayments([{ method: 'cash', amount: 100000, cashReceived: 100000 }], 150000));
    expect(r.code).toBe('PAYMENT_MISMATCH');
  });

  test('single leg cash overpay → VALID: applied dicap ke total & kembalian (quick cash, §7.2)', () => {
    const out = processPayments([{ method: 'cash', amount: 160000, cashReceived: 160000 }], 150000);
    expect(out).toHaveLength(1);
    expect(out[0]!.amount).toBe(150000); // applied dibatasi ke sisa
    expect(out[0]!.changeAmount).toBe(10000);
  });

  test('leg berikutnya tidak punya sisa (total sudah tertutup) → 422 PAYMENT_MISMATCH', async () => {
    const r = await failOf(() =>
      processPayments(
        [
          { method: 'cash', amount: 150000, cashReceived: 150000 },
          { method: 'qris', amount: 50000 }, // total sudah lunas — leg ini berlebih
        ],
        150000,
      ),
    );
    expect(r.code).toBe('PAYMENT_MISMATCH');
  });

  test('cashReceived < amount → 422 PAYMENT_MISMATCH (AC-03.5 quick cash)', async () => {
    const r = await failOf(() => processPayments([{ method: 'cash', amount: 150000, cashReceived: 100000 }], 150000));
    expect(r.code).toBe('PAYMENT_MISMATCH');
  });
});
