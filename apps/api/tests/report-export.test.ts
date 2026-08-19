/**
 * Unit test: export laporan (report-export.ts) — Fase 5 (SPEC §5, REP-05).
 * Pure — tanpa DB. Memverifikasi:
 *  - buildWorkbook → Buffer XLSX valid yang bisa dibaca ulang oleh SheetJS
 *  - buildPdfTable → Buffer PDF valid (header %PDF) & berisi teks (opsional)
 */
import { describe, expect, test } from 'bun:test';
import * as XLSX from 'xlsx';
import { buildWorkbook, buildPdfTable, type ExportSheet } from '../src/lib/report-export';

describe('buildWorkbook (XLSX)', () => {
  test('satu sheet: header + baris, bisa dibaca ulang', () => {
    const sheets: ExportSheet[] = [
      {
        name: 'Penjualan',
        rows: [
          ['Produk', 'Qty', 'Revenue'],
          ['Indomie', 10, 12000],
          ['Kopi', 5, 30000],
        ],
      },
    ];
    const buf = buildWorkbook(sheets);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf[0]).toBe(0x50); // 'P' PK zip

    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets['Penjualan']!;
    const data = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1 });
    expect(data[0]).toEqual(['Produk', 'Qty', 'Revenue']);
    expect(data[1]).toEqual(['Indomie', 10, 12000]);
    expect(data[2]).toEqual(['Kopi', 5, 30000]);
  });

  test('multi sheet: nama sheet di-truncate ke 31 char', () => {
    const buf = buildWorkbook([
      { name: 'a'.repeat(50), rows: [['x']] },
      { name: 'Sheet Dua', rows: [['y']] },
    ]);
    const wb = XLSX.read(buf, { type: 'buffer' });
    const names = wb.SheetNames;
    expect(names.length).toBe(2);
    expect(names[0]!.length).toBe(31);
    expect(names[1]).toBe('Sheet Dua');
  });

  test('sheet kosong tanpa baris → workbook tetap valid', () => {
    const buf = buildWorkbook([{ name: 'Kosong', rows: [] }]);
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toContain('Kosong');
  });
});

describe('buildPdfTable (PDF)', () => {
  test('menghasilkan buffer PDF valid (header %PDF + trailer EOF)', async () => {
    const buf = await buildPdfTable({
      title: 'Laporan Penjualan',
      subtitle: '2026-08-01 s/d 2026-08-31',
      columns: [
        { label: 'Produk' },
        { label: 'Qty', align: 'right' },
        { label: 'Revenue', align: 'right' },
      ],
      rows: [
        ['Indomie', 10, 12000],
        ['Kopi', 5, 30000],
      ],
      footer: ['TOTAL', 15, 42000],
    });
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const tail = buf.subarray(-20).toString();
    expect(tail).toContain('%%EOF');
  });

  test('rows kosong tetap menghasilkan PDF valid', async () => {
    const buf = await buildPdfTable({
      title: 'Tidak ada data',
      columns: [{ label: 'Kolom' }],
      rows: [],
    });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('banyak baris (> 1 halaman) tetap PDF valid', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => [`Produk ${i + 1}`, i + 1, (i + 1) * 1000]);
    const buf = await buildPdfTable({
      title: 'Laporan Panjang',
      columns: [
        { label: 'Produk' },
        { label: 'Qty', align: 'right' },
        { label: 'Revenue', align: 'right' },
      ],
      rows,
    });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
