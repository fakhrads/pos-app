/**
 * Unit test: konversi satuan & kuantitas (SPEC §4.4, §5.1, §7.4).
 * Pure functions dari lib/units.ts & lib/money.ts — tanpa DB.
 */
import { describe, expect, test } from 'bun:test';
import { convertToBaseQty, availableInUnit, costForUnit, normalizeSaleQty, stockMessage } from '../src/lib/units';
import { toQty, roundMoney, percentOf, taxExclusive, taxInclusive, pointsFrom, redeemValue } from '../src/lib/money';

describe('convertToBaseQty (qty_stok = round3(qty × factor))', () => {
  test('unit dasar: factor 1 → identik', () => {
    expect(convertToBaseQty(2, 1)).toBe(2);
  });
  test('2 dus × 40 pcs = 80 pcs (AC-03.3)', () => {
    expect(convertToBaseQty(2, 40)).toBe(80);
  });
  test('factor desimal: 1.5 kg → 1 ikat = 0.5 kg', () => {
    expect(convertToBaseQty(1, 0.5)).toBe(0.5);
  });
  test('pembulatan 3 desimal round half-up', () => {
    expect(convertToBaseQty(1, 0.3334)).toBe(0.333);
    expect(convertToBaseQty(1, 0.3335)).toBe(0.334);
    expect(convertToBaseQty(3, 1.5)).toBe(4.5);
  });
});

describe('availableInUnit (stok dalam satuan pilihan, floor)', () => {
  test('AC-03.1: 100 pcs, dus factor 40 → floor(100/40) = 2 dus', () => {
    expect(availableInUnit(100, 40)).toBe(2);
  });
  test('unit dasar: floor(stok/1) = stok', () => {
    expect(availableInUnit(7, 1)).toBe(7);
  });
  test('stok 9 pcs, dus 40 → 0 dus', () => {
    expect(availableInUnit(9, 40)).toBe(0);
  });
});

describe('costForUnit (HPP snapshot per satuan)', () => {
  test('cost 2300 × factor 40 = 92.000 (AC-03.4)', () => {
    expect(costForUnit(2300, 40)).toBe(92000);
  });
  test('factor desimal dibulatkan', () => {
    expect(costForUnit(1000, 0.5)).toBe(500);
  });
});

describe('normalizeSaleQty (presisi 0.001 — SPEC §7.4.8)', () => {
  test('qty valid', () => {
    expect(normalizeSaleQty(2.5)).toBe(2.5);
    expect(normalizeSaleQty(0.001)).toBe(0.001);
  });
  test('qty 0.0004 → dibulatkan 0 → ditolak', () => {
    expect(normalizeSaleQty(0.0004)).toBeNull();
  });
  test('qty ≤ 0 atau NaN ditolak', () => {
    expect(normalizeSaleQty(0)).toBeNull();
    expect(normalizeSaleQty(-1)).toBeNull();
    expect(normalizeSaleQty(Number.NaN)).toBeNull();
  });
});

describe('stockMessage', () => {
  test('SPEC §7.4.2: tersisa 10 pcs, diminta 40 pcs', () => {
    expect(stockMessage(10, 40, 'pcs')).toBe('Stok tidak cukup (tersisa 10 pcs, diminta 40 pcs)');
  });
});

describe('money helpers (regresi existing)', () => {
  test('roundMoney half-up', () => {
    expect(roundMoney(184000)).toBe(184000);
    expect(roundMoney(0.5)).toBe(1);
  });
  test('percentOf', () => {
    expect(percentOf(10000, 10)).toBe(1000);
  });
  test('taxExclusive 11%', () => {
    expect(taxExclusive(10000, 11)).toBe(1100);
  });
  test('taxInclusive 11%', () => {
    expect(taxInclusive(11100, 11)).toBe(1100);
  });
  test('pointsFrom floor(total/1000)', () => {
    expect(pointsFrom(64999, 1000)).toBe(64);
    expect(pointsFrom(1000, 1000)).toBe(1);
    expect(pointsFrom(999, 1000)).toBe(0);
  });
  test('redeemValue', () => {
    expect(redeemValue(10, 10)).toBe(100);
  });
  test('toQty 3 desimal', () => {
    expect(toQty(1.23456)).toBe(1.235);
  });
});
