/**
 * Unit test: import/export Excel (SPEC §5.8, §7.5, US-05/US-06, AC-05.x/AC-06.x).
 * Pure parsing dari lib/import-export.ts — tanpa DB.
 */
import { describe, expect, test } from 'bun:test';
import * as XLSX from 'xlsx';
import {
  parseWorkbook,
  parseNumberCell,
  parseBoolCell,
  parseDateCell,
  parseVariantCell,
  parseUnitCell,
  buildImportTemplate,
  buildExportWorkbook,
  PRODUCT_HEADERS,
  MAX_ROWS,
  type ExportProductRow,
} from '../src/lib/import-export';

/** Buat workbook sheet Produk dari array baris (baris 1 = header). */
function makeWorkbook(rows: (string | number | boolean)[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Produk');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const validRow = (over: Record<string, unknown> = {}): (string | number)[] => {
  const row = ['Makanan', 'Produk Test', 'TST-001', '8990000000001', 'pcs', 5000, 6500, 100, 5, 'TRUE', 'TRUE', '', '', ''];
  // posisi kolom sesuai PRODUCT_HEADERS
  for (const [k, v] of Object.entries(over)) {
    const idx = PRODUCT_HEADERS.indexOf(k as (typeof PRODUCT_HEADERS)[number]);
    if (idx >= 0) row[idx] = v as string | number;
  }
  return row;
};

describe('parseNumberCell (SPEC §7.5.1-2)', () => {
  test('angka plain', () => {
    expect(parseNumberCell(1500)).toBe(1500);
    expect(parseNumberCell('1500')).toBe(1500);
    expect(parseNumberCell('12.5')).toBe(12.5);
  });
  test('kosong → null', () => {
    expect(parseNumberCell(null)).toBeNull();
    expect(parseNumberCell(undefined)).toBeNull();
    expect(parseNumberCell('')).toBeNull();
  });
  test('format Rp/titik ribuan/koma/formula → NaN', () => {
    expect(Number.isNaN(parseNumberCell('Rp 1.500'))).toBe(true);
    expect(Number.isNaN(parseNumberCell('1.500', { rejectThousand: true }))).toBe(true);
    expect(Number.isNaN(parseNumberCell('1,5'))).toBe(true);
    expect(Number.isNaN(parseNumberCell('=1+1'))).toBe(true);
  });
});

describe('parseBoolCell / parseDateCell', () => {
  test('TRUE/FALSE case-insensitive + 1/0', () => {
    expect(parseBoolCell('TRUE')).toBe(true);
    expect(parseBoolCell('false')).toBe(false);
    expect(parseBoolCell(1)).toBe(true);
    expect(parseBoolCell(true)).toBe(true);
  });
  test('tanggal YYYY-MM-DD valid; format lain invalid', () => {
    expect(parseDateCell('2026-12-31')).toEqual({ value: '2026-12-31', invalid: false });
    expect(parseDateCell('')).toEqual({ value: null, invalid: false });
    expect(parseDateCell('31-12-2026').invalid).toBe(true);
    expect(parseDateCell('2026-13-45').invalid).toBe(true);
  });
  test('ISO 8601 dengan T diterima (bug QA-3)', () => {
    expect(parseDateCell('2026-12-31T00:00:00Z')).toEqual({ value: '2026-12-31', invalid: false });
    expect(parseDateCell('2026-12-31T07:30:00+07:00')).toEqual({ value: '2026-12-31', invalid: false });
    expect(parseDateCell('2026-01-01T00:00:00+07:00')).toEqual({ value: '2026-01-01', invalid: false }); // pakai tanggal sebagaimana ditulis, bukan konversi UTC
    expect(parseDateCell('2026-02-31T00:00:00Z').invalid).toBe(true); // tanggal mustahil tetap ditolak
    expect(parseDateCell('not-a-date').invalid).toBe(true);
  });
});

describe('parseVariantCell (format Nama|SKU|Barcode|HargaJual|Stok)', () => {
  test('AC-05.6: 2 varian lengkap', () => {
    const { variants, errors } = parseVariantCell('Sapi Panggang|SNK-101-A||7500|20;Cabe|SNK-101-B|8991234567890|7500|15');
    expect(errors).toHaveLength(0);
    expect(variants).toHaveLength(2);
    expect(variants[0]).toMatchObject({ name: 'Sapi Panggang', sku: 'SNK-101-A', barcode: null, sellingPrice: 7500, stock: 20 });
    expect(variants[1]).toMatchObject({ name: 'Cabe', sku: 'SNK-101-B', barcode: '8991234567890', sellingPrice: 7500, stock: 15 });
  });
  test('harga wajib → error', () => {
    const { errors } = parseVariantCell('Varian A|SKU-A|||10');
    expect(errors.length).toBeGreaterThan(0);
  });
  test('kosong → tanpa error', () => {
    expect(parseVariantCell('')).toEqual({ variants: [], errors: [] });
    expect(parseVariantCell(null)).toEqual({ variants: [], errors: [] });
  });
});

describe('parseUnitCell (format unit|factor|sell_price|is_sellable|is_purchase_unit)', () => {
  test('AC-05.7: dus & renceng', () => {
    const { units, errors } = parseUnitCell('dus|40|92000|1|1;renceng|10|24000|1|0');
    expect(errors).toHaveLength(0);
    expect(units).toHaveLength(2);
    expect(units[0]).toMatchObject({ unit: 'dus', factor: 40, sellPrice: 92000, isSellable: true, isPurchaseUnit: true });
    expect(units[1]).toMatchObject({ unit: 'renceng', factor: 10, sellPrice: 24000, isSellable: true, isPurchaseUnit: false });
  });
  test('factor 0 → error', () => {
    const { errors } = parseUnitCell('dus|0|92000|1|1');
    expect(errors.length).toBeGreaterThan(0);
  });
  test('default is_sellable=1 is_purchase_unit=0', () => {
    const { units } = parseUnitCell('lusin|12|120000||');
    expect(units[0]).toMatchObject({ unit: 'lusin', factor: 12, sellPrice: 120000, isSellable: true, isPurchaseUnit: false });
  });
});

describe('parseWorkbook — header & file-level (AC-05.4, AC-05.5)', () => {
  test('tanpa sheet Produk → sheetMissing', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a']]), 'Lain');
    const r = parseWorkbook(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
    expect(r.sheetMissing).toBe(true);
  });
  test('0 baris data → empty', () => {
    const r = parseWorkbook(makeWorkbook([[...PRODUCT_HEADERS]]));
    expect(r.empty).toBe(true);
  });
  test('header wajib hilang → headerMissing', () => {
    const r = parseWorkbook(makeWorkbook([['nama', 'sku'], ['X', 'Y']]));
    expect(r.headerMissing).toContain('kategori');
    expect(r.headerMissing).toContain('harga_jual');
  });
  test('>500 baris → tooManyRows (AC-05.5)', () => {
    const rows: (string | number)[][] = [[...PRODUCT_HEADERS]];
    for (let i = 0; i < MAX_ROWS + 5; i++) rows.push(validRow({ sku: `SKU-${i}` }));
    const r = parseWorkbook(makeWorkbook(rows));
    expect(r.tooManyRows).toBe(true);
  });
  test('urutan header bebas (match by nama)', () => {
    const shuffled = ['harga_jual', 'nama', 'kategori', 'sku'];
    const r = parseWorkbook(makeWorkbook([shuffled, ['6500', 'Produk X', 'Makanan', 'SKU-X']]));
    expect(r.headerMissing).toHaveLength(0);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ name: 'Produk X', category: 'Makanan', sellingPrice: 6500, sku: 'SKU-X' });
  });
});

