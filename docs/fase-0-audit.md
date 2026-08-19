# FASE 0 — RENCANA: FakhriPOS

## AUDIT: Apa yang Sudah Ada vs Yang Dibutuhkan

### Sudah Ada (Backend - Bun + Elysia + Drizzle)
| Modul | Status | Catatan |
|-------|--------|---------|
| Auth (Users, Sessions) | ✅ | JWT + refresh token |
| Categories | ✅ | 1 level, soft delete |
| Products | ✅ | SKU, barcode, stock, cost/selling price |
| Customers | ✅ | Basic CRUD |
| Memberships | ✅ | Points system |
| Discounts | ✅ | Percentage/fixed, global/category/product |
| Transactions | ✅ | Full flow: items, payments, status |
| Returns | ✅ | Refund with stock restoration |
| Stock Movements | ✅ | Ledger pattern |
| Audit Logs | ✅ | Append-only |
| Settings | ✅ | Key-value store |
| Reports | ✅ | Dashboard + sales reports |

### Sudah Ada (Frontend - Next.js + Tailwind + shadcn)
| Halaman | Status | Catatan |
|---------|--------|---------|
| Login | ✅ | |
| Dashboard | ✅ | Stats + chart |
| Products | ✅ | CRUD + table |
| Categories | ✅ | CRUD |
| Transactions | ✅ | List + detail |
| Customers | ✅ | CRUD + detail |
| Discounts | ✅ | CRUD |
| Reports | ✅ | Basic |
| Settings | ✅ | Basic |
| Users | ✅ | CRUD |
| Profile | ✅ | |
| POS (Kasir) | ✅ | Basic checkout flow |
| Warehouses | ✅ | List + detail + stocks |

### Yang BELUM Ada (per spec baru)
| Fitur | Prioritas | Keterangan |
|-------|-----------|------------|
| **Mobile bottom nav** | MVP | Specs: 5 item (Kasir, Produk, Laporan, Stok, Lainnya) |
| **Kasir optimasi mobile** | MVP | Grid 2 kolom, bottom sheet keranjang, thumb zone |
| **Split payment** | MVP | Satu transaksi, 2+ metode bayar |
| **Hold/parkir transaksi** | MVP | Temporary save, lanjutkan nanti |
| **Retur dengan alasan** | MVP | Alasan wajib dari daftar pilihan |
| **Produk varian** | MVP | Ukuran/warna/rasa, harga & stok terpisah |
| **Konversi satuan** | MVP | Beli dus, jual pcs |
| **Import/Export Excel** | MVP | Template + validasi baris |
| **Transfer stok antar gudang** | MVP | Status: dikirim → diterima |
| **Koreksi stok dengan alasan** | MVP | Daftar pilihan (rusak, hilang, dll) |
| **Kartu stok / mutasi** | MVP | Read-only log |
| **Peringatan stok menipis** | MVP | + halaman "Barang Harus Dibeli" |
| **Shift management** | MVP | Buka/tutup shift, modal awal, selisih |
| **Kas masuk/keluar manual** | MVP | Di luar penjualan |
| **Laba rugi sederhana** | MVP | Penjualan - Modal - Pengeluaran |
| **Export Excel/PDF** | MVP | Semua laporan |
| **PWA + Offline** | MVP | Transaksi lokal, sinkron otomatis |
| **Onboarding wizard** | MVP | 6 langkah setup awal |
| **Mode latihan** | MVP | Data dummy, banner oranye |
| **Glosarium** | MVP | 30+ istilah |
| **Tooltip inline** | MVP | "?" popover di istilah |
| **Skeleton loading** | MVP | Per tema, 4 state wajib |
| **Bahasa manusia** | MVP | "Kode Barang" bukan SKU |
| **48px touch target** | MVP | Semua elemen interaktif |
