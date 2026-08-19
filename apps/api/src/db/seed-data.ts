/**
 * Data seed Fase 2 (SPEC §5.10) — katalog realistis Indonesia.
 * Dipakai oleh src/db/seed.ts. Sumber tunggal data demo (bukan frontend data/).
 */

export interface SeedVariant {
  name: string;
  sku: string;
  barcode?: string;
  price: number; // rupiah
  stock: number;
}

export interface SeedUnit {
  unit: string;
  factor: number; // qty unit dasar per 1 satuan ini
  sellPrice: number; // rupiah (grosir ≤ eceran × factor)
  isSellable?: boolean;
  isPurchaseUnit?: boolean;
}

export interface SeedProduct {
  name: string;
  category: string; // slug kategori (harus ada di SEED_CATEGORIES)
  sku: string;
  barcode?: string;
  unit: string; // unit dasar
  cost: number; // harga beli per unit dasar
  price: number; // harga jual per unit dasar
  stock: number; // stok awal (unit dasar)
  minStock?: number;
  taxable?: boolean; // default true; sembako & minuman kemasan = false
  trackStock?: boolean; // default true; false = produk jasa
  expiry?: string; // YYYY-MM-DD (produk kadaluarsa)
  variants?: SeedVariant[];
  units?: SeedUnit[];
}

export const SEED_VERSION = '2.1';
export const SEED_PASSWORD = 'Fase2Test!123';

export const SEED_CATEGORIES = [
  { name: 'Makanan', slug: 'makanan', sortOrder: 1 },
  { name: 'Minuman', slug: 'minuman', sortOrder: 2 },
  { name: 'Snack', slug: 'snack', sortOrder: 3 },
  { name: 'Sembako', slug: 'sembako', sortOrder: 4 },
  { name: 'Bumbu Dapur', slug: 'bumbu-dapur', sortOrder: 5 },
  { name: 'Produk Kebersihan', slug: 'kebersihan', sortOrder: 6 },
  { name: 'Rokok & Tembakau', slug: 'rokok-tembakau', sortOrder: 7 },
  { name: 'Perlengkapan Mandi', slug: 'mandi', sortOrder: 8 },
  { name: 'Lainnya', slug: 'lainnya', sortOrder: 9 }, // jasa — sudah ada dari ddl.sql
] as const;

export const SEED_USERS = [
  { name: 'Administrator', email: 'admin@fakhripos.local', role: 'admin' as const },
  { name: 'Manager Toko', email: 'manager@fakhripos.local', role: 'manager' as const },
  { name: 'Kasir Siti', email: 'kasir1@fakhripos.local', role: 'kasir' as const },
  { name: 'Kasir Budi', email: 'kasir2@fakhripos.local', role: 'kasir' as const },
];

export const SEED_WAREHOUSES = [
  { code: 'GUD-PUSAT', name: 'Gudang Pusat', address: 'Jl. Merdeka No. 1, Jakarta', pic: 'Manager Toko', capacity: 100000 },
  { code: 'GUD-CABANG-1', name: 'Gudang Cabang 1', address: 'Jl. Sudirman No. 45, Bandung', pic: 'Kasir Siti', capacity: 50000 },
  { code: 'GUD-CABANG-2', name: 'Gudang Cabang 2', address: 'Jl. Pemuda No. 12, Surabaya', pic: 'Kasir Budi', capacity: 50000 },
  { code: 'GUD-RUSAK', name: 'Gudang Barang Rusak', address: 'Gudang belakang', pic: null, capacity: 5000 },
] as const;

/** 25+ pelanggan — 10 pertama jadi member. */
export const SEED_CUSTOMERS = [
  'Budi Santoso', 'Siti Rahayu', 'Ahmad Hidayat', 'Dewi Lestari', 'Rudi Hartono',
  'Sri Wahyuni', 'Agus Salim', 'Nur Aini', 'Joko Susilo', 'Fitri Handayani',
  'Hendra Gunawan', 'Rina Marlina', 'Eko Prasetyo', 'Yuni Astuti', 'Bambang Sutrisno',
  'Lina Marlina', 'Tono Wijaya', 'Maya Sari', 'Andi Firmansyah', 'Ratna Sari',
  'Dedi Kurniawan', 'Intan Permatasari', 'Fajar Nugroho', 'Wulan Sari', 'Rizky Ramadhan',
  'Putri Ayu', 'Arif Hidayat',
] as const;