describe('parseWorkbook — error per baris (AC-05.2)', () => {
  test('SKU duplikat dalam file → error baris kedua', () => {
    const r = parseWorkbook(makeWorkbook([[...PRODUCT_HEADERS], validRow({ sku: 'DUP-1' }), validRow({ sku: 'DUP-1' })]));
    expect(r.rows).toHaveLength(1);
    expect(r.errors.some((e) => e.column === 'sku' && e.message.includes('duplikat'))).toBe(true);
  });
  test('harga jual < 0 → error', () => {
    const r = parseWorkbook(makeWorkbook([[...PRODUCT_HEADERS], validRow({ harga_jual: -1 })]));
    expect(r.errors.some((e) => e.column === 'harga_jual')).toBe(true);
    expect(r.rows).toHaveLength(0);
  });
  test('harga jual kosong → error; harga beli kosong → 0 valid (SPEC §7.5.1)', () => {
    const r = parseWorkbook(makeWorkbook([[...PRODUCT_HEADERS], validRow({ harga_jual: '', harga_beli: '' })]));
    expect(r.errors.some((e) => e.column === 'harga_jual')).toBe(true);
    expect(r.rows).toHaveLength(0);
    const r2 = parseWorkbook(makeWorkbook([[...PRODUCT_HEADERS], validRow({ harga_jual: 6500, harga_beli: '' })]));
    expect(r2.errors).toHaveLength(0);
    expect(r2.rows[0]!.costPrice).toBe(0);
  });
  test('track_stock=FALSE dengan varian → error (AC-04.4 / PARENT_NO_STOCK_TRACKING)', () => {
    const r = parseWorkbook(makeWorkbook([[...PRODUCT_HEADERS], validRow({ track_stock: 'FALSE', varian: 'V1|SKU-V1||7000|10' })]));
    expect(r.errors.some((e) => e.column === 'varian' && e.message.includes('jasa'))).toBe(true);
  });
  test('kolom tak dikenal diabaikan, baris valid tetap diproses (SPEC §7.5.4)', () => {
    const rows = [[...PRODUCT_HEADERS, 'kolom_ekstra'], validRow()];
    const r = parseWorkbook(makeWorkbook(rows));
    expect(r.rows).toHaveLength(1);
  });
});

