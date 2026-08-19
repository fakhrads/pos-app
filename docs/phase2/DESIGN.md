# DESIGN — Fase 2: Data & Produk

> **Proyek:** FakhriPOS — POS (Next.js + shadcn/ui + Tailwind v4)
> **Peran penulis:** UI/UX Designer
> **Sumber:** `docs/phase2/SPEC.md` (mengikat), `design-tokens.ts` v2, `globals.css`, `docs/fase-0-design.md`
> **Status:** mengikat untuk frontend developer Fase 2. Bila kontradiksi dengan SPEC → SPEC menang.

## 0. Ringkasan & Keputusan Desain

**Layar yang dikerjakan Fase 2:**
| # | Layar / Dialog | Status | Halaman |
|---|---|---|---|
| L1 | Daftar Produk (extended: varian, jasa, import/export) | Extend `/products` | `products/page.tsx` |
| L2 | Detail Produk (info + varian + satuan + koreksi stok) | **Baru** | `products/[id]/page.tsx` |
| L3 | Form Produk (induk + baris varian inline) | Extend (dialog existing) | komponen |
| L4 | Form Varian (standalone, dari detail) | **Baru** | komponen |
| L5 | Form Satuan (tambah/ubah satuan konversi) | **Baru** | komponen |
| L6 | Dialog Import Excel (template → unggah → hasil) | **Baru** | komponen |
| L7 | Koreksi Stok (produk & varian) | Extend (dialog existing) | komponen |

**Keputusan desain (dengan alasan):**
1. **Satuan dikelola dari halaman Detail, bukan Form Produk.** Form create tidak memuat section satuan — hanya Info Dasar + Varian. Alasan: (a) form mobile jangan overload; (b) mental model SPEC = "satuan **tambahan** per produk" yang ditambahkan setelah produk ada; (c) API `POST /products` tetap menerima `units[]`, tapi UI memakai alur detail → Tambah Satuan (pola terbukti Kasaba/R1). Import Excel tetap bisa membuat satuan langsung (round-trip).
2. **Varian inline di Form Produk** (AC-01.1: create produk + varian dalam 1 POST) **dan** dikelola standalone dari Detail (AC-02.1: PATCH per varian). Keduanya pakai set field yang sama → satu sumber kebenaran di `VariantFormRows`.
3. **List produk mobile = kartu, desktop = tabel.** Tabel 7 kolom tidak muat di 360px dan melanggar target sentuh 48px; kartu memberi ruang badge varian/jasa/stok.
4. **Produk jasa (trackStock=false):** badge "Jasa · Tanpa Stok" di list & detail; section Varian disembunyikan dengan catatan; filter baru "Tipe: Semua/Barang/Jasa".
5. **Import: checkbox "Lewati baris yang gagal" (partial) sebelum upload, default OFF** (atomic sesuai AC-05.2). Hasil import ditampilkan sebagai laporan baris-gagal dalam dialog (bukan toast) karena bisa 500 baris.
6. **Tidak ada token baru yang diajukan.** Semua warna/radius/spacing/font dipakai dari `design-tokens.ts` v2. Satuan konversi ditampilkan memakai `text-secondary` (kontras 5.8:1, bukan muted) + JetBrains Mono untuk angka. Badge stok memakai `warning`/`danger`/`success` yang sudah ada.
7. **min_qty (R5) TIDAK ditampilkan di UI Fase 2** — data-only, default 1, P1-late.

**Role:** baca = kasir+ (tanpa harga modal), tulis = manager+, delete = admin (SPEC §4). Semua tombol mutasi dibungkus `role-guard` existing.

---

## 1. Alur Layar

```
┌─────────────────┐  klik baris/kartu    ┌────────────────────────────┐
│ L1 /products    │ ───────────────────▶ │ L2 /products/[id] Detail   │
│ (list + filter) │ ◀─────────────────── │ (info · varian · satuan)   │
└─────────────────┘  tombol "← Produk"   └────────────────────────────┘
   │  ▲                                    │  │  │  │  │
   │  │  [Import Excel] ──▶ L6 Import      │  │  │  │  └─▶ Hapus Produk (admin)
   │  │      L6 ──▶ selesai ──▶ refresh    │  │  │  │      → AlertDialog → toast
   │  │  [Export Excel] ──▶ download xlsx  │  │  │  └─▶ Koreksi Stok ──▶ L7
   │  │      + toast sukses/gagal          │  │  └─▶ Edit ──▶ L3 (mode edit)
   │  │  [+ Tambah Produk] ──▶ L3          │  └─▶ Tambah Varian ──▶ L4 ──▶ refresh
   │  └─ (kasir: tanpa 3 tombol di atas,   │      edit varian: ⋯ → L4 (mode edit)
   │     tombol row ⋯ → Detail)            │      Tambah Satuan ──▶ L5 ──▶ refresh
   │  [search q] hasil mencakup nama varian│      edit satuan: ⋯ → L5 (mode edit)
   │  [barcode di search] → dibuka Fase 4  │      ⋯ → Nonaktifkan/Aktifkan (PATCH isActive)
   │                                       │      ⋯ → Koreksi Stok varian ──▶ L7
   │  L3 ──▶ Simpan ──▶ tutup + refresh list + toast
   │  L3 ──▶ Batal/Esc ──▶ tutup, tidak ada perubahan
   └───────────────────────────────────────┘

L6 Import (state machine, lihat §4):
  idle (intro + template + pilih file)
    → [Import Sekarang] → importing (indeterminate)
      → sukses penuh / partial  → hasil: "N baru · M diperbarui · K gagal" + daftar baris gagal
      → gagal total (file/header/ukuran) → InlineError di dialog, tetap di idle
      → network/server error → toast error, dialog tetap terbuka
```

