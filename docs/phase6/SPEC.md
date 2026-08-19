# SPEC — Fase 6: Rich Content

## 1. Lingkup — masuk apa, TIDAK masuk apa

### 1.1 MASUK (Fase 6: Rich Content)
| ID | Fitur | Prioritas |
|----|-------|-----------|
| RC-01 | Pengantar tiap modul (onboarding screen per halaman) | MVP |
| RC-02 | Tur interaktif pertama kali (onboarding wizard 6 langkah) | MVP |
| RC-03 | Mode Latihan (data dummy, no-save mode) | MVP |
| RC-04 | Expand glosarium dari 34 ke 50+ istilah | MVP |
| RC-05 | Tooltip inline ? untuk istilah di seluruh form/table | MVP |
| RC-06 | Empty state yang mengajarkan langkah berikutnya | MVP |

### 1.2 TIDAK MASUK
- Video tutorial
- Chat support / live agent
- Gamifikasi (achievement, badge)
- Multi-bahasa (hanya Indonesia)

## 2. User Story + Kriteria Penerimaan

### US-01: Pengantar Modul
**Sebagai** pemilik toko yang baru pertama kali pakai FakhriPOS,
**Saya ingin** melihat penjelasan sederhana saat saya membuka modul baru,
**Agar saya tahu** apa yang harus saya lakukan dan kenapa itu penting.

**Given** pengguna membuka modul untuk pertama kali,
**When** halaman modul dimuat,
**Then** tampilkan layar pengantar dengan: apa ini, kenapa penting, cara pakai (3-5 langkah), contoh nyata, kesalahan umum.

**Given** pengguna menutup pengantar,
**When** pengguna membuka modul yang sama lagi,
**Then** pengantar tidak ditampilkan lagi (tapi bisa diakses dari ikon "?").

### US-02: Onboarding Wizard
**Sebagai** pemilik usaha,
**Saya ingin** mengisi data usaha saya saat pertama kali buka aplikasi,
**Agar** modul yang tidak relevan disembunyikan otomatis.

**Given** pengguna membuka aplikasi untuk pertama kali,
**When** tidak ada data usaha di localStorage,
**Then** tampilkan wizard 6 langkah: nama usaha, jenis usaha (gambar), berapa outlet, jual barang/jasa/j两者, pakai stok atau tidak (tampilkan hanya untuk barang), ada karyawan atau tidak.

**When** wizard selesai,
**Then** simpan ke localStorage: `{ businessName, businessType, outlets, sellsProduct, sellsService, trackStock, hasStaff }`.

**When** wizard selesai,
**Then** sembunyikan modul yang tidak relevan: laundry/barbershop tidak perlu lihat "Nomor Seri Barang".

**When** pengguna sudah punya data di localStorage,
**Then** wizard tidak ditampilkan lagi. Bisa di-reset dari Pengaturan.

### US-03: Mode Latihan
**Sebagai** pemilik toko yang ingin melatih kasir baru,
**Saya ingin** toggle "Mode Latihan" yang membuat transaksi tidak tersimpan ke data asli,
**Agar** saya bisa melatih karyawan tanpa mengotori laporan.

**Given** pengguna mengaktifkan Mode Latihan,
**When** transaksi dilakukan,
**Then** tampilkan banner oranye jelas di atas layar "Mode Latihan — Data tidak disimpan ke database".

**When** Mode Latihan aktif,
**Then** semua transaksi hanya di localStorage, tidak mengubah data di server.

**When** pengguna menonaktifkan Mode Latihan,
**Then** data latihan dihapus dari localStorage.

### US-04: Glosarium Expanded
**Sebagai** pemilik usaha,
**Saya ingin** kamus istilah yang lengkap,
**Agar** saya bisa memahami semua istilah dalam aplikasi.

**Given** pengguna membuka halaman Glosarium,
**When** daftar ditampilkan,
**Then** minimal 50 istilah dengan: istilah, arti sehari-hari, contoh angka, tautan ke modul terkait.

**When** pengguna mencari,
**Then** pencarian bekerja berdasarkan istilah dan arti.

### US-05: Tooltip Inline
**Sebagai** pemilik usaha,
**Saya ingin** ikon "?" kecil di sebelah istilah yang tidak saya pahami,
**Agar** saya bisa langsung memahami tanpa harus ke halaman terpisah.

