/**
 * Export Laporan — XLSX (SheetJS) & PDF (pdf-lib) — Fase 5 (SPEC §5, REP-05).
 *
 * Semua laporan bisa diexport ke Excel maupun PDF. SheetJS (`xlsx`) sudah
 * dipakai Fase 2 untuk import/export master produk; pdf-lib ditambahkan Fase 5
 * untuk export PDF (cetak/arsip).
 *
 * Konvensi:
 *  - XLSX  : 1 sheet per laporan, baris pertama = header (label Indonesia).
 *            Nilai angka mentah (rupiah/qty) dibiarkan numerik agar bisa
 *            diolah di spreadsheet.
 *  - PDF   : format A4 landscape, judul + periode, tabel sederhana.
 *            Font Standar 14 (Helvetica) — tidak perlu meload file font (aman offline).
 */

import * as XLSX from 'xlsx';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface ExportSheet {
  name: string; // nama sheet (XLSX) — juga dipakai di subjudul PDF
  rows: unknown[][]; // baris data; baris pertama opsional = header
}

/** Bangun workbook XLSX dari satu/lebih sheet → Buffer (bookType .xlsx). */
export function buildWorkbook(sheets: ExportSheet[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name.slice(0, 31));
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export interface PdfTableCol {
  label: string;
  align?: 'left' | 'right';
}

export interface PdfTableBuild {
  title: string;
  subtitle?: string;
  columns: PdfTableCol[];
  rows: unknown[][];
  /** Baris footer (1 baris) — digambar tebal, mis. TOTAL */
  footer?: unknown[];
}

const PAGE_W = 841.89; // A4 landscape (pt)
const PAGE_H = 595.28;
const MARGIN = 36;
const ROW_H = 22;
const HEADER_H = 26;
const FONT_SIZE = 9;
const BODY_TOP = MARGIN + 58;

/** Render tabel ke PDF A4 landscape. Nilai dibiarkan string/number apa adanya;
 *  kolom 'right' diratakan kanan. Halaman baru otomatis bila baris melebihi area. */
export async function buildPdfTable(build: PdfTableBuild): Promise<Buffer> {
  const { title, subtitle, columns, rows, footer } = build;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const gray = rgb(0.35, 0.35, 0.35);
  const black = rgb(0, 0, 0);

  const contentW = PAGE_W - MARGIN * 2;
  const colW = contentW / Math.max(columns.length, 1);
  const maxRowsPerPage = Math.max(1, Math.floor((PAGE_H - MARGIN - BODY_TOP - 34) / ROW_H));

  const drawCell = (
    page: any,
    text: string,
    x: number,
    y: number,
    align: 'left' | 'right',
    size: number,
    bold: boolean,
  ) => {
    const f = bold ? fontBold : font;
    const w = f.widthOfTextAtSize(text, size);
    const cx = align === 'right' ? x + colW - w : x + 3;
    page.drawText(text, { x: cx, y, size, font: f, color: black });
  };

  let y = 0;
  let page: any = null;

  const newPage = (first: boolean) => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
    if (first) {
      page.drawText(title, { x: MARGIN, y: y - 8, size: 16, font: fontBold, color: black });
      if (subtitle) page.drawText(subtitle, { x: MARGIN, y: y - 30, size: 10, font, color: gray });
    } else {
      page.drawText(`${title} (lanjutan)`, { x: MARGIN, y: y - 8, size: 12, font: fontBold, color: black });
    }
    y = BODY_TOP;
    for (const [i, col] of columns.entries()) {
      drawCell(page, col.label, MARGIN + i * colW, y, col.align ?? 'left', FONT_SIZE + 1, true);
    }
    y -= HEADER_H;
  };

  newPage(true);

  for (let k = 0; k < rows.length; k++) {
    if (y <= MARGIN + 4) newPage(false);
    const row = rows[k]!;
    for (const [i, col] of columns.entries()) {
      const text = row[i] === null || row[i] === undefined ? '' : String(row[i]);
      drawCell(page, text, MARGIN + i * colW, y, col.align ?? 'left', FONT_SIZE, false);
    }
    y -= ROW_H;
  }

  if (footer) {
    if (y <= MARGIN + 4) newPage(false);
    for (const [i, col] of columns.entries()) {
      const text = footer[i] === null || footer[i] === undefined ? '' : String(footer[i]);
      drawCell(page, text, MARGIN + i * colW, y, col.align ?? 'left', FONT_SIZE, true);
    }
  }

  void maxRowsPerPage;
  const bytes = await doc.save();
  return Buffer.from(bytes);
}