**Aturan navigasi:**
- Detail dari list: seluruh baris/kartu adalah `<Link>`; aksi row (⋯) tidak menimpa navigasi (stopPropagation).
- Kembali dari detail selalu ke list (history back), tombol "← Produk" eksplisit.
- Semua form = dialog/sheet (bukan halaman terpisah) — konsisten dengan pola Fase 1 (produk existing pakai Dialog).
- Setelah mutasi berhasil: tutup dialog → refetch data aktif → toast ringkas.

---

## 2. Wireframe ASCII

### L1 — Daftar Produk, mobile 360px

```
┌────────────────────────────────┐
│ Produk                   [🌙]  │  PageHeader
│ Kelola barang, varian, satuan  │
│ [Import] [Export] [+ Tambah]   │  actions (wrap, 3 baris penuh)
├────────────────────────────────┤
│ 🔍 [Cari produk, kode…     ]   │  Input search, full width
│ [Semua Kategori ▾][Semua ▾]    │  2 Select: Status, Tipe
├────────────────────────────────┤
│ ┌────────────────────────────┐ │
│ │ Indomie Goreng 40g      ⋯  │ │  kartu = Link
│ │ MIN-001 · Makanan          │ │  ⋯ = menu aksi (kasir: hanya
│ │ Harga Jual   Rp 3.500      │ │      buka detail, tanpa menu)
│ │ Stok 128 pcs   [2 varian]  │ │  badge varian (accent-subtle)
│ │ [Stok Menipis]             │ │  badge warning
│ └────────────────────────────┘ │
│ ┌────────────────────────────┐ │
│ │ Jasa Service AC        ⋯  │ │
│ │ SRV-001 · Lainnya          │ │
│ │ Harga Jual   Rp 150.000    │ │
│ │ [Jasa · Tanpa Stok]        │ │  badge info
│ └────────────────────────────┘ │
│            … (pagination)      │
│ [← Sebelumnya] Hal 1/4 [→]     │
└────────────────────────────────┘
[ bottom-nav existing — Kasir | Produk | Transaksi | Profil ]
```

### L1 — Daftar Produk, desktop ≥1024px

```
┌──────────┬──────────────────────────────────────────────────┐
│ Sidebar  │ Produk                       🌙 [Import] [Export] │
│ existing │ Kelola barang, varian, dan satuan    [+ Tambah]  │
│          ├──────────────────────────────────────────────────┤
│          │ 🔍 [Cari produk, kode, atau barcode…         ]   │
│          │ [Semua Kategori ▾] [Semua Status ▾] [Semua ▾]   │
│          ├──────────────────────────────────────────────────┤
│          │ Produk          Kategori  Harga Jual  Stok  V … │
│          │ Indomie Goreg…  Makanan   Rp 3.500   128   2 ⋯ │
│          │ Aqua 600ml      Minuman   Rp 4.000   0     1 ⋯ │
│          │ Jasa Service AC Lainnya   Rp150.000  —     — ⋯ │
│          │           …                                     │
│          ├──────────────────────────────────────────────────┤
│          │ [← Sebelumnya]  Hal 1 dari 4   [Berikutnya →]   │
└──────────┴──────────────────────────────────────────────────┘
```
Kolom: Produk (nama + SKU mono), Kategori, Harga Jual (mono), Stok (mono + badge), Varian (jumlah + badge "jasa" utk jasa), Status (badge), aksi ⋯. `Stok` pakai `StockBadge` (Habis/Stok Menipis/Aman) + angka. Kasir: kolom Harga Modal tidak pernah ada.

### L2 — Detail Produk, mobile 360px

