/**
 * Glosarium — Kamus Istilah untuk UMKM
 * 
 * Minimal 30 istilah, tiap entri:
 * - term: istilah teknis
 * - plain: istilah sehari-hari
 * - definition: penjelasan singkat
 * - example: contoh angka
 * - relatedModule: modul terkait
 */

export interface GlossaryEntry {
  id: string;
  term: string;
  plain: string;
  definition: string;
  example: string;
  relatedModule: string;
}

export const glossary: GlossaryEntry[] = [
  // ===== PRODUK =====
  {
    id: "g001",
    term: "SKU",
    plain: "Kode Barang",
    definition: "Kode unik untuk mengidentifikasi satu jenis barang. Bisa berupa huruf dan angka.",
    example: "IND-001 untuk Indomie Goreng",
    relatedModule: "Produk",
  },
  {
    id: "g002",
    term: "Barcode",
    plain: "Barcode",
    definition: "Kode batang yang bisa discan dengan kamera atau alat scanner untuk mengenali barang.",
    example: "8992388111017 (Indomie Goreng)",
    relatedModule: "Produk",
  },
  {
    id: "g003",
    term: "Variant",
    plain: "Varian Produk",
    definition: "Perbedaan pada satu produk, seperti ukuran, warna, atau rasa. Masing-masing punya harga dan stok sendiri.",
    example: "Kopi Susu: Regular, Extra Shot, Vanila",
    relatedModule: "Produk",
  },
  {
    id: "g004",
    term: "Unit Conversion",
    plain: "Konversi Satuan",
    definition: "Mengubah satuan beli ke satuan jual. Contoh: beli per dus, jual per bungkus.",
    example: "1 dus = 40 bungkus, stok berkurang otomatis",
    relatedModule: "Produk",
  },
  {
    id: "g005",
    term: "Category",
    plain: "Kategori",
    definition: "Pengelompokan barang berdasarkan jenis. Membantu mencari dan melihat laporan per kelompok.",
    example: "Minuman, Makanan Ringan, Bumbu Dapur",
    relatedModule: "Produk",
  },

  // ===== STOK =====
  {
    id: "g010",
    term: "Stock On Hand",
    plain: "Stok Tersedia",
    definition: "Jumlah barang yang ada di gudang/toko saat ini, siap dijual.",
    example: "Indomie Goreng: 120 bungkus",
    relatedModule: "Stok",
  },
  {
    id: "g011",
    term: "Min Stock",
    plain: "Stok Minimum",
    definition: "Jumlah stok terendah yang harus ada. Kalau stok kurang dari angka ini, saatnya beli lagi.",
    example: "Indomie: min 30, stok sekarang 24 → harus beli",
    relatedModule: "Stok",
  },
  {
    id: "g012",
    term: "Stock Adjustment",
    plain: "Koreksi Stok",
    definition: "Perubahan stok secara manual karena alasan tertentu (rusak, hilang, salah catat).",
    example: "5 bungkus rusak → koreksi -5",
    relatedModule: "Stok",
  },
  {
    id: "g013",
    term: "Stock Transfer",
    plain: "Transfer Stok",
    definition: "Memindahkan barang dari satu gudang ke gudang lain.",
    example: "Pindah 24 Aqua dari Gudang Pusat ke Toko Depan",
    relatedModule: "Stok",
  },
  {
    id: "g014",
    term: "Stock Opname",
    plain: "Stok Opname",
    definition: "Menghitung fisik barang di gudang, lalu mencocokkan dengan catatan. Biasanya dilakukan sebulan sekali.",
    example: "Catatan: 50, Fisik: 44 → selisih -6",
    relatedModule: "Stok",
  },
  {
    id: "g015",
    term: "Stock Card",
    plain: "Kartu Stok",
    definition: "Riwayat semua perubahan stok suatu barang. Siapa yang ubah, kapan, dan berapa.",
    example: "15 Agt: Budi transfer masuk +24",
    relatedModule: "Stok",
  },

  // ===== KEUANGAN =====
  {
    id: "g020",
    term: "COGS / HPP",
    plain: "Modal Barang",
    definition: "Harga yang kamu bayar ke supplier untuk satu barang. Ini modal kamu.",
    example: "Indomie Goreng: modal Rp 2.500/bungkus",
    relatedModule: "Produk",
  },
  {
    id: "g021",
    term: "Gross Margin",
    plain: "Untung Kotor",
    definition: "Selisih antara harga jual dan modal barang. Belum dikurangi biaya lain (listrik, sewa, gaji).",
    example: "Jual Rp 3.000 - Modal Rp 2.500 = Untung Rp 500",
    relatedModule: "Laporan",
  },
  {
    id: "g022",
    term: "Revenue",
    plain: "Penjualan",
    definition: "Total uang yang masuk dari semua transaksi dalam periode tertentu.",
    example: "Hari ini: Rp 2.450.000 dari 47 transaksi",
    relatedModule: "Laporan",
  },
  {
    id: "g023",
    term: "Profit",
    plain: "Untung Bersih",
    definition: "Uang yang benar-benar kamu dapat setelah dikurangi semua biaya.",
    example: "Penjualan Rp 2.450k - Modal Rp 1.200k - Pengeluaran Rp 360k = Rp 890k",
    relatedModule: "Laporan",
  },
  {
    id: "g024",
    term: "Cash Flow",
    plain: "Arus Kas",
    definition: "Pencatatan uang masuk dan keluar, termasuk di luar penjualan.",
    example: "Bayar listrik Rp 350.000 = kas keluar",
    relatedModule: "Keuangan",
  },
  {
    id: "g025",
    term: "Outstanding AR",
    plain: "Piutang Belum Dibayar",
    definition: "Uang yang belum dibayar oleh pelanggan karena beli dengan kasbon.",
    example: "Pak Budi hutang Rp 150.000, belum bayar",
    relatedModule: "Pelanggan",
  },

  // ===== TRANSAKSI =====
  {
    id: "g030",
    term: "Invoice",
    plain: "Nomor Transaksi",
    definition: "Nomor unuk setiap transaksi penjualan. Untuk melacak dan mencari.",
    example: "INV-20260818-047",
    relatedModule: "Kasir",
  },
  {
    id: "g031",
    term: "Payment Method",
    plain: "Cara Bayar",
    definition: "Bagaimana pelanggan membayar: tunai, QRIS, transfer, kartu.",
    example: "Bayar dengan QRIS Rp 23.000",
    relatedModule: "Kasir",
  },
  {
    id: "g032",
    term: "Split Payment",
    plain: "Bayar Bertahap",
    definition: "Satu transaksi dibayar dengan dua atau lebih cara bayar.",
    example: "Tunai Rp 13.000 + QRIS Rp 10.000",
    relatedModule: "Kasir",
  },
  {
    id: "g033",
    term: "Void",
    plain: "Batalkan Transaksi",
    definition: "Membatalkan transaksi yang sudah tercatat. Stok akan dikembalikan.",
    example: "Transaksi #047 dibatalkan, stok +24 Aqua dikembalikan",
    relatedModule: "Kasir",
  },
  {
    id: "g034",
    term: "Return",
    plain: "Retur",
    definition: "Barang yang dikembalikan oleh pelanggan karena rusak, salah, atau tidak sesuai.",
    example: "Pak Budi return 2 Aqua pecah → refund Rp 8.000",
    relatedModule: "Kasir",
  },

  // ===== GUDANG =====
  {
    id: "g040",
    term: "Warehouse",
    plain: "Gudang / Lokasi",
    definition: "Tempat menyimpan barang. Bisa gudang besar, toko depan, atau mobil kanvas.",
    example: "Gudang Pusat, Toko Depan, Gudang Cabang Bogor",
    relatedModule: "Stok",
  },
  {
    id: "g041",
    term: "Movement Type",
    plain: "Jenis Pergerakan Stok",
    definition: "Alasan stok berubah: penjualan, pembelian, transfer, koreksi, retur.",
    example: "sale_out: stok berkurang karena penjualan",
    relatedModule: "Stok",
  },

  // ===== PELANGGAN =====
  {
    id: "g050",
    term: "Membership",
    plain: "Member",
    definition: "Pelanggan yang terdaftar dan punya poin/level. Biasanya dapat keuntungan khusus.",
    example: "Pak Budi: Gold member, poin 2.500",
    relatedModule: "Pelanggan",
  },
  {
    id: "g051",
    term: "Kasbon",
    plain: "Hutang Pelanggan",
    definition: "Pelanggan beli sekarang, bayar nanti. Catat di sini supaya tidak lupa.",
    example: "Pak Budi kasbon Rp 150.000, jatuh tempo 30 hari",
    relatedModule: "Pelanggan",
  },

  // ===== DISKON =====
  {
    id: "g060",
    term: "Discount",
    plain: "Diskon / Potongan Harga",
    definition: "Mengurangi harga barang atau total belanja. Bisa persen atau nominal.",
    example: "Diskon 10% atau Diskon Rp 5.000",
    relatedModule: "Produk",
  },
  {
    id: "g061",
    term: "Scope",
    plain: "Cakupan Diskon",
    definition: "Diskon berlaku untuk apa: semua barang, satu kategori, atau satu produk.",
    example: "Diskon 'Lebaran' berlaku untuk semua produk",
    relatedModule: "Produk",
  },

  // ===== LAIN-LAIN =====
  {
    id: "g070",
    term: "Shift",
    plain: "Shift / Jam Kerja",
    definition: "Periode kerja kasir. Buka shift = mulai jualan, tutup shift = akhiri hari.",
    example: "Buka shift jam 08:00, tutup jam 20:00",
    relatedModule: "Kasir",
  },
  {
    id: "g071",
    term: "Cash Drawer",
    plain: "Laci Kas / Uang Kas",
    definition: "Uang fisik di laci kasir. Modal awal ditambah penjualan tunai.",
    example: "Modal awal Rp 500.000 + Penjualan tunai Rp 1.850.000",
    relatedModule: "Kasir",
  },
  {
    id: "g072",
    term: "Reconciliation",
    plain: "Cocokkan Uang Kas",
    definition: "Menghitung uang fisik dan mencocokkan dengan catatan. Kalau ada selisih, perlu dicari penyebabnya.",
    example: "Harusnya Rp 2.350.000, hitung fisik Rp 2.345.000 → selisih -Rp 5.000",
    relatedModule: "Kasir",
  },
  {
    id: "g073",
    term: "Audit Log",
    plain: "Riwayat Aktivitas",
    definition: "Catatan siapa yang mengubah apa dan kapan. Untuk keamanan dan jejak.",
    example: "Budi mengubah harga Indomie dari Rp 2.800 ke Rp 3.000",
    relatedModule: "Sistem",
  },
];

/**
 * Search glossary
 */
export function searchGlossary(query: string): GlossaryEntry[] {
  const q = query.toLowerCase();
  return glossary.filter(
    (g) =>
      g.term.toLowerCase().includes(q) ||
      g.plain.toLowerCase().includes(q) ||
      g.definition.toLowerCase().includes(q)
  );
}

/**
 * Get glossary by module
 */
export function getGlossaryByModule(module: string): GlossaryEntry[] {
  return glossary.filter((g) => g.relatedModule === module);
}