describe('round-trip export → import (AC-06.2)', () => {
  const exportRows: ExportProductRow[] = [
    {
      categoryName: 'Makanan', name: 'Indomie Goreng', sku: 'MKN-001', barcode: null, unit: 'bungkus',
      costPrice: 2600, sellingPrice: 3500, stock: 300, minStock: 5, isTaxable: true, trackStock: true,
      expiryDate: null,
      variants: [{ name: 'Rasa Goreng Original', sku: 'MKN-001-A', barcode: null, sellingPrice: 3500, stock: 160 }],
      units: [{ unit: 'dus', factor: 40, sellPrice: 126000, isSellable: true, isPurchaseUnit: true, minQty: 1 }],
    },
    {
      categoryName: 'Lainnya', name: 'Jasa Service AC', sku: 'JAS-001', barcode: null, unit: 'unit',
      costPrice: 0, sellingPrice: 75000, stock: 0, minStock: 0, isTaxable: true, trackStock: false,
      expiryDate: null, variants: [], units: [],
    },
  ];
  test('3 sheet dengan nama Produk/Varian/Satuan (AC-06.1)', () => {
    const buf = buildExportWorkbook(exportRows);
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Produk', 'Varian', 'Satuan']);
  });
  test('file export di-import ulang → baris dikenali (updated-by-sku jalan di route)', () => {
    const buf = buildExportWorkbook(exportRows);
    const parsed = parseWorkbook(buf);
    expect(parsed.headerMissing).toHaveLength(0);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.rows).toHaveLength(2);
    const indomie = parsed.rows.find((r) => r.sku === 'MKN-001')!;
    expect(indomie.variants).toHaveLength(1);
    expect(indomie.units).toHaveLength(1);
    expect(indomie.units[0]).toMatchObject({ unit: 'dus', factor: 40, sellPrice: 126000 });
    const jasa = parsed.rows.find((r) => r.sku === 'JAS-001')!;
    expect(jasa.trackStock).toBe(false);
  });
  test('katalog kosong → file valid dengan header (AC-06.4)', () => {
    const buf = buildExportWorkbook([]);
    const parsed = parseWorkbook(buf);
    expect(parsed.empty).toBe(true); // 0 baris data — bukan error header
    expect(parsed.headerMissing).toHaveLength(0);
  });
});

describe('template import (AC-05.1 flow)', () => {
  test('template punya 3 sheet + header lengkap', () => {
    const buf = buildImportTemplate();
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Produk', 'Varian', 'Satuan']);
    const parsed = parseWorkbook(buf);
    expect(parsed.headerMissing).toHaveLength(0);
    expect(parsed.rows.length).toBeGreaterThanOrEqual(1); // baris contoh
  });
});