**Given** ada kolom form atau label yang menggunakan istilah teknis,
**When** pengguna hover/klik ikon "?",
**Then** tampilkan popover 1-2 kalimat + contoh angka.

### US-06: Empty State yang Mengajarkan
**Sebagai** pemilik usaha,
**Saya ingin** ketika saya membuka halaman kosong, saya langsung tahu apa yang harus dilakukan,
**Agar** saya tidak bingung.

**Given** halaman tidak ada data,
**When** empty state ditampilkan,
**Then** tampilkan: ilustrasi + kalimat penjelasan + 1 tombol aksi.

**Contoh:** "Belum ada produk. Tambah produk pertamamu supaya bisa mulai jualan." + tombol "Tambah Produk".

## 3. Model Data

### Settings baru (di tabel `settings` existing)
| Key | Tipe | Default | Deskripsi |
|-----|------|---------|-----------|
| `onboarding.completed` | boolean | false | Wizard sudah selesai |
| `onboarding.businessName` | string | "" | Nama usaha |
| `onboarding.businessType` | string | "" | Jenis usaha |
| `onboarding.outlets` | number | 1 | Jumlah outlet |
| `onboarding.sellsProduct` | boolean | true | Jual barang |
| `onboarding.sellsService` | boolean | false | Jual jasa |
| `onboarding.trackStock` | boolean | true | Pakai stok |
| `onboarding.hasStaff` | boolean | false | Ada karyawan |
| `practice_mode` | boolean | false | Mode latihan aktif |
| `modules_intros_seen` | string[] | [] | Daftar modul yang sudah dilihat pengantarnya |

**Catatan:** Onboarding & practice mode disimpan di localStorage (client-side), bukan di server. Settings di atas hanya untuk referensi.

### Tabel baru: None
Semua data Phase 6 client-side (localStorage).

## 4. Kontrak API

Tidak ada endpoint baru. Semua Phase 6 adalah frontend-only.

## 5. Aturan Bisnis

1. Onboarding wizard hanya muncul sekali. Reset dari Pengaturan.
2. Mode Latihan: semua transaksi ke localStorage saja, ada banner oranye jelas.
3. Pengantar modul: per-modul, disimpan di `modules_intros_seen[]`.
4. Glosarium: minimal 50 istilah, cari berdasarkan istilah + arti.
5. Tooltip: ikon "?" harus ada di semua kolom yang pakai istilah teknis.
6. Empty state: selalu ada tombol aksi, bukan cuma pesan.

## 6. State

### Onboarding Wizard
```
[Step 1: Nama Usaha] → [Step 2: Jenis Usaha] → [Step 3: Jumlah Outlet] → [Step 4: Barang/Jasa] → [Step 5: Stok] → [Step 6: Karyawan] → [Selesai]
```

### Mode Latihan
```
[OFF] → toggle → [ON + banner] → toggle → [OFF + hapus data latihan]
```

### Pengantar Modul
```
[Belum dilihat] → buka modul → [Tampilkan pengantar] → tutup → [Sudah dilihat]
```

## 7. Kasus Tepi & Penanganan Error

1. **localStorage penuh** → tampilkan pesan "Mode Latihan tidak bisa diaktifkan karena penyimpanan penuh."
2. **Reset onboarding** → harus konfirmasi: "Semua pengaturan akan di-reset ke default?"
3. **Mode Latihan + transaksi offline** → data latihan tidak disinkronkan saat online.
4. **Glosarium kosong** → tampilkan empty state: "Belum ada istilah. Kemungkinan ada error."
5. **Tooltip tidak ditemukan** → ikon "?" tetap ditampilkan, tapi popover bilang "Istilah ini belum tersedia."

## 8. Dampak ke Modul yang Sudah Ada

| Modul | Dampak |
|-------|--------|
| Dashboard | Tambah tombol "?" untuk pengantar |
| Produk | Tambah pengantar + tooltip |
| Kasir | Tambah pengantar + mode latihan banner |
| Stok & Gudang | Tambah pengantar + tooltip |
| Laporan | Tambah pengantar |
| Pengaturan | Tambah toggle Mode Latihan + Reset Onboarding |

## 9. Non-Fungsional

- **Performance:** Onboarding wizard harus ringan (< 100ms render per step).
- **Aksesibilitas:** Keyboard navigation untuk wizard. Screen reader announce step.
- **Mobile:** Full-screen modal untuk wizard. Banner mode latihan fixed di atas.
- **Offline:** Semua data localStorage, bisa dipakai offline.
