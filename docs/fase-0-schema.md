# SKEMA DATABASE & FITUR

## Skema Database (Yang Perlu Ditambah)

### Tabel Baru yang Dibutuhkan
```
1. warehouses          — CRUD gudang (sudah ada di frontend, belum di DB)
2. warehouse_stocks    — stok per gudang per produk
3. stock_transfers     — transfer antar gudang
4. stock_adjustments   — koreksi stok manual
5. product_variants    — varian produk (ukuran/warna/rasa)
6. unit_conversions    — konversi satuan (dus→pcs)
7. shifts              —管理 shift kasir
8. shift_summaries     — rekap akhir shift
9. cash_flows          — kas masuk/keluar manual
10. hold_transactions  — transaksi ditahan/diparkir
11. split_payments     — pembayaran split
12. pending_syncs      — antrian sinkron offline
```

### Tabel yang Sudah Ada (Perlu Update)
- `products` — tambah `hasVariants`, `unitGroupId`
- `transactions` — tambah `shiftId`, `holdId`
- `payments` — tambah `splitGroupId`

## STRUKTUR FOLDER (Target Akhir)

```
apps/web/src/
├── app/
│   ├── (app)/
│   │   ├── pos/page.tsx              ← KASIR (optimasi mobile)
│   │   ├── dashboard/page.tsx
│   │   ├── products/
│   │   │   ├── page.tsx              ← List
│   │   │   ├── [id]/page.tsx         ← Detail/edit
│   │   │   ├── new/page.tsx          ← Tambah
│   │   │   └── import/page.tsx       ← Import Excel
│   │   ├── categories/page.tsx
│   │   ├── warehouses/
│   │   │   ├── page.tsx              ← List gudang
│   │   │   ├── [id]/page.tsx         ← Detail + stok
│   │   │   ├── transfers/page.tsx    ← Transfer stok
│   │   │   └── adjustments/page.tsx  ← Koreksi stok
│   │   ├── transactions/
│   │   │   ├── page.tsx              ← List
│   │   │   └── [id]/page.tsx         ← Detail + retur
│   │   ├── customers/page.tsx
│   │   ├── reports/
│   │   │   ├── page.tsx              ← Ringkasan
│   │   │   ├── sales/page.tsx
│   │   │   ├── products/page.tsx
│   │   │   └── financial/page.tsx    ← Laba rugi
│   │   ├── shifts/
│   │   │   ├── page.tsx              ← Status shift
│   │   │   ├── [id]/page.tsx         ← Detail shift
│   │   │   └── history/page.tsx      ← Riwayat
│   │   ├── cash-flow/page.tsx        ← Kas masuk/keluar
│   │   ├── discounts/page.tsx
│   │   ├── users/page.tsx
│   │   ├── settings/
│   │   │   ├── page.tsx
│   │   │   ├── receipt/page.tsx      ← Format struk
│   │   │   └── features/page.tsx     ← Aktif/nonaktif modul
│   │   └── glossary/page.tsx         ← Kamus istilah
│   ├── (auth)/
│   │   └── login/page.tsx
│   └── layout.tsx
├── components/
│   ├── ui/                           ← shadcn (existing)
│   ├── pos/                          ← Komponen kasir
│   │   ├── product-grid.tsx
│   │   ├── cart-sheet.tsx
│   │   ├── payment-dialog.tsx
│   │   └── quick-amount-buttons.tsx
│   ├── products/
│   │   ├── variant-form.tsx
│   │   └── unit-conversion-form.tsx
│   ├── warehouses/
│   │   ├── transfer-form.tsx
│   │   └── adjustment-form.tsx
│   ├── shifts/
│   │   ├── open-shift-dialog.tsx
│   │   └── close-shift-dialog.tsx
│   ├── layout/
│   │   ├── bottom-nav.tsx            ← Mobile nav
│   │   ├── sidebar.tsx               ← Desktop nav
│   │   └── header.tsx
│   ├── shared/
│   │   ├── skeleton-*.tsx            ← Skeleton per konten
│   │   ├── empty-state.tsx
│   │   ├── error-state.tsx
│   │   ├── tooltip-help.tsx          ← "?" popover
│   │   └── confirmation-dialog.tsx   ← P5: aksi merusak
│   └── onboarding/
│       └── wizard.tsx
├── data/
│   ├── products.ts                   ← Dummy 60-80 item
│   ├── warehouses.ts                 ← Dummy 4 gudang
│   ├── customers.ts                  ← Dummy 25 + 5 kasbon
│   ├── transactions.ts              ← Dummy 300+ transaksi
│   ├── shifts.ts                     ← Dummy 4 karyawan + shift
│   └── glossary.ts                   ← 30+ istilah
├── lib/
│   ├── design-tokens.ts
│   ├── types.ts
│   ├── utils.ts
│   ├── api.ts
│   └── offline-storage.ts           ← IndexedDB wrapper
└── hooks/
    ├── use-settings.ts
    ├── use-offline.ts
    └── use-shift.ts
```

## FITUR MVP FINAL (Urutan Pengerjaan)

### Fase 1: Fondasi (Est: 2-3 hari)
1. ✅ Design tokens (sudah ada, update sesuai spec baru)
2. ✅ Dark/Light mode (sudah ada)
3. 🔧 Bottom nav mobile + sidebar desktop (update)
4. 🔧 Skeleton loading system
5. 🔧 Empty/Error state component
6. 🔧 Confirmation dialog (P5)
7. 🔧 Tooltip "?" component
8. 🔧 Bahasa manusia - rename semua istilah

### Fase 2: Data & Produk (Est: 2-3 hari)
1. 🔧 DB schema update (warehouses, variants, conversions)
2. 🔧 Seed script 60-80 produk + 300 transaksi
3. 🔧 CRUD produk dengan varian
4. 🔧 Konversi satuan
5. 🔧 Import/Export Excel

### Fase 3: Stok & Gudang (Est: 2 hari)
1. 🔧 CRUD gudang (DB + API)
2. 🔧 Stok per gudang
3. 🔧 Transfer stok
4. 🔧 Koreksi stok dengan alasan
5. 🔧 Kartu stok / mutasi

### Fase 4: Kasir (Est: 3-4 hari)
1. 🔧 Mobile-optimized POS
2. 🔧 Keranjang bottom sheet
3. 🔧 Split payment
4. 🔧 Hold/parkir transaksi
5. 🔧 Struk (thermal + WhatsApp + QR)
6. 🔧 Shift management

### Fase 5: Laporan (Est: 1-2 hari)
1. 🔧 Dashboard update
2. 🔧 Laba rugi sederhana
3. 🔧 Kas masuk/keluar
4. 🔧 Export Excel/PDF

### Fase 6: Rich Content (Est: 2 hari)
1. 🔧 Onboarding wizard
2. 🔧 Glosarium
3. 🔧 Mode latihan
4. 🔧 Pengantar modul

### Fase 7: Offline & PWA (Est: 2 hari)
1. 🔧 Service worker
2. 🔧 IndexedDB untuk transaksi
3. 🔧 Sinkron otomatis
4. 🔧 Indikator status offline

**Total Estimasi: 14-18 hari**