```
┌────────────────────────────────┐
│ ← Produk                 [⋯]   │  ⋯ = Edit/Koreksi Stok/Hapus
│ Indomie Goreng 40g    [Aktif]  │
│ Makanan · MIN-001             │
├────────────────────────────────┤
│ ┌ Info Produk ───────────────┐ │
│ │ Stok Tersedia   128 pcs    │ │  mono, xl
│ │ Stok Minimum    5 pcs      │ │
│ │ Harga Modal     Rp 2.900   │ │  manager+ (role-guard)
│ │ Harga Jual      Rp 3.500   │ │
│ │ Satuan Dasar    pcs        │ │
│ │ Kena Pajak      Tidak      │ │
│ │ Kedaluwarsa     31 Des 2026│ │
│ │ Dibuat          12 Agu 2026│ │
│ └────────────────────────────┘ │
│ ┌ Varian (2) ────────────────┐ │
│ │ [+ Tambah Varian]          │ │  hidden jika jasa
│ │ ▸ Rasa Sapi    MIN-001-A   │ │  baris = Link ke ?variant=
│ │   Rp 3.700 · stok 80  ⋯    │ │  (scroll ke varian) — atau
│ │ ▸ Rasa Cabe    MIN-001-B   │ │  langsung buka L4 edit
│ │   Rp 3.800 · stok 48  ⋯    │ │
│ └────────────────────────────┘ │
│ ┌ Satuan Tambahan ───────────┐ │
│ │ [+ Tambah Satuan]          │ │
│ │ dus   1 dus = 40 pcs       │ │  UnitConversionLabel
│ │       Rp 128.000 [Beli]    │ │  [Beli] = is_purchase_unit
│ │ renceng 1 = 10 pcs         │ │
│ │       Rp 33.000            │ │
│ └────────────────────────────┘ │
└────────────────────────────────┘
```

### L2 — Detail Produk, desktop ≥1024px

```
┌──────────┬──────────────────────────────────────────────────┐
│ Sidebar  │ ← Produk  Indomie Goreng 40g          [Aktif]    │
│ existing │ Makanan · MIN-001                               │
│          │      [Koreksi Stok] [Edit]      [Hapus] (admin) │
│          ├──────────────────────────────┬───────────────────┤
│          │ ┌ Varian (2) ──────────────┐ │ ┌ Info Produk ──┐ │
│          │ │ [+ Tambah Varian]        │ │ │ Stok   128 pcs│ │
│          │ │ Nama    Kode    Harga    │ │ │ Min    5 pcs  │ │
│          │ │ Rasa S… MIN-…A 3.700 ⋯  │ │ │ Modal  Rp2.900│ │
│          │ │ Rasa C… MIN-…B 3.800 ⋯  │ │ │ Jual   Rp3.500│ │
│          │ └──────────────────────────┘ │ │ Dasar   pcs   │ │
│          │ ┌ Satuan Tambahan ─────────┐ │ │ Pajak   Tidak │ │
│          │ │ [+ Tambah Satuan]        │ │ │ Exp     2026  │ │
│          │ │ dus  1 dus = 40 pcs      │ │ └───────────────┘ │
│          │ │      Rp 128.000 [Beli] ⋯ │ │                   │
│          │ │ renceng 1 = 10 pcs       │ │                   │
│          │ │      Rp 33.000         ⋯ │ │                   │
│          │ └──────────────────────────┘ │                   │
│          └──────────────────────────────┴───────────────────┘
└──────────┴──────────────────────────────────────────────────┘
```
Grid: `lg:grid-cols-3`; kiri `lg:col-span-2` (Varian, Satuan), kanan Info Produk. Mobile: Info → Varian → Satuan (stok dilihat dulu, aksi di bawah).

### L3 — Form Produk (dialog), mobile = bottom sheet, desktop = dialog `max-w-2xl`

```
┌─ Tambah Produk ─────────────── ✕ ┐    2 kolom dimulai sm≥640
│ Nama Produk *                    │
│ [Indomie Goreng 40g           ]  │
│ Kategori *        Satuan Dasar * │
│ [Makanan ▾]        [pcs ▾]       │
│ Kode Barang (SKU)                │
│ [MIN-001                      ]  │  helper: "Kosongkan bila belum punya"
│ Barcode                          │
│ [8991002345...                ]  │
│ Harga Modal (Rp)   Harga Jual *  │
│ [2900]             [3500]        │  inputMode=numeric
│ Stok Awal          Stok Minimum  │
│ [128]              [5]           │
│ Kena Pajak                  [─] │  Switch
│ Produk Jasa (Tanpa Stok)    [─] │  Switch → sembunyikan Stok/
│ Tanggal Kedaluwarsa              │  Varian + note inline
│ [2026-12-31                 ]   │
│ ── Varian ────────────────────── │
│ [+ Tambah Varian]                │  ghost button
│ 1. Nama * [Rasa Sapi]  ⋯ 🗑      │  row: Nama, SKU, Barcode,
│    SKU [A]  Hrg Jual* [3700]     │  Hrg Modal, Hrg Jual, Stok
│    Stok [80]                     │  (kompak; error per row)
│ ──────────────────────────────── │
│ [Batal]               [Simpan]   │  Simpan = primary, spinner
└──────────────────────────────────┘
```
Tambah Varian > 4 → scroll sheet (max-h 90dvh + ScrollArea). Row varian dihapus pakai 🗑 (icon, aria-label).

### L4 — Form Varian (dialog `max-w-md`)

```
┌─ Tambah Varian ────────── ✕ ┐
│ Nama Varian *                │
│ [Rasa Sapi Panggang       ]  │
│ Kode (SKU)      Barcode      │
│ [MIN-001-A]     [          ] │
│ Harga Modal    Harga Jual *  │
│ [3000]          [3700]       │
│ Stok Awal      Stok Minimum  │
│ [80]            [5]          │
│ Aktif                     [─]│
│ catatan (text-secondary, sm):│
│ "Varian dijual dalam satuan  │
│  dasar produk"               │
│ [Batal]           [Simpan]   │
└──────────────────────────────┘
```