/** 78 produk: 60–80, ≥10 ber-varian, ≥20 multi-satuan, 6 jasa (track_stock=false). */
export const SEED_PRODUCTS: SeedProduct[] = [
  /* ---------- SEMBAKO (kena_pajak=false) ---------- */
  { name: 'Beras Premium 5kg', category: 'sembako', sku: 'SMB-001', barcode: '8991001000017', unit: 'sak', cost: 65000, price: 72000, stock: 120, taxable: false, units: [{ unit: 'karung', factor: 10, sellPrice: 648000, isPurchaseUnit: true }] },
  { name: 'Beras Medium 10kg', category: 'sembako', sku: 'SMB-002', barcode: '8991001000024', unit: 'sak', cost: 118000, price: 128000, stock: 60, taxable: false, units: [{ unit: 'karung', factor: 5, sellPrice: 576000, isPurchaseUnit: true }] },
  { name: 'Gula Pasir 1kg', category: 'sembako', sku: 'SMB-003', barcode: '8991001000031', unit: 'kg', cost: 15000, price: 17500, stock: 200, taxable: false, units: [{ unit: 'karung', factor: 50, sellPrice: 787500, isPurchaseUnit: true }] },
  { name: 'Minyak Goreng 1L', category: 'sembako', sku: 'SMB-004', barcode: '8991001000048', unit: 'botol', cost: 14000, price: 17000, stock: 0, taxable: false, variants: [
    { name: 'Botol 1L', sku: 'SMB-004-A', barcode: '8991001000048', price: 17000, stock: 100 },
    { name: 'Pouch 2L', sku: 'SMB-004-B', barcode: '8991001000055', price: 32000, stock: 50 },
  ], units: [{ unit: 'dus', factor: 12, sellPrice: 183600 }] },
  { name: 'Telur Ayam 1kg', category: 'sembako', sku: 'SMB-005', barcode: '8991001000062', unit: 'kg', cost: 24000, price: 28000, stock: 80, taxable: false, units: [
    { unit: 'papan', factor: 1.8, sellPrice: 46000 },
    { unit: 'butir', factor: 0.0625, sellPrice: 2000 },
  ] },
  { name: 'Tepung Terigu 1kg', category: 'sembako', sku: 'SMB-006', barcode: '8991001000079', unit: 'kg', cost: 10000, price: 12500, stock: 100, taxable: false, units: [{ unit: 'karung', factor: 25, sellPrice: 281250, isPurchaseUnit: true }] },
  { name: 'Susu Kental Manis Kaleng', category: 'sembako', sku: 'SMB-007', barcode: '8991001000086', unit: 'kaleng', cost: 10000, price: 13000, stock: 120, taxable: false, units: [{ unit: 'dus', factor: 48, sellPrice: 561600, isPurchaseUnit: true }] },
  { name: 'Minyak Kita 2L', category: 'sembako', sku: 'SMB-008', barcode: '8991001000093', unit: 'pouch', cost: 30000, price: 34500, stock: 60, taxable: false, units: [{ unit: 'dus', factor: 12, sellPrice: 372600 }] },

  /* ---------- MAKANAN ---------- */
  { name: 'Indomie Goreng', category: 'makanan', sku: 'MKN-001', unit: 'bungkus', cost: 2600, price: 3500, stock: 0, variants: [
    { name: 'Rasa Goreng Original', sku: 'MKN-001-A', barcode: '8991001100014', price: 3500, stock: 160 },
    { name: 'Rasa Goreng Jumbo', sku: 'MKN-001-B', barcode: '8991001100021', price: 4000, stock: 80 },
    { name: 'Rasa Soto Mie', sku: 'MKN-001-C', barcode: '8991001100038', price: 3500, stock: 90 },
    { name: 'Rasa Ayam Bawang', sku: 'MKN-001-D', barcode: '8991001100045', price: 3500, stock: 70 },
  ], units: [{ unit: 'dus', factor: 40, sellPrice: 126000, isPurchaseUnit: true }, { unit: 'renceng', factor: 5, sellPrice: 16000 }] },
  { name: 'Indomie Soto', category: 'makanan', sku: 'MKN-002', barcode: '8991001100052', unit: 'bungkus', cost: 2600, price: 3500, stock: 300, units: [{ unit: 'dus', factor: 40, sellPrice: 126000, isPurchaseUnit: true }] },
  { name: 'Mie Sedaap Goreng', category: 'makanan', sku: 'MKN-003', barcode: '8991001100069', unit: 'bungkus', cost: 2500, price: 3300, stock: 250, units: [{ unit: 'dus', factor: 40, sellPrice: 118800, isPurchaseUnit: true }] },
  { name: 'Roti Tawar', category: 'makanan', sku: 'MKN-004', barcode: '8991001100076', unit: 'bks', cost: 12000, price: 15000, stock: 40, minStock: 10, expiry: '2026-08-24' },
  { name: 'Roti Coklat', category: 'makanan', sku: 'MKN-005', barcode: '8991001100083', unit: 'pcs', cost: 6000, price: 8000, stock: 60, minStock: 10, expiry: '2026-08-25' },
  { name: 'Pop Mie', category: 'makanan', sku: 'MKN-006', unit: 'cup', cost: 6500, price: 9000, stock: 0, variants: [
    { name: 'Rasa Soto', sku: 'MKN-006-A', barcode: '8991001100090', price: 9000, stock: 40 },
    { name: 'Rasa Ayam Bawang', sku: 'MKN-006-B', barcode: '8991001100106', price: 9000, stock: 30 },
    { name: 'Rasa Kari', sku: 'MKN-006-C', barcode: '8991001100113', price: 9000, stock: 25 },
  ], units: [{ unit: 'dus', factor: 12, sellPrice: 97200 }] },
  { name: 'Keripik Singkong Balado', category: 'makanan', sku: 'MKN-007', barcode: '8991001100120', unit: 'bks', cost: 8000, price: 10000, stock: 60 },
  { name: 'Oishi Pillows', category: 'makanan', sku: 'MKN-008', barcode: '8991001100137', unit: 'pcs', cost: 5000, price: 7000, stock: 100 },

  /* ---------- BUMBU DAPUR ---------- */
  { name: 'Kecap Manis ABC', category: 'bumbu-dapur', sku: 'BMB-001', unit: 'botol', cost: 10000, price: 14000, stock: 0, variants: [
    { name: 'Botol 275ml', sku: 'BMB-001-A', barcode: '8991001200012', price: 14000, stock: 40 },
    { name: 'Botol 520ml', sku: 'BMB-001-B', barcode: '8991001200029', price: 23000, stock: 25 },
    { name: 'Refill 1kg', sku: 'BMB-001-C', barcode: '8991001200036', price: 38000, stock: 15 },
  ], units: [{ unit: 'dus', factor: 12, sellPrice: 151200, isPurchaseUnit: true }] },
  { name: 'Saos Sambal ABC', category: 'bumbu-dapur', sku: 'BMB-002', unit: 'botol', cost: 9000, price: 12500, stock: 0, variants: [
    { name: 'Botol 275ml', sku: 'BMB-002-A', barcode: '8991001200043', price: 12500, stock: 40 },
    { name: 'Botol 335ml', sku: 'BMB-002-B', barcode: '8991001200050', price: 16000, stock: 30 },
  ], units: [{ unit: 'dus', factor: 12, sellPrice: 135000 }] },
  { name: 'Saos Tomat ABC', category: 'bumbu-dapur', sku: 'BMB-003', barcode: '8991001200067', unit: 'botol', cost: 8500, price: 12000, stock: 50, units: [{ unit: 'dus', factor: 12, sellPrice: 129600 }] },
  { name: 'Garam Dapur', category: 'bumbu-dapur', sku: 'BMB-004', barcode: '8991001200074', unit: 'kg', cost: 3000, price: 5000, stock: 90, units: [{ unit: 'karung', factor: 25, sellPrice: 112500, isPurchaseUnit: true }] },
  { name: 'Penyedap Royco Ayam', category: 'bumbu-dapur', sku: 'BMB-005', barcode: '8991001200081', unit: 'sachet', cost: 400, price: 800, stock: 200, units: [{ unit: 'dus', factor: 24, sellPrice: 17280, isPurchaseUnit: true }] },
  { name: 'Masako Sapi', category: 'bumbu-dapur', sku: 'BMB-006', barcode: '8991001200098', unit: 'sachet', cost: 400, price: 800, stock: 180, units: [{ unit: 'dus', factor: 24, sellPrice: 17280, isPurchaseUnit: true }] },
  { name: 'Bawang Goreng 100g', category: 'bumbu-dapur', sku: 'BMB-007', barcode: '8991001200104', unit: 'bks', cost: 10000, price: 13000, stock: 40, expiry: '2026-10-01' },
  { name: 'Merica Bubuk 100g', category: 'bumbu-dapur', sku: 'BMB-008', barcode: '8991001200111', unit: 'bks', cost: 11000, price: 15000, stock: 30 },
  { name: 'Santan Kara 200ml', category: 'bumbu-dapur', sku: 'BMB-009', barcode: '8991001200128', unit: 'kotak', cost: 4000, price: 6500, stock: 100, units: [{ unit: 'dus', factor: 12, sellPrice: 70200 }] },

  /* ---------- MINUMAN (kemasan: kena_pajak=false) ---------- */
  { name: 'Air Mineral 600ml', category: 'minuman', sku: 'MNM-001', unit: 'botol', cost: 2800, price: 4000, stock: 0, taxable: false, variants: [
    { name: 'Botol 330ml', sku: 'MNM-001-A', barcode: '8991001300011', price: 3000, stock: 200 },
    { name: 'Botol 600ml', sku: 'MNM-001-B', barcode: '8991001300028', price: 4000, stock: 300 },
    { name: 'Botol 1500ml', sku: 'MNM-001-C', barcode: '8991001300035', price: 6000, stock: 150 },
  ], units: [{ unit: 'dus', factor: 24, sellPrice: 86400, isPurchaseUnit: true }, { unit: 'karton', factor: 48, sellPrice: 163200, isPurchaseUnit: true }] },
  { name: 'Air Mineral Galon 19L', category: 'minuman', sku: 'MNM-002', barcode: '8991001300042', unit: 'galon', cost: 15000, price: 20000, stock: 25, taxable: false },
  { name: 'Teh Botol Sosro', category: 'minuman', sku: 'MNM-003', unit: 'botol', cost: 3500, price: 5000, stock: 0, taxable: false, variants: [
    { name: 'Botol 350ml', sku: 'MNM-003-A', barcode: '8991001300059', price: 5000, stock: 100 },
    { name: 'Botol 450ml', sku: 'MNM-003-B', barcode: '8991001300066', price: 6500, stock: 50 },
  ], units: [{ unit: 'dus', factor: 24, sellPrice: 108000, isPurchaseUnit: true }] },
  { name: 'Teh Kotak Ultra 300ml', category: 'minuman', sku: 'MNM-004', barcode: '8991001300073', unit: 'kotak', cost: 3500, price: 5000, stock: 120, taxable: false, units: [{ unit: 'dus', factor: 24, sellPrice: 108000 }] },
  { name: 'Coca-Cola 390ml', category: 'minuman', sku: 'MNM-005', unit: 'kaleng', cost: 5500, price: 7500, stock: 0, taxable: false, variants: [
    { name: 'Original', sku: 'MNM-005-A', barcode: '8991001300080', price: 7500, stock: 60 },
    { name: 'Zero Sugar', sku: 'MNM-005-B', barcode: '8991001300097', price: 8000, stock: 40 },
  ], units: [{ unit: 'dus', factor: 24, sellPrice: 162000, isPurchaseUnit: true }] },
  { name: 'Fanta 390ml', category: 'minuman', sku: 'MNM-006', barcode: '8991001300103', unit: 'kaleng', cost: 5500, price: 7500, stock: 80, taxable: false, units: [{ unit: 'dus', factor: 24, sellPrice: 162000 }] },
  { name: 'Sprite 390ml', category: 'minuman', sku: 'MNM-007', barcode: '8991001300110', unit: 'kaleng', cost: 5500, price: 7500, stock: 80, taxable: false, units: [{ unit: 'dus', factor: 24, sellPrice: 162000 }] },
  { name: 'Susu UHT Ultra 1L', category: 'minuman', sku: 'MNM-008', unit: 'kotak', cost: 15000, price: 19000, stock: 0, taxable: false, expiry: '2026-11-30', variants: [
    { name: 'Rasa Full Cream', sku: 'MNM-008-A', barcode: '8991001300127', price: 19000, stock: 30 },
    { name: 'Rasa Coklat', sku: 'MNM-008-B', barcode: '8991001300134', price: 20000, stock: 20 },
    { name: 'Rasa Stroberi', sku: 'MNM-008-C', barcode: '8991001300141', price: 20000, stock: 10 },
  ], units: [{ unit: 'dus', factor: 12, sellPrice: 205200, isPurchaseUnit: true }] },
  { name: 'Susu UHT Greenfields 1L', category: 'minuman', sku: 'MNM-009', barcode: '8991001300158', unit: 'kotak', cost: 17000, price: 21500, stock: 40, taxable: false, expiry: '2026-11-15' },
  { name: 'Milo 3in1 Sachet', category: 'minuman', sku: 'MNM-010', barcode: '8991001300165', unit: 'sachet', cost: 2500, price: 3500, stock: 300, taxable: false, units: [{ unit: 'dus', factor: 30, sellPrice: 94500, isPurchaseUnit: true }, { unit: 'renceng', factor: 10, sellPrice: 32000 }] },
  { name: 'Kopi Kapal Api Sachet', category: 'minuman', sku: 'MNM-011', barcode: '8991001300172', unit: 'sachet', cost: 1200, price: 2000, stock: 400, taxable: false, units: [{ unit: 'dus', factor: 50, sellPrice: 90000, isPurchaseUnit: true }, { unit: 'renceng', factor: 10, sellPrice: 18500 }] },
  { name: 'Kopi Good Day', category: 'minuman', sku: 'MNM-012', barcode: '8991001300189', unit: 'sachet', cost: 1300, price: 2200, stock: 350, taxable: false, units: [{ unit: 'dus', factor: 50, sellPrice: 99000, isPurchaseUnit: true }] },
  { name: 'Teh Sariwangi Celup', category: 'minuman', sku: 'MNM-013', barcode: '8991001300196', unit: 'kotak', cost: 9000, price: 12500, stock: 60, taxable: false, units: [{ unit: 'dus', factor: 12, sellPrice: 135000 }] },
  { name: 'Indomilk Coklat 200ml', category: 'minuman', sku: 'MNM-014', barcode: '8991001300202', unit: 'kotak', cost: 4000, price: 6000, stock: 100, taxable: false, units: [{ unit: 'dus', factor: 12, sellPrice: 64800 }] },
  { name: 'Yakult', category: 'minuman', sku: 'MNM-015', barcode: '8991001300219', unit: 'botol', cost: 3000, price: 4500, stock: 120, taxable: false, units: [{ unit: 'dus', factor: 20, sellPrice: 81000, isPurchaseUnit: true }] },
  { name: 'Torabika Cappuccino', category: 'minuman', sku: 'MNM-016', barcode: '8991001300226', unit: 'sachet', cost: 1400, price: 2500, stock: 200, taxable: false },

  /* ---------- SNACK ---------- */
  { name: 'Chitato 68g', category: 'snack', sku: 'SNK-001', barcode: '8991001400011', unit: 'pcs', cost: 8000, price: 11500, stock: 150, units: [{ unit: 'dus', factor: 12, sellPrice: 124200 }] },
  { name: 'Qtela 85g', category: 'snack', sku: 'SNK-002', barcode: '8991001400028', unit: 'pcs', cost: 7500, price: 11000, stock: 120, units: [{ unit: 'dus', factor: 12, sellPrice: 118800 }] },
  { name: 'Taro Net 60g', category: 'snack', sku: 'SNK-003', barcode: '8991001400035', unit: 'pcs', cost: 7500, price: 10500, stock: 100, units: [{ unit: 'dus', factor: 12, sellPrice: 113400 }] },
  { name: 'Oreo', category: 'snack', sku: 'SNK-004', unit: 'pcs', cost: 9000, price: 12500, stock: 0, variants: [
    { name: 'Rasa Original', sku: 'SNK-004-A', barcode: '8991001400042', price: 12500, stock: 40 },
    { name: 'Rasa Stroberi', sku: 'SNK-004-B', barcode: '8991001400059', price: 12500, stock: 30 },
    { name: 'Rasa Vanilla', sku: 'SNK-004-C', barcode: '8991001400066', price: 12500, stock: 20 },
  ], units: [{ unit: 'dus', factor: 12, sellPrice: 135000 }] },
  { name: 'Beng-Beng', category: 'snack', sku: 'SNK-005', barcode: '8991001400073', unit: 'pcs', cost: 2500, price: 4000, stock: 200, units: [{ unit: 'dus', factor: 24, sellPrice: 86400, isPurchaseUnit: true }] },
  { name: 'SilverQueen 52g', category: 'snack', sku: 'SNK-006', barcode: '8991001400080', unit: 'pcs', cost: 9000, price: 13000, stock: 80, units: [{ unit: 'dus', factor: 12, sellPrice: 140400 }] },
  { name: 'Pilus Garuda', category: 'snack', sku: 'SNK-007', barcode: '8991001400097', unit: 'bks', cost: 8000, price: 11000, stock: 100 },
  { name: 'Chocolatos', category: 'snack', sku: 'SNK-008', barcode: '8991001400103', unit: 'pcs', cost: 3000, price: 5000, stock: 150 },
  { name: 'Richeese Nabati', category: 'snack', sku: 'SNK-009', barcode: '8991001400110', unit: 'pcs', cost: 7500, price: 10500, stock: 130, units: [{ unit: 'dus', factor: 12, sellPrice: 113400 }] },
  { name: 'Wafello', category: 'snack', sku: 'SNK-010', barcode: '8991001400127', unit: 'pcs', cost: 6500, price: 9500, stock: 90 },

  /* ---------- PRODUK KEBERSIHAN ---------- */
  { name: 'Sabun Cuci Piring Mama Lemon 800ml', category: 'kebersihan', sku: 'KBR-001', barcode: '8991001500017', unit: 'botol', cost: 14000, price: 18500, stock: 60, units: [{ unit: 'dus', factor: 12, sellPrice: 199800, isPurchaseUnit: true }] },
  { name: 'Deterjen Rinso 800g', category: 'kebersihan', sku: 'KBR-002', unit: 'bks', cost: 15000, price: 20000, stock: 0, variants: [
    { name: 'Original', sku: 'KBR-002-A', barcode: '8991001500024', price: 20000, stock: 30 },
    { name: 'Matic', sku: 'KBR-002-B', barcode: '8991001500031', price: 21000, stock: 20 },
  ], units: [{ unit: 'dus', factor: 12, sellPrice: 216000, isPurchaseUnit: true }] },
  { name: 'Pemutih Bayclin 500ml', category: 'kebersihan', sku: 'KBR-003', barcode: '8991001500048', unit: 'botol', cost: 6000, price: 9000, stock: 40 },
  { name: 'Pembersih Lantai Wipol 900ml', category: 'kebersihan', sku: 'KBR-004', barcode: '8991001500055', unit: 'botol', cost: 11000, price: 15500, stock: 50 },
  { name: 'Spon Cuci Piring', category: 'kebersihan', sku: 'KBR-005', barcode: '8991001500062', unit: 'pcs', cost: 3000, price: 5000, stock: 80 },

  /* ---------- PERLENGKAPAN MANDI ---------- */
  { name: 'Sabun Lifebuoy 90g', category: 'mandi', sku: 'MDI-001', unit: 'pcs', cost: 3500, price: 5500, stock: 0, variants: [
    { name: 'Warna Merah', sku: 'MDI-001-A', barcode: '8991001600013', price: 5500, stock: 60 },
    { name: 'Warna Biru', sku: 'MDI-001-B', barcode: '8991001600020', price: 5500, stock: 50 },
    { name: 'Warna Hijau', sku: 'MDI-001-C', barcode: '8991001600037', price: 5500, stock: 40 },
  ], units: [{ unit: 'dus', factor: 48, sellPrice: 237600, isPurchaseUnit: true }] },
  { name: 'Shampo Pantene 170ml', category: 'mandi', sku: 'MDI-002', barcode: '8991001600044', unit: 'botol', cost: 16000, price: 22000, stock: 60, units: [{ unit: 'dus', factor: 12, sellPrice: 237600, isPurchaseUnit: true }] },
  { name: 'Pasta Gigi Pepsodent 75g', category: 'mandi', sku: 'MDI-003', unit: 'pcs', cost: 6000, price: 9000, stock: 0, variants: [
    { name: 'Fresh', sku: 'MDI-003-A', barcode: '8991001600051', price: 9000, stock: 60 },
    { name: 'Herbal', sku: 'MDI-003-B', barcode: '8991001600068', price: 9000, stock: 40 },
  ], units: [{ unit: 'dus', factor: 12, sellPrice: 97200 }] },
  { name: 'Sabun Giv 80g', category: 'mandi', sku: 'MDI-004', barcode: '8991001600075', unit: 'pcs', cost: 3000, price: 4500, stock: 130 },
  { name: 'Shampo Lifebuoy 340ml', category: 'mandi', sku: 'MDI-005', barcode: '8991001600082', unit: 'botol', cost: 20000, price: 27000, stock: 40 },

  /* ---------- ROKOK & TEMBAKAU ---------- */
  { name: 'Rokok Sampoerna Mild 16', category: 'rokok-tembakau', sku: 'ROK-001', barcode: '8991001700019', unit: 'bks', cost: 27000, price: 30000, stock: 100, units: [{ unit: 'slop', factor: 10, sellPrice: 285000, isPurchaseUnit: true }] },
  { name: 'Rokok Dji Sam Soe 12', category: 'rokok-tembakau', sku: 'ROK-002', barcode: '8991001700026', unit: 'bks', cost: 26500, price: 29500, stock: 80, units: [{ unit: 'slop', factor: 10, sellPrice: 280000, isPurchaseUnit: true }] },
  { name: 'Rokok Gudang Garam Filter 12', category: 'rokok-tembakau', sku: 'ROK-003', barcode: '8991001700033', unit: 'bks', cost: 23000, price: 26000, stock: 90, units: [{ unit: 'slop', factor: 10, sellPrice: 247000, isPurchaseUnit: true }] },
  { name: 'Rokok Surya 16', category: 'rokok-tembakau', sku: 'ROK-004', barcode: '8991001700040', unit: 'bks', cost: 26000, price: 29000, stock: 70, units: [{ unit: 'slop', factor: 10, sellPrice: 275000, isPurchaseUnit: true }] },

  /* ---------- JASA (track_stock=false, 6 produk — AC-07.5 ≥5) ---------- */
  { name: 'Jasa Service AC', category: 'lainnya', sku: 'JAS-001', unit: 'unit', cost: 0, price: 75000, stock: 0, trackStock: false },
  { name: 'Jasa Cuci AC', category: 'lainnya', sku: 'JAS-002', unit: 'unit', cost: 0, price: 50000, stock: 0, trackStock: false },
  { name: 'Jasa Servis Kulkas', category: 'lainnya', sku: 'JAS-003', unit: 'unit', cost: 0, price: 100000, stock: 0, trackStock: false },
  { name: 'Jasa Cuci Sepatu', category: 'lainnya', sku: 'JAS-004', unit: 'unit', cost: 0, price: 40000, stock: 0, trackStock: false },
  { name: 'Jasa Pengiriman Lokal', category: 'lainnya', sku: 'JAS-005', unit: 'unit', cost: 0, price: 15000, stock: 0, trackStock: false },
  { name: 'Jasa Isi Ulang Tinta Printer', category: 'lainnya', sku: 'JAS-006', unit: 'unit', cost: 0, price: 30000, stock: 0, trackStock: false },
];
