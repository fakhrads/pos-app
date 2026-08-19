/**
 * Import/Export Excel (SheetJS) — SPEC fase 2 §5.8, §7.5, US-05/US-06.
 *
 * Semua fungsi PARSING & BUILDING di sini MURNI (tanpa DB) sehingga bisa
 * diuji unit (tests/import-export.test.ts). Validasi terhadap DB
 * (kategori ada, SKU duplikat dengan entitas aktif) dilakukan di route.
 *
 * Batasan (SPEC §1.2): Fase 2 HANYA .xlsx (CSV import = P1-late).
 * Sel berisi '=' (formula) ditolak. Angka harus plain ("1.500" / "Rp 1.500"
 * ditolak — §7.5.2).
 */
import * as XLSX from 'xlsx';

/* ------------------------------------------------------------------ */
/* Kontrak template (SPEC §5.8 — mengikat)                            */
/* ------------------------------------------------------------------ */
export const PRODUCT_HEADERS = [
  'kategori',
  'nama',
  'sku',
  'barcode',
  'unit_dasar',
  'harga_beli',
  'harga_jual',
  'stok_awal',
  'stok_minimum',
  'kena_pajak',
  'track_stock',
  'expiry_date',
  'varian',
  'satuan_tambahan',
] as const;

export const REQUIRED_HEADERS = ['kategori', 'nama', 'harga_jual'] as const;

export const VARIANT_HEADERS = ['product_sku', 'nama', 'sku', 'barcode', 'harga_jual', 'stok'] as const;
export const UNIT_HEADERS = ['product_sku', 'unit', 'factor', 'sell_price', 'is_sellable', 'is_purchase_unit'] as const;

export const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_ROWS = 500;

/* ------------------------------------------------------------------ */
/* Tipe hasil parsing                                                  */
/* ------------------------------------------------------------------ */
export interface ParsedVariant {
  name: string;
  sku: string | null;
  barcode: string | null;
  sellingPrice: number;
  stock: number;
}

export interface ParsedUnit {
  unit: string;
  factor: number;
  sellPrice: number;
  isSellable: boolean;
  isPurchaseUnit: boolean;
  minQty: number;
}

export interface ParsedRow {
  rowNumber: number; // baris Excel (1-based, termasuk header)
  category: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  costPrice: number;
  sellingPrice: number;
  stock: number;
  minStock: number;
  isTaxable: boolean;
  trackStock: boolean;
  expiryDate: string | null;
  variants: ParsedVariant[];
  units: ParsedUnit[];
  /** Nama kolom (huruf kecil) yang SEL TERNYATA TERISI (untuk update-by-sku: hanya kolom terisi yang di-update, SPEC §5.7) */
  filled: string[];
}

export interface RowError {
  rowNumber: number;
  column: string;
  message: string;
}

export interface ParseResult {
  sheetMissing: boolean;
  empty: boolean;
  headerMissing: string[];
  tooManyRows: boolean; // > MAX_ROWS baris data → IMPORT_TOO_LARGE (AC-05.5)
  errors: RowError[]; // error per baris (validasi level file)
  rows: ParsedRow[];
}

/* ------------------------------------------------------------------ */
/* Parsing sel angka (SPEC §7.5.1-2)                                   */
/* ------------------------------------------------------------------ */

/** null = kosong; NaN = format tidak valid. Tolak 'Rp', koma, '='; opsi
 *  rejectThousand=true (kolom uang): tolak "1.500" (titik ribuan, §7.5.2). */
export function parseNumberCell(v: unknown, opts?: { rejectThousand?: boolean }): number | null | typeof NaN {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const s = String(v).trim();
  if (s === '') return null;
  if (s.startsWith('=')) return NaN; // formula — ditolak (SPEC §9.4)
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN; // hanya digit + titik desimal
  if (opts?.rejectThousand && /^-?\d+\.\d{3}$/.test(s)) return NaN; // "1.500" = titik ribuan
  return Number(s);
}