### L5 — Form Satuan (dialog `max-w-md`)

```
┌─ Tambah Satuan ────────── ✕ ┐
│ Nama Satuan *                │
│ [dus ▾]  ← Select + "Lainnya"│
│   (dus, renceng, karton,     │
│    lusin, kodi, bungkus, ikat)│
│ Faktor Konversi *            │
│ [40]                         │
│ helper: "1 dus = 40 pcs"     │
│   (live, mono, text-secondary)│
│ Harga Jual per dus *         │
│ [128000]                     │
│ Bisa Dijual di Kasir      [─]│
│ Satuan Beli (pembelian)   [─]│
│ helper: "Flag untuk modul    │
│  pembelian (nanti)"          │
│ [Batal]           [Simpan]   │
└──────────────────────────────┘
```

### L6 — Dialog Import Excel (`max-w-lg`), 2 state

```
State idle:                        State hasil (setelah proses):
┌─ Import Produk dari Excel ── ✕ ┐  ┌─ Import Selesai ────────── ✕ ┐
│ Isi template lalu unggah.      │  │ ✅ 8 baru · 2 diperbarui    │
│ Produk dengan Kode Barang yang │  │    · 3 gagal                │
│ sama akan diperbarui, bukan    │  │ ──────────────────────────  │
│ dibuat baru.                   │  │ ✕ Baris 4 — SKU duplikat    │
│ [⬇ Unduh Template (.xlsx)]     │  │   dalam file                │
│ ┌───────────────────────────┐  │  │ ✕ Baris 7 — Kategori "X"    │
│ │  📄 Seret file di sini    │  │  │   tidak dikenal             │
│ │     atau [Pilih File]     │  │  │ ✕ Baris 9 — harga jual < 0  │
│ │ .xlsx · maks 2 MB ·       │  │  └───────────────────────────── │
│ │ 500 baris data            │  │  [Import Lagi]     [Selesai]    │
│ └───────────────────────────┘  │  (failed>0 & partial=false:    │
│ ☑ Lewati baris yang gagal      │   header jadi "Import Gagal"    │
│   (simpan baris valid)         │   danger-subtle, 0 baris masuk) │
│ [Batal]      [Import Sekarang] │  └──────────────────────────────┘
└────────────────────────────────┘  daftar gagal: ScrollArea max-h-64
```
File terpilih → nama file + ukuran tampil di area upload (badge). "Import Sekarang" disabled sampai file dipilih.

### L7 — Koreksi Stok (dialog `max-w-md`; extend existing)

```
┌─ Koreksi Stok ────────── ✕ ┐
│ Indomie Goreng 40g          │  atau "Varian: Rasa Sapi"
│ Stok tersedia: 128 pcs      │  mono, info-subtle box
│ Jenis Koreksi               │
│ [Pembelian Masuk ▾]         │  Pembelian Masuk / Penyesuaian
│ Jumlah                      │  input numeric, boleh minus
│ [-15]                       │
│ Catatan *                   │
│ [barang hilang saat …     ] │
│ "Catatan wajib diisi."      │  helper text-secondary
│ [Batal]   [Simpan Koreksi]  │
└─────────────────────────────┘
```
Perilaku error server: `STOCK_INSUFFICIENT` → InlineError di atas tombol: "Stok tidak cukup (tersisa 10 pcs, diminta 15 pcs)".

---

## 3. Daftar Komponen

### Pakai ulang (existing — tidak diubah)
| Komponen | Dipakai di | Catatan |
|---|---|---|
| `PageHeader` | L1 | actions = 3 tombol |
| `Input`, `Label`, `Select`, `Switch`, `Checkbox` | L3–L7 | |
| `Dialog`, `AlertDialog`, `Sheet` | L3–L7 | Sheet utk form produk mobile; Dialog sisanya |
| `Table` (`.table-dense`) | L1 desktop, L2 | overflow-x-auto utk mobile fallback |
| `Badge` | L1, L2 | variant/status/jasa/beli |
| `Card` | L2 | section cards |
| `Skeleton` (+ kelas `.skeleton` shimmer) | semua loading | |
| `EmptyState`, `ErrorState`, `InlineError` | L1, L2, L6 | copy baru di §5 |
| `PaginationControl` | L1 | |
| `ConfirmDialog` | delete | |
| `role-guard` | L1–L7 | sembunyikan aksi mutasi utk kasir |
| `TooltipHelp` | L3 (Track Stok), L5 (Satuan Beli) | helper on-demand |
| `api` client, `formatIDR`, `formatNumber`, `cn`, `debounce` | semua | |

