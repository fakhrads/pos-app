"use client";

/**
 * RC-01 — Pengantar Modul
 *
 * Kumpulan teks pengantar untuk tiap modul: apa ini, kenapa penting,
 * cara pakai (3-5 langkah), contoh nyata, dan kesalahan umum.
 * Ditampilkan sekali per modul (disimpan di `modulesIntrosSeen[]`),
 * dan tetap bisa diakses lewat ikon "?".
 */

export interface ModuleIntroData {
  id: string;
  title: string;
  emoji: string;
  what: string;
  why: string;
  steps: string[];
  example: string;
  pitfall: string;
}

export const MODULE_INTROS: Record<string, ModuleIntroData> = {
  dashboard: {
    id: "dashboard",
    title: "Dashboard",
    emoji: "📊",
    what: "Ringkasan kondisi toko hari ini: penjualan, transaksi, laba, dan stok menipis.",
    why: "Supaya kamu tahu performa usaha dalam satu pandangan tanpa buka banyak halaman.",
    steps: [
      "Buka halaman Dashboard setiap pagi.",
      "Periksa angka Penjualan & Laba hari ini.",
      "Cek grafik 7 hari terakhir untuk tren.",
      "Lihat stok menipis dan segera restock.",
    ],
    example: "Hari ini: Rp 2.450.000 dari 47 transaksi, laba kotor 38%.",
    pitfall: "Jangan cuma lihat penjualan — pastikan laba juga positif.",
  },
  pos: {
    id: "pos",
    title: "Kasir",
    emoji: "🛒",
    what: "Layar untuk mencatat transaksi penjualan saat pelanggan membayar.",
    why: "Kasir yang cepat = antrean pendek = pelanggan senang.",
    steps: [
      "Cari atau ketuk produk yang dibeli.",
      "Atur jumlah di keranjang.",
      "Tekan Bayar dan pilih cara pembayaran.",
      "Terima uang dan berikan struk.",
    ],
    example: "2 Indomie + 1 Aqua = Rp 10.000, bayar tunai Rp 20.000, kembali Rp 10.000.",
    pitfall: "Jangan lupa buka shift dulu — transaksi bisa ditolak kalau shift belum dibuka.",
  },
  products: {
    id: "products",
    title: "Produk",
    emoji: "📦",
    what: "Daftar semua barang/jasa yang kamu jual, beserta harga modal & jual.",
    why: "Produk yang terdata rapi membuat kasir cepat dan laporan akurat.",
    steps: [
      "Tekan Tambah Produk.",
      "Isi nama, harga modal, dan harga jual.",
      "Pilih kategori (buat dulu jika belum ada).",
      "Atur stok & varian sesuai kebutuhan.",
    ],
    example: "Indomie Goreng: modal Rp 2.500, jual Rp 3.000, kategori Makanan.",
    pitfall: "Jangan isi harga jual lebih kecil dari modal — kamu akan rugi.",
  },
  warehouses: {
    id: "warehouses",
    title: "Stok & Gudang",
    emoji: "🏬",
    what: "Kelola lokasi penyimpanan, transfer, koreksi, dan pantau stok menipis.",
    why: "Stok yang terpantau mencegah kehabisan barang dan penumpukan modal.",
    steps: [
      "Buat gudang/lokasi penyimpanan.",
      "Pindahkan barang antar gudang via Transfer.",
      "Koreksi stok jika ada selisih fisik.",
      "Pantau stok menipis di laporan Stok.",
    ],
    example: "Pindah 24 Aqua dari Gudang Pusat ke Toko Depan.",
    pitfall: "Gunakan Koreksi Stok (bukan transfer) untuk barang rusak/hilang.",
  },
  reports: {
    id: "reports",
    title: "Laporan",
    emoji: "📈",
    what: "Ringkasan penjualan, laba, arus kas, dan nilai stok dalam periode tertentu.",
    why: "Laporan yang dibaca rutin membuat keputusan usaha lebih tepat.",
    steps: [
      "Pilih tab (Penjualan, Keuangan, Stok).",
      "Atur rentang tanggal di pojok.",
      "Baca angka kunci: revenue, laba, margin.",
      "Export ke Excel/PDF/CSV kalau perlu.",
    ],
    example: "Bulan ini revenue Rp 12.000.000, laba bersih Rp 2.500.000.",
    pitfall: "Pastikan rentang tanggal benar — data bisa terlihat kosong jika salah periode.",
  },
  customers: {
    id: "customers",
    title: "Pelanggan",
    emoji: "👥",
    what: "Data pelanggan, member, poin, dan kasbon (hutang).",
    why: "Mengelola pelanggan membantu menumbuhkan loyalitas dan memantau piutang.",
    steps: [
      "Tambah pelanggan baru.",
      "Atur level member & poin.",
      "Catat kasbon untuk pembayaran nanti.",
      "Pantau sisa hutang tiap pelanggan.",
    ],
    example: "Pak Budi: Gold member, poin 2.500, kasbon sisa Rp 100.000.",
    pitfall: "Jangan lupa menagih kasbon — cek halaman detail pelanggan rutin.",
  },
  discounts: {
    id: "discounts",
    title: "Diskon",
    emoji: "🏷️",
    what: "Potongan harga untuk semua produk, satu kategori, atau produk tertentu.",
    why: "Diskon yang terstruktur mendorong penjualan tanpa menguras margin.",
    steps: [
      "Tambah diskon baru.",
      "Pilih jenis (persen/nominal).",
      "Tentukan cakupan (semua/kategori/produk).",
      "Aktifkan saat periode promo.",
    ],
    example: "Diskon Lebaran 10% untuk semua produk selama 2 minggu.",
    pitfall: "Periksa margin sebelum memberi diskon besar agar tidak rugi.",
  },
  transactions: {
    id: "transactions",
    title: "Transaksi",
    emoji: "🧾",
    what: "Riwayat semua penjualan, retur, dan pembatalan.",
    why: "Arsip transaksi untuk cek omzet, layanan pelanggan, dan audit.",
    steps: [
      "Cari transaksi berdasarkan nama/No. struk.",
      "Buka detail untuk lihat item & cara bayar.",
      "Retur atau batalkan bila perlu.",
      "Export daftar transaksi untuk rekap.",
    ],
    example: "Temukan transaksi #INV-20260818-047 milik Pak Budi.",
    pitfall: "Batalkan dengan hati-hati — stok akan dikembalikan otomatis.",
  },
  glossary: {
    id: "glossary",
    title: "Glosarium",
    emoji: "📖",
    what: "Kamus istilah teknis yang dipakai seluruh aplikasi, dijelaskan dengan bahasa sehari-hari.",
    why: "Supaya kamu tidak bingung dengan istilah seperti COGS, Stock Opname, atau Piutang.",
    steps: [
      "Gunakan kotak pencarian untuk cari istilah apapun.",
      "Baca arti sehari-hari dan contoh angkanya.",
      "Ketuk 'Buka modul' untuk langsung ke halaman terkait.",
    ],
    example: "Cari 'HPP' → artinya Modal Barang, contoh Rp 2.500/bungkus.",
    pitfall: "Tiap istilah juga punya ikon '?' kecil di form, jadi tidak perlu buka halaman ini terus-menerus.",
  },
};

/** Dapatkan pengantar modul. Kembalikan null jika id tidak dikenal. */
export function getModuleIntro(id: string): ModuleIntroData | null {
  return MODULE_INTROS[id] ?? null;
}