/** Parse boolean TRUE/FALSE (case-insensitive). null = tidak terisi. */
export function parseBoolCell(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toUpperCase();
  if (s === 'TRUE' || s === '1') return true;
  if (s === 'FALSE' || s === '0') return false;
  return null; // invalid
}

/** Tanggal: `YYYY-MM-DD` ATAU ISO 8601 (`2026-12-31T00:00:00Z`, dengan T).
 *  Nilai balik selalu `YYYY-MM-DD` (kolom DATE). null = kosong;
 *  null-invalid dibedakan via flag. Bug QA-3: format ISO dengan T harus diterima. */
export function parseDateCell(v: unknown): { value: string | null; invalid: boolean } {
  if (v === null || v === undefined) return { value: null, invalid: false };
  if (v instanceof Date) return { value: v.toISOString().slice(0, 10), invalid: false };
  const s = String(v).trim();
  if (s === '') return { value: null, invalid: false };

  // Format 1: YYYY-MM-DD (validasi ketat: 2026-02-31 → invalid)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return { value: null, invalid: true };
    return { value: s, invalid: false };
  }

  // Format 2: ISO 8601 dengan T (contoh: 2026-12-31T00:00:00Z, ...+07:00)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(s)) {
    if (Number.isNaN(new Date(s).getTime())) return { value: null, invalid: true };
    // Ambil komponen TANGGAL sebagaimana ditulis klien (bukan konversi UTC —
    // hindari 2026-01-01T00:00:00+07:00 berubah jadi 2025-12-31), lalu validasi
    // bahwa tanggal tersebut nyata (2026-02-31 → invalid).
    const ymd = s.slice(0, 10);
    const d = new Date(`${ymd}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== ymd) return { value: null, invalid: true };
    return { value: ymd, invalid: false };
  }

  return { value: null, invalid: true };
}

/* ------------------------------------------------------------------ */
/* Parsing sel varian / satuan (SPEC §5.8)                             */
/* ------------------------------------------------------------------ */

/**
 * `Nama|SKU|Barcode|HargaJual|Stok`, beberapa dipisah `;`.
 * HargaJual wajib; lainnya opsional. Error → { errors, variants }.
 */
export function parseVariantCell(v: unknown): { variants: ParsedVariant[]; errors: { message: string }[] } {
  const variants: ParsedVariant[] = [];
  const errors: { message: string }[] = [];
  if (v === null || v === undefined) return { variants, errors };
  const s = String(v).trim();
  if (s === '') return { variants, errors };
  for (const seg of s.split(';')) {
    const parts = seg.split('|').map((p) => p.trim());
    if (parts.length < 1 || (parts.length === 1 && parts[0] === '')) {
      errors.push({ message: 'segmen varian kosong' });
      continue;
    }
    const name = parts[0] ?? '';
    if (name === '') {
      errors.push({ message: 'nama varian wajib diisi' });
      continue;
    }
    const price = parseNumberCell(parts[3] ?? '');
    if (price === null || Number.isNaN(price as number) || (price as number) <= 0) {
      errors.push({ message: `harga jual varian '${name}' wajib angka > 0` });
      continue;
    }
    const stock = parseNumberCell(parts[4] ?? '');
    if (stock !== null && !Number.isNaN(stock as number) && (stock as number) < 0) {
      errors.push({ message: `stok varian '${name}' tidak boleh negatif` });
      continue;
    }
    variants.push({
      name,
      sku: parts[1] && parts[1] !== '' ? parts[1] : null,
      barcode: parts[2] && parts[2] !== '' ? parts[2] : null,
      sellingPrice: price as number,
      stock: stock === null || Number.isNaN(stock as number) ? 0 : (stock as number),
    });
  }
  return { variants, errors };
}

/**
 * `unit|factor|sell_price|is_sellable|is_purchase_unit`, dipisah `;`.
 * is_sellable/is_purchase_unit = 1/0 (kosong → default 1 / 0).
 */
export function parseUnitCell(v: unknown): { units: ParsedUnit[]; errors: { message: string }[] } {
  const units: ParsedUnit[] = [];
  const errors: { message: string }[] = [];
  if (v === null || v === undefined) return { units, errors };
  const s = String(v).trim();
  if (s === '') return { units, errors };
  for (const seg of s.split(';')) {
    const parts = seg.split('|').map((p) => p.trim());
    const unit = parts[0] ?? '';
    if (unit === '') {
      errors.push({ message: 'satuan tambahan tanpa nama satuan' });
      continue;
    }
    const factor = parseNumberCell(parts[1] ?? '');
    if (factor === null || Number.isNaN(factor as number) || (factor as number) <= 0) {
      errors.push({ message: `factor satuan '${unit}' wajib angka > 0` });
      continue;
    }
    const price = parseNumberCell(parts[2] ?? '');
    if (price !== null && !Number.isNaN(price as number) && (price as number) < 0) {
      errors.push({ message: `harga satuan '${unit}' tidak boleh negatif` });
      continue;
    }
    const sellable = parseBoolCell(parts[3] ?? '');
    const purch = parseBoolCell(parts[4] ?? '');
    if (sellable === null && (parts[3] ?? '').trim() !== '') {
      errors.push({ message: `is_sellable satuan '${unit}' harus 1/0` });
      continue;
    }
    if (purch === null && (parts[4] ?? '').trim() !== '') {
      errors.push({ message: `is_purchase_unit satuan '${unit}' harus 1/0` });
      continue;
    }
    units.push({
      unit,
      factor: factor as number,
      sellPrice: price === null || Number.isNaN(price as number) ? 0 : (price as number),
      isSellable: sellable ?? true,
      isPurchaseUnit: purch ?? false,
      minQty: 1, // format cell tidak memuat min_qty (harga bertingkat R5 = P1-late)
    });
  }
  return { units, errors };
}

/* ------------------------------------------------------------------ */
/* Parsing workbook                                                    */
/* ------------------------------------------------------------------ */

function cellText(ws: XLSX.WorkSheet, addr: string): unknown {
  const c = ws[addr];
  if (!c) return undefined;
  // Formula/macro — TIDAK dieksekusi; ditandai '=' agar parser angka menolaknya (SPEC §9.4)
  if (c.f) return `=${c.f}`;
  if (c.t === 's' || c.t === 'str') return c.v;
  if (c.t === 'n') return c.v as number;
  if (c.t === 'b') return c.v as boolean;
  if (c.t === 'd') return c.v as Date;
  return c.v;
}

/**
 * Baca sheet 'Produk': validasi header (wajib, urutan bebas) → parse baris
 * (maks 500) → kumpulkan semua error baris (jangan stop di error pertama).
 * Validasi level DB (kategori/SKU) dilakukan pemanggil.
 */
export function parseWorkbook(buffer: Uint8Array | ArrayBuffer): ParseResult {
  const result: ParseResult = {
    sheetMissing: false,
    empty: false,
    headerMissing: [],
    tooManyRows: false,
    errors: [],
    rows: [],
  };

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellText: true, cellFormula: true, cellDates: false });
  } catch {
    result.headerMissing = ['(file bukan .xlsx valid)'];
    return result;
  }

  const ws = wb.Sheets['Produk'];
  if (!ws) {
    result.sheetMissing = true;
    return result;
  }
  const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
  if (!range || range.e.r < 1) {
    result.empty = true;
    return result;
  }

  // Header row (baris 1) — match by nama, urutan bebas (SPEC §7.5.4)
  const headerMap = new Map<string, number>(); // nama kolom → index (0-based)
  const unknownCols: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const raw = cellText(ws, XLSX.utils.encode_cell({ r: 0, c }));
    const name = raw === undefined || raw === null ? '' : String(raw).trim().toLowerCase();
    if (name === '') continue;
    if ((PRODUCT_HEADERS as readonly string[]).includes(name)) {
      if (!headerMap.has(name)) headerMap.set(name, c);
    } else {
      unknownCols.push(name);
    }
  }
  for (const h of REQUIRED_HEADERS) {
    if (!headerMap.has(h)) result.headerMissing.push(h);
  }
  if (result.headerMissing.length > 0) return result;

  // Data rows — batas 500 baris data (AC-05.5: 800 baris → IMPORT_TOO_LARGE)
  if (range.e.r > MAX_ROWS) {
    result.tooManyRows = true;
    return result;
  }
  const dataRowCount = Math.min(range.e.r, MAX_ROWS);
  if (dataRowCount < 1) {
    result.empty = true;
    return result;
  }
  const get = (rowIdx: number, colName: string): unknown => {
    const c = headerMap.get(colName);
    return c === undefined ? undefined : cellText(ws, XLSX.utils.encode_cell({ r: rowIdx, c }));
  };

  const seenSkus = new Set<string>();
  const isFilled = (v: unknown): boolean => {
    if (v === undefined || v === null) return false;
    return String(v).trim() !== '';
  };
  for (let r = 1; r <= dataRowCount; r++) {
    const rowNumber = r + 1;
    const rowErrors: RowError[] = [];
    const push = (column: string, message: string): void => {
      rowErrors.push({ rowNumber, column, message });
    };

    // Kolom yang terisi di file (untuk update-by-sku: hanya ini yang di-update)
    const filled: string[] = [];
    for (const h of PRODUCT_HEADERS) {
      if (isFilled(get(r, h))) filled.push(h);
    }

    const category = String(get(r, 'kategori') ?? '').trim();
    const name = String(get(r, 'nama') ?? '').trim();
    if (!category) push('kategori', 'kategori wajib diisi');
    if (!name) push('nama', 'nama produk wajib diisi');

    const skuRaw = get(r, 'sku');
    const sku = skuRaw === undefined || skuRaw === null ? null : String(skuRaw).trim() || null;
    if (sku && sku.length > 50) push('sku', 'SKU maksimal 50 karakter');
    if (sku && seenSkus.has(sku)) push('sku', `SKU duplikat dalam file: '${sku}'`);
    if (sku) seenSkus.add(sku);

    const barcodeRaw = get(r, 'barcode');
    const barcode = barcodeRaw === undefined || barcodeRaw === null ? null : String(barcodeRaw).trim() || null;
    if (barcode && barcode.length > 100) push('barcode', 'barcode maksimal 100 karakter');

    // Kolom opsional: hanya divalidasi bila ADA di header (kolom absen = default, bukan error)
    const unitRaw = get(r, 'unit_dasar');
    const unit = unitRaw === undefined || String(unitRaw).trim() === '' ? 'pcs' : String(unitRaw).trim();
    if (unit.length > 20) push('unit_dasar', 'unit_dasar maksimal 20 karakter');

    const cost = parseNumberCell(get(r, 'harga_beli'), { rejectThousand: true });
    if (cost !== null && Number.isNaN(cost as number)) {
      push('harga_beli', 'harga_beli harus angka, tanpa Rp/titik ribuan');
    } else if ((cost as number) < 0) push('harga_beli', 'harga_beli tidak boleh negatif');

    const price = parseNumberCell(get(r, 'harga_jual'), { rejectThousand: true });
    if (price === null || Number.isNaN(price as number)) {
      push('harga_jual', 'harga_jual wajib diisi angka (tanpa Rp/titik ribuan)');
    } else if ((price as number) <= 0) push('harga_jual', 'harga_jual harus > 0');

    const stock = parseNumberCell(get(r, 'stok_awal'));
    if (stock !== null && !Number.isNaN(stock as number) && (stock as number) < 0) {
      push('stok_awal', 'stok_awal tidak boleh negatif');
    }

    const minStock = parseNumberCell(get(r, 'stok_minimum'));
    if (minStock !== null && !Number.isNaN(minStock as number) && (minStock as number) < 0) {
      push('stok_minimum', 'stok_minimum tidak boleh negatif');
    }

    let taxable: boolean | null = null;
    const taxableRaw = get(r, 'kena_pajak');
    if (taxableRaw !== undefined) {
      taxable = parseBoolCell(taxableRaw);
      if (taxable === null) push('kena_pajak', 'kena_pajak harus TRUE/FALSE');
    }
    let track: boolean | null = null;
    const trackRaw = get(r, 'track_stock');
    if (trackRaw !== undefined) {
      track = parseBoolCell(trackRaw);
      if (track === null) push('track_stock', 'track_stock harus TRUE/FALSE');
    }

    const exp = { value: null as string | null, invalid: false };
    const expRaw = get(r, 'expiry_date');
    if (expRaw !== undefined) {
      const parsedExp = parseDateCell(expRaw);
      exp.value = parsedExp.value;
      exp.invalid = parsedExp.invalid;
      if (exp.invalid) push('expiry_date', 'expiry_date harus format YYYY-MM-DD atau ISO 8601 (mis. 2026-12-31T00:00:00Z)');
    }

    const varCell = get(r, 'varian') !== undefined ? parseVariantCell(get(r, 'varian')) : { variants: [], errors: [] };
    for (const e of varCell.errors) push('varian', e.message);
    // SKU varian ikut namespace SKU global — cek duplikat dalam file
    for (const vv of varCell.variants) {
      if (vv.sku && vv.sku.length > 50) push('varian', `SKU varian '${vv.sku}' maksimal 50 karakter`);
      if (vv.sku && seenSkus.has(vv.sku)) push('varian', `SKU varian duplikat dalam file: '${vv.sku}'`);
      if (vv.sku) seenSkus.add(vv.sku);
    }
    if (varCell.variants.length > 4) push('varian', 'maksimal 4 varian per produk (Fase 2)');

    const unitCell = get(r, 'satuan_tambahan') !== undefined ? parseUnitCell(get(r, 'satuan_tambahan')) : { units: [], errors: [] };
    for (const e of unitCell.errors) push('satuan_tambahan', e.message);
    // unit satuan tambahan tidak boleh sama dengan unit_dasar (SPEC §3.3)
    for (const uu of unitCell.units) {
      if (uu.unit.toLowerCase() === unit.toLowerCase()) {
        push('satuan_tambahan', `satuan '${uu.unit}' sama dengan unit_dasar — tidak diizinkan`);
      }
    }
    if (unitCell.units.length > 5) push('satuan_tambahan', 'maksimal 5 satuan tambahan per produk (Fase 2)');

    if (rowErrors.length > 0) {
      result.errors.push(...rowErrors);
      continue;
    }

    // Track_stock=false TIDAK boleh punya varian (AC-04.4 / PARENT_NO_STOCK_TRACKING)
    if (track === false && varCell.variants.length > 0) {
      result.errors.push({ rowNumber, column: 'varian', message: 'produk jasa (track_stock=FALSE) tidak boleh punya varian' });
      continue;
    }

    result.rows.push({
      rowNumber,
      category,
      name,
      sku,
      barcode,
      unit,
      costPrice: cost === null || Number.isNaN(cost as number) ? 0 : (cost as number),
      sellingPrice: price as number,
      stock: stock === null || Number.isNaN(stock as number) ? 0 : (stock as number),
      minStock: minStock === null || Number.isNaN(minStock as number) ? 0 : (minStock as number),
      isTaxable: taxable ?? true,
      trackStock: track ?? true,
      expiryDate: exp.value,
      variants: varCell.variants,
      units: unitCell.units,
      filled,
    });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Build workbook                                                      */
/* ------------------------------------------------------------------ */

function aoaSheet(rows: unknown[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows);
}

/** Template import: 3 sheet (Produk + contoh 1 baris, Varian, Satuan). */
export function buildImportTemplate(): Buffer {
  const wb = XLSX.utils.book_new();
  const example = [
    'Makanan',
    'Contoh Produk - hapus baris ini',
    'CTH-001',
    '8990000000000',
    'pcs',
    5000,
    6500,
    100,
    5,
    'TRUE',
    'TRUE',
    '',
    'Varian A|CTH-001-A||7000|10;Varian B|CTH-001-B|8990000000001|7500|5',
    'dus|40|240000|1|1;renceng|10|60000|1|0',
  ];
  const headerRow = [...PRODUCT_HEADERS];
  XLSX.utils.book_append_sheet(wb, aoaSheet([headerRow, example]), 'Produk');
  XLSX.utils.book_append_sheet(wb, aoaSheet([[...VARIANT_HEADERS]]), 'Varian');
  XLSX.utils.book_append_sheet(wb, aoaSheet([[...UNIT_HEADERS]]), 'Satuan');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export interface ExportProductRow {
  categoryName: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  costPrice: number;
  sellingPrice: number;
  stock: number;
  minStock: number;
  isTaxable: boolean;
  trackStock: boolean;
  expiryDate: string | null;
  variants: ParsedVariant[];
  units: ParsedUnit[];
}

/**
 * Export 3 sheet: Produk / Varian / Satuan (struktur kolom = template import,
 * round-trip AC-06.2 — kolom `stok_awal` = stok saat ini, SPEC §5.9).
 * `stok_awal` untuk produk ber-varian = 0 (stok hidup di varian).
 */
export function buildExportWorkbook(rows: ExportProductRow[]): Buffer {
  const wb = XLSX.utils.book_new();

  const variantRows: unknown[][] = [[...VARIANT_HEADERS]];
  const unitRows: unknown[][] = [[...UNIT_HEADERS]];

  const productRows: unknown[][] = [[...PRODUCT_HEADERS]];
  for (const p of rows) {
    productRows.push([
      p.categoryName,
      p.name,
      p.sku ?? '',
      p.barcode ?? '',
      p.unit,
      p.costPrice,
      p.sellingPrice,
      p.stock,
      p.minStock,
      p.isTaxable ? 'TRUE' : 'FALSE',
      p.trackStock ? 'TRUE' : 'FALSE',
      p.expiryDate ?? '',
      p.variants
        .map((v) => [v.name, v.sku ?? '', v.barcode ?? '', v.sellingPrice, v.stock].join('|'))
        .join(';'),
      p.units
        .map((u) => [u.unit, u.factor, u.sellPrice, u.isSellable ? 1 : 0, u.isPurchaseUnit ? 1 : 0].join('|'))
        .join(';'),
    ]);
    for (const v of p.variants) {
      variantRows.push([p.sku ?? '', v.name, v.sku ?? '', v.barcode ?? '', v.sellingPrice, v.stock]);
    }
    for (const u of p.units) {
      unitRows.push([p.sku ?? '', u.unit, u.factor, u.sellPrice, u.isSellable ? 1 : 0, u.isPurchaseUnit ? 1 : 0]);
    }
  }

  XLSX.utils.book_append_sheet(wb, aoaSheet(productRows), 'Produk');
  XLSX.utils.book_append_sheet(wb, aoaSheet(variantRows), 'Varian');
  XLSX.utils.book_append_sheet(wb, aoaSheet(unitRows), 'Satuan');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Gabungkan varian/unit menjadi kolom sel (untuk export). */
export function joinVariants(variants: { name: string; sku?: string | null; barcode?: string | null; sellingPrice: number; stockOnHand: number }[]): string {
  return variants.map((v) => [v.name, v.sku ?? '', v.barcode ?? '', v.sellingPrice, v.stockOnHand].join('|')).join(';');
}

export function joinUnits(units: { unit: string; factor: number; sellPrice: number; isSellable: boolean; isPurchaseUnit: boolean }[]): string {
  return units.map((u) => [u.unit, u.factor, u.sellPrice, u.isSellable ? 1 : 0, u.isPurchaseUnit ? 1 : 0].join('|')).join(';');
}