### Baru (dibuat Fase 2) + alasan
| Komponen | Dipakai di | Alasan |
|---|---|---|
| `VariantFormRows` | L3 (inline) | AC-01.1: create produk+varian 1 POST. Set field tunggal = sumber kebenaran; L4 memakai blok field yang sama via komposisi, bukan duplikasi. |
| `VariantFormDialog` | L2 | AC-02.1: PATCH varian standalone. Membungkus field varian + error server (DUPLICATE_VARIANT_SKU dsb) per field. |
| `UnitFormDialog` | L2 | Form satuan unik Fase 2 (factor/sellPrice/isSellable/isPurchaseUnit); punya helper live "1 dus = 40 pcs". |
| `UnitConversionLabel` | L2 (+ struk Fase 4) | Format "1 dus = 40 pcs" muncul di banyak permukaan; satu format (mono, text-secondary). |
| `StockBadge` | L1, L2 | Semantik stok konsisten: `Habis` (danger) / `Stok Menipis` (warning, ≤ min_stock) / `Aman` (success) / `Jasa · Tanpa Stok` (info). Produk jasa tidak pernah dihitung menipis (aturan REP-03). |
| `ImportDialog` | L1 | State machine 3 fase (idle/importing/hasil) + laporan baris gagal (≤500 baris) — terlalu besar utk toast; komponen tersendiri. |

### Token baru
**Tidak ada yang diajukan.** Alasan: semua kebutuhan (warning stok, badge info jasa, accent varian, danger hapus, surface cards) sudah terwakili token existing. Bila developer menemukan kebutuhan warna di luar token → ajukan ke UI/UX dulu, jangan hardcode.

---

## 4. Spesifikasi 4 State per Layar

### L1 — Daftar Produk
| State | Spesifikasi |
|---|---|
| **Loading** | 6 baris skeleton tabel (desktop) / 4 kartu skeleton (mobile, h-28). Header & filter tampil normal (bukan skeleton) — filter hanya disabled. |
| **Kosong** | `EmptyState`: "Belum ada produk" / "Tambahkan produk pertamamu untuk mulai berjualan." + CTA "Tambah Produk" (manager+). Kasir: tanpa CTA, desc "Hubungi pengelola untuk menambah produk." **Varian pencarian kosong** (q ≠ ""): "Produk tidak ditemukan" / "Coba kata kunci, kode, atau barcode lain." — tombol "Hapus Pencarian". |
| **Error** | `ErrorState` full: "Gagal memuat produk" / "Cek koneksi internetmu, lalu coba lagi." + tombol "Coba Lagi" (refetch). |
| **Isi** | Tabel/kartu + badge stok/varian/jasa + pagination. Row count "Menampilkan 1–20 dari 72 produk" (text-xs muted, opsional). |

### L2 — Detail Produk
| State | Spesifikasi |
|---|---|
| **Loading** | Header skeleton (judul h-6 w-48) + 2 blok kartu skeleton (masing-masing 3 baris). |
| **Kosong / 404** | `ErrorState` khusus: "Produk tidak ditemukan" / "Produk mungkin sudah dihapus atau tautan salah." + tombol "Kembali ke Produk" (outline, navigasi `/products`). |
| **Error** | `ErrorState` + "Coba Lagi" (refetch). |
| **Isi** | Selalu content. **Substate kosong per section:** Varian kosong → EmptyState kecil (icon Tags) "Belum ada varian" / "Tambah ukuran, rasa, atau warna untuk produk ini." + CTA "Tambah Varian". Satuan kosong → "Belum ada satuan tambahan" / "Tambahkan dus, renceng, atau lusin agar kasir bisa menjual satuan besar." + CTA. Produk jasa → section Varian diganti baris info "Produk jasa tidak dapat memiliki varian." |

### L3/L4/L5 — Form (Produk / Varian / Satuan)
| State | Spesifikasi |
|---|---|
| **Loading (edit)** | Saat buka mode edit: 4 baris skeleton field; tombol aksi disabled sampai data termuat. |
| **Kosong** | Tidak berlaku (form). Varian rows kosong = section "Belum ada varian" inline + tombol "+ Tambah Varian". |
| **Error (validasi)** | Per field: border `danger` + teks error sm di bawah field (aria-describedby). Error server 409/422 dipetakan ke field (§5). Error umum → InlineError di atas tombol Simpan. |
| **Isi / Saving** | Tombol "Simpan" → spinner `Loader2` + label "Menyimpan…", semua input disabled (anti double-submit). Sukses → tutup + toast + refetch. |

### L6 — Import Excel
| State | Spesifikasi |
|---|---|
| **Loading (importing)** | Tombol "Import Sekarang" → spinner + "Mengimpor…", disabled; area upload di-mute; progress bar indeterminate (animated). |
| **Kosong** | Tidak berlaku (dialog selalu punya konten intro). File belum dipilih = tombol primary disabled. |
| **Error** | (a) `IMPORT_TOO_LARGE` / `IMPORT_EMPTY` / `IMPORT_INVALID_HEADER` → `InlineError` di dalam dialog (tetap di state idle, file boleh diganti). (b) `IMPORT_VALIDATION_FAILED` (atomic) → state hasil dengan header danger "Import Gagal" + daftar baris error + "0 baris tersimpan". (c) network → toast "Gagal mengimpor. Coba lagi." |
| **Isi (hasil)** | Header: icon success/warning + "8 baru · 2 diperbarui · 0 gagal". Daftar gagal (ScrollArea max-h-64, baris: nomor baris + pesan). Tombol "Import Lagi" (reset ke idle, file di-clear) & "Selesai" (tutup + refetch list). |

### L7 — Koreksi Stok
| State | Spesifikasi |
|---|---|
| **Loading** | Tidak perlu (data stok sudah ada dari detail). |
| **Kosong** | Tidak berlaku. |
| **Error** | `STOCK_INSUFFICIENT` → InlineError "Stok tidak cukup (tersisa X pcs, diminta Y pcs)". Validasi lokal: Jumlah wajib ≠ 0, Catatan wajib. |
| **Isi / Saving** | Spinner "Menyimpan…" → sukses: toast "Stok dikoreksi" + refresh angka stok (list & detail). |

---

## 5. Naskah Lengkap (copywriting)

### Judul & deskripsi
- L1: **"Produk"** — "Kelola barang, varian, dan satuan."
- L2: nama produk; subjudul "`{Kategori} · {SKU}`" (SKU mono). Header section: **"Varian"**, **"Satuan Tambahan"**, **"Info Produk"**.
- L3: **"Tambah Produk"** / **"Edit Produk"** (dari nama produk).
- L4: **"Tambah Varian"** / **"Edit Varian"**.
- L5: **"Tambah Satuan"** / **"Edit Satuan"**.
- L6: **"Import Produk dari Excel"** / hasil: **"Import Selesai"** atau **"Import Gagal"** (atomic).
- L7: **"Koreksi Stok"** (+ varian: "Koreksi Stok — Varian {nama}").

### Label field + placeholder + helper
| Field | Label | Placeholder / Helper |
|---|---|---|
| produk | Nama Produk * | "cth. Indomie Goreng 40g" |
| produk | Kategori * | Select; helper: "Import tidak membuat kategori baru" (di L6) |
| produk | Kode Barang (SKU) | helper: "Kosongkan bila belum punya kode. Unik, dipakai import." |
| produk | Barcode | helper: "Isi bila barang punya barcode." |
| produk | Satuan Dasar * | Select pcs/pack/box/kg/gram/liter/meter; helper: "Stok dihitung dalam satuan ini." |
| produk | Harga Modal (Rp) | helper: "Harga beli per satuan dasar. Hanya terlihat manager." |
| produk | Harga Jual (Rp) * | helper: "Harga jual per satuan dasar." |
| produk | Stok Awal | helper: "Stok awal (satuan dasar). Ubah stok nanti lewat Koreksi Stok." |
| produk | Stok Minimum | default 5 |
| produk | Kena Pajak | Switch |
| produk | Produk Jasa (Tanpa Stok) | Switch; helper: "Nyalakan untuk jasa (service). Stok tidak dicek saat transaksi." |
| produk | Tanggal Kedaluwarsa | input date; helper: "Opsional. Informasi saja." |
| varian | Nama Varian * | "cth. Rasa Sapi Panggang, Ukuran 600ml, Warna Hitam" |
| varian | Kode (SKU) / Barcode | helper: "Unik di seluruh katalog." |
| varian | — | catatan tetap: "Varian dijual dalam satuan dasar produk." |
| satuan | Nama Satuan * | Select umum + "Lainnya…"; helper: "Tidak boleh sama dengan satuan dasar." |
| satuan | Faktor Konversi * | helper live (mono): "1 dus = 40 pcs" |
| satuan | Harga Jual per {satuan} * | — |
| satuan | Bisa Dijual di Kasir | Switch; helper: "Matikan bila satuan ini hanya untuk pembelian." |
| satuan | Satuan Beli | Switch; helper: "Flag untuk modul pembelian (nanti)." |
| stok | Jenis Koreksi | Select: "Pembelian Masuk" / "Penyesuaian" |
| stok | Jumlah | input numeric, boleh negatif |
| stok | Catatan * | placeholder: "cth. barang hilang, rusak, selisih hitung"; helper: "Catatan wajib diisi dan tercatat di riwayat." |

### Tombol
"Tambah Produk" · "Import Excel" · "Export Excel" · "Tambah Varian" · "Tambah Satuan" · "Koreksi Stok" · "Edit" · "Hapus" · "Simpan" · "Menyimpan…" · "Batal" · "Unduh Template (.xlsx)" · "Pilih File" · "Import Sekarang" · "Mengimpor…" · "Import Lagi" · "Selesai" · "Coba Lagi" · "Simpan Koreksi" · "Nonaktifkan" / "Aktifkan" (menu ⋯) · "Kembali ke Produk" · "Hapus Pencarian".

### Dialog konfirmasi (ConfirmDialog)
- **Hapus Produk** — judul: "Hapus Produk?"; isi: "Produk '{nama}' akan dinonaktifkan dan tidak muncul di pencarian. Riwayat transaksi tetap tersimpan."; tombol: "Hapus" (danger) / "Batal". (admin only)
- **Hapus Varian** — "Hapus Varian?" / "Varian '{nama}' akan dinonaktifkan. Riwayat transaksi tetap tersimpan."
- **Hapus Satuan** — "Hapus Satuan?" / "Satuan '{unit}' akan dihapus permanen. Transaksi lama tetap memakai snapshot satuan." (satuan tidak punya soft delete)
- **Nonaktifkan Varian** — "Nonaktifkan Varian?" / "Varian ini tidak muncul di pencarian kasir. Stok tetap tersimpan."

### Pesan error (API code → UI)
| Kode API | Pesan UI |
|---|---|
| `DUPLICATE_VARIANT_SKU` | "Kode Barang (SKU) sudah dipakai produk atau varian lain." |
| `DUPLICATE_VARIANT_BARCODE` | "Barcode sudah dipakai produk atau varian lain." |
| `DUPLICATE_UNIT` | "Satuan ini sudah terdaftar, atau sama dengan satuan dasar." |
| `INVALID_FACTOR` | "Faktor harus lebih besar dari 0." |
| `PARENT_NO_STOCK_TRACKING` | "Produk jasa tidak dapat memiliki varian." |
| `UNIT_NOT_FOUND` / `UNIT_NOT_SELLABLE` | (Fase 4 kasir; Fase 2 tidak muncul di UI) |
| `STOCK_INSUFFICIENT` | "Stok tidak cukup (tersisa {available} {unit}, diminta {requested} {unit})." |
| `IMPORT_EMPTY` | "File kosong atau tidak berisi sheet 'Produk'." |
| `IMPORT_TOO_LARGE` | "File terlalu besar. Maksimal 2 MB dan 500 baris data." |
| `IMPORT_INVALID_HEADER` | "Header kolom tidak cocok dengan template. Unduh template terbaru." |
| `IMPORT_VALIDATION_FAILED` | "Ada {n} baris error. Tidak ada data yang tersimpan." (atomic) / "Berhasil menyimpan {n} baris valid, {m} baris dilewati." (partial) |
| 403 `FORBIDDEN` | "Kamu tidak punya izin untuk aksi ini." |
| network | "Gagal terhubung ke server. Coba lagi." |

### Toast (sonner, ringkas)
"Produk disimpan" · "Varian disimpan" · "Satuan disimpan" · "Stok dikoreksi" · "Produk dihapus" · "Varian dinonaktifkan" · "Export selesai — {filename}" · "Import selesai: 8 baru · 2 diperbarui · 3 gagal" · "Gagal menyimpan. Coba lagi."

### Empty states (lengkap)
1. List: "Belum ada produk" / "Tambahkan produk pertamamu untuk mulai berjualan." — CTA "Tambah Produk".
2. Search: "Produk tidak ditemukan" / "Coba kata kunci, kode, atau barcode lain."
3. Varian section: "Belum ada varian" / "Tambah ukuran, rasa, atau warna untuk produk ini." — CTA "Tambah Varian".
4. Satuan section: "Belum ada satuan tambahan" / "Tambahkan dus, renceng, atau lusin agar kasir bisa menjual satuan besar." — CTA "Tambah Satuan".
5. Import hasil atomic gagal total: "Tidak ada baris yang tersimpan" / "Perbaiki {n} baris error di file, lalu coba lagi."
6. Detail 404: "Produk tidak ditemukan" / "Produk mungkin sudah dihapus atau tautan salah." — "Kembali ke Produk".

---

## 6. Aksesibilitas

**Urutan fokus (L1):** skip langsung ke konten (AppShell) → input pencarian → filter Kategori → Status → Tipe → baris tabel/kartu (tab per baris; baris = Link) → pagination → aksi header (Import/Export/Tambah). Urutan DOM = urutan visual; tidak ada tabindex manual.
**L2:** kembali (← Produk) → aksi header → section Varian (tabel: row = Link/focusable) → section Satuan → Info (read-only, bukan fokus).

**Dialog/sheet (L3–L7):**
- Focus trap Radix existing; fokus awal = field pertama (L3: Nama Produk; L4: Nama Varian; L5: Nama Satuan; L7: Jenis Koreksi).
- Esc menutup; fokus kembali ke trigger. Sheet mobile: overlay dapat diketuk tutup (kecuali state importing — overlay non-interaktif).
- Setiap input punya `<Label htmlFor>`; helper `aria-describedby="field-helper"`; error `aria-describedby="field-error"` + `role="alert"` pada InlineError form.

**Semantik & live regions:**
- Toast region: `aria-live="polite"` (sonner default).
- Hasil import: `role="status"` ringkasan "8 baru · 2 diperbarui · 3 gagal" — dibacakan sekali, daftar gagal `role="list"` biasa.
- Badge stok TIDAK warna saja: selalu teks ("Habis", "Stok Menipis") + optional dot. Ikon dekoratif `aria-hidden`.
- ⋯ menu: `aria-label="Aksi {nama produk}"`; tombol ikon 🗑: `aria-label="Hapus varian {nama}"`.

**Kontras:**
- Helper/catatan: `text-secondary` (#5F6B7A = 5.8:1) — **jangan** `text-muted` (3.6:1, hanya utk placeholder & timestamp).
- Badge: teks badge memakai warna fg token (mis. warning dark mode fg hitam) — ikuti token, jangan override.
- Focus ring: `ring-accent` (existing `outline-ring/50`), ketebalan 2px, tidak dihapus.

**Target sentuh:** semua kontrol ≥48px di mobile (`density.touchMin`). Baris tabel desktop boleh 40px (`tableRowCompact`); kartu mobile min 72px tinggi konten. Tombol ikon dalam baris: `size-10` minimum, gap antar ikon ≥8px.

**Keyboard:** baris produk = Link (Enter native). Menu ⋯ = button (Enter/Space + Arrow navigation dropdown existing). Delete selalu via AlertDialog (tidak pernah hapus sekali klik).

**Reduced motion:** `prefers-reduced-motion: reduce` → shimmer mati (fallback pulse existing), micro-interactions §8 di-skip (transform/scale dihapus).

---

## 7. Perilaku Responsif

| Breakpoint | Perubahan |
|---|---|
| **< 640px (mobile)** | List: kartu 1 kolom (bukan tabel). Header actions wrap 3 baris penuh. Form produk: bottom sheet (Sheet, max-h 90dvh, radius lg atas), semua field 1 kolom. Dialog lain: tetap Dialog terpusat (max-w-md) — cukup ringkas utk 360px. Detail: stack Info → Varian → Satuan. Filter: 2 Select bertumpuk. |
| **≥ 640px (sm)** | Form produk: field berpasangan 2 kolom (Kategori+Satuan Dasar, Harga Modal+Harga Jual, dst). Header actions satu baris. |
| **≥ 768px (md)** | Sidebar muncul (existing AppShell) → konten bergeser. List: beralih ke tabel (`.table-dense`, overflow-x-auto utk layar sempit menengah). Bottom-nav hilang. |
| **≥ 1024px (lg)** | Detail: grid 3 kolom (kiri col-span-2 = Varian + Satuan, kanan = Info). Form produk: dialog terpusat `max-w-2xl` (bukan sheet). Import: `max-w-lg`. |
| **Dark mode** | Hanya token (sudah ditangani). Badge/warning kontras tetap sesuai token dark. |
| **Print** | Tidak ada kebutuhan print Fase 2 (struk = Fase 4). Tidak ditangani. |

Aturan umum: konten tidak pernah melebihi `max-w-6xl` di dalam area konten; padding konten `p-4 sm:p-6 lg:p-8`; tabel mobile TIDAK diizinkan untuk list produk (kartu wajib), tabel hanya di ≥md.

---

## 8. Micro-interaction

| Interaksi | Detail | Alasan |
|---|---|---|
| Skeleton shimmer | `.skeleton` existing (translateX, GPU) | Persepsi kecepatan; konsisten Fase 1. |
| Spinner tombol simpan/import | `Loader2` animate-spin + label berubah | Anti double-submit + umpan balik kerja (import bisa >2s utk 500 baris). |
| Progress import (indeterminate) | bar tipis accent dengan animasi geser | Tugas panjang sinkron; memberi sinyal "sedang bekerja", bukan dead UI. |
| Sheet mobile slide-up | shadcn Sheet default (translateY) | Pola bottom-sheet mobile yang familiar (keranjang Fase 1). |
| Row hover (desktop) | `hover:bg-muted/50` pada baris tabel & kartu | Affordance keterklikan; tanpa translateY (hindari efek berlebihan). |
| Press feedback (mobile) | `active:scale-[0.99]` pada kartu produk | Umpan balik sentuh instan; di-skip saat reduced motion. |
| Focus ring accent | `outline-ring/50` 2px | Navigasi keyboard jelas; tidak dihapus. |
| Toast masuk/keluar | sonner default (slide + fade 200ms) | Umpan balik mutasi tanpa pindah halaman. |
| Helper live konversi | "1 dus = 40 pcs" update saat ketik faktor (150ms debounce) | Pencegahan error konversi sejak input — faktor 0/negatif langsung terlihat. |
| Badge stok berubah | setelah koreksi stok sukses, badge & angka refresh tanpa flash (refetch, `transition-smooth` pada angka) | Data truth dari server; hindari animasi angka berlebihan (tabular-nums mencegah layout shift). |

**Sengaja TIDAK ada:** animasi angka count-up, konfeti import, haptic — Fase 2 adalah layar kerja manajerial; gerakan berlebih mengurangi kecepatan scanning data.

---

## Lampiran A — Check konsistensi desain system
- Palette: 100% token existing (`accent #0066FF` / dark `#4D94FF`, surface, text, semantic). ✅
- Radius: input/badge sm 8px · card md 12px · dialog/sheet lg 16px. ✅
- Font: Inter body, JetBrains Mono untuk SKU/barcode/angka uang/stok/faktor (`tabular-nums`). ✅
- Touch target min 48px. ✅
- Terminologi: label Bahasa Indonesia sesuai `termMapping` (Harga Modal ≠ COGS, Koreksi Stok, Stok Tersedia, Kode Barang). SKU ditulis "Kode Barang (SKU)" di label, "SKU" di daftar — konsisten dengan existing.
- Tidak ada bahasa visual kedua: tidak ada gradien baru, shadow baru, atau warna di luar token (logo & avatar existing dikecualikan).
