/**
 * Seed Fase 2 (SPEC §2 US-07, §5.10-12, §7.2) — `bun run db:seed` / `--force`.
 *
 * Mengisi: 9 kategori (upsert by slug), 4 user demo, 71 produk (60–80),
 * 34 varian, 26 produk multi-satuan, 6 produk jasa (track_stock=false),
 * 4 gudang, 27 pelanggan (10 member), 300+ transaksi 60 hari terakhir (WIB),
 * 2 transaksi cancelled (stok kembali via cancellation).
 *
 * PERFORMA: PGlite/UMKM homelab lambat utk insert tunggal (~45ms) — SEMUA
 * insert memakai multi-row batch (drizzle .values([...])), target < 60 s.
 *
 * Idempotensi (SPEC §7.2.7): marker `settings['seed.fase2.version']` ditulis
 * di akhir; run berikutnya dengan versi sama → skip (kecuali --force).
 * --force: reset data seed (transaksi, stok, produk, varian, unit, gudang,
 * pelanggan, user seed) lalu buat ulang. Data NON-seed tidak dihapus.
 *
 * Guard: menolak jalan di NODE_ENV=production tanpa SEED_DEMO=true (§8.2.9).
 * Password demo (argon2id): Fase2Test!123 — HANYA untuk dev/demo.
 *
 * Self-check (wajib lolos, exit ≠ 0 bila gagal) — SPEC §5.12:
 *  (a) produk 60–80  (b) transaksi ≥300  (c) net movement = stok akhir
 *  (d) Σ warehouse_stocks = stock_on_hand  (e) tidak ada stok negatif
 *  (f) invoice unik  (g) total = subtotal − discount + tax − poin redeem
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { client, db } from './index';
import {
  categories,
  users,
  products,
  productVariants,
  productUnits,
  warehouses,
  warehouseStocks,
  customers,
  memberships,
  transactions,
  transactionItems,
  payments,
  stockMovements,
  pointMovements,
  settings,
} from './schema';
import { env } from '../env';
import { toQty, roundMoney, taxExclusive, pointsFrom } from '../lib/money';
import {
  SEED_VERSION,
  SEED_PASSWORD,
  SEED_CATEGORIES,
  SEED_USERS,
  SEED_WAREHOUSES,
  SEED_CUSTOMERS,
  SEED_PRODUCTS,
  type SeedVariant,
} from './seed-data';

const FORCE = process.argv.includes('--force');
const TAX_RATE = 11; // PPN 11% eksklusif (ddl.sql)
const DAYS_BACK = 60;
const WIB_OFFSET_MS = 7 * 3600 * 1000;

/* ------------------------------------------------------------------ */
/* PRNG deterministik (demo konsisten antar run)                       */
/* ------------------------------------------------------------------ */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260819);
const randInt = (min: number, max: number): number => min + Math.floor(rnd() * (max - min + 1));
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]!;
const pct = (p: number): boolean => rnd() < p;

/* ------------------------------------------------------------------ */
/* Helper waktu WIB                                                    */
/* ------------------------------------------------------------------ */
/** Awal hari WIB (UTC) untuk `daysBack` hari lalu: 00:00 WIB → UTC. */
function dayStartUtc(daysBack: number): Date {
  const now = new Date();
  const wibNow = new Date(now.getTime() + WIB_OFFSET_MS);
  const y = wibNow.getUTCFullYear();
  const m = wibNow.getUTCMonth();
  const d = wibNow.getUTCDate() - daysBack;
  return new Date(Date.UTC(y, m, d, 0, 0, 0) - WIB_OFFSET_MS);
}

/** 'YYYYMMDD' WIB untuk tanggal UTC. */
function yyyymmddWib(utc: Date): string {
  const wib = new Date(utc.getTime() + WIB_OFFSET_MS);
  return wib.toISOString().slice(0, 10).replace(/-/g, '');
}

function wibToUtc(dayStart: Date, hour: number, minute: number): Date {
  return new Date(dayStart.getTime() + (hour * 60 + minute) * 60_000);
}

/* ------------------------------------------------------------------ */
/* Cleanup --force (urutan FK aman)                                    */
/* ------------------------------------------------------------------ */
async function forceCleanup(): Promise<void> {
  console.log('[seed] --force: mereset data seed...');
  const seedEmails = SEED_USERS.map((u) => u.email);
  await db.execute(sql`DELETE FROM stock_adjustments`);
  await db.execute(sql`DELETE FROM stock_transfers`);
  await db.execute(sql`DELETE FROM point_movements`);
  await db.execute(sql`DELETE FROM stock_movements`);
  await db.execute(sql`DELETE FROM return_items`);
  await db.execute(sql`DELETE FROM returns`);
  await db.execute(sql`DELETE FROM payments`);
  await db.execute(sql`DELETE FROM transaction_items`);
  await db.execute(sql`DELETE FROM transactions`);
  await db.execute(sql`DELETE FROM warehouse_stocks`);
  await db.execute(sql`DELETE FROM product_units`);
  await db.execute(sql`DELETE FROM product_variants`);
  await db.execute(sql`DELETE FROM memberships`);
  await db.execute(sql`DELETE FROM customers`);
  await db.execute(sql`DELETE FROM products`);
  await db.delete(users).where(inArray(users.email, seedEmails));
  await db.execute(sql`DELETE FROM ${settings} WHERE ${settings.key} = 'seed.fase2.version'`);
  console.log('[seed] reset selesai.');
}

/* ------------------------------------------------------------------ */
/* Master data                                                         */
/* ------------------------------------------------------------------ */
async function seedCategories(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const c of SEED_CATEGORIES) {
    const rows = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.slug, c.slug), isNull(categories.deletedAt)))
      .limit(1);
    let id = rows[0]?.id;
    if (!id) {
      const [ins] = await db
        .insert(categories)
        .values({ name: c.name, slug: c.slug, sortOrder: c.sortOrder, isActive: true })
        .returning();
      id = ins.id;
    } else {
      await db.update(categories).set({ name: c.name, sortOrder: c.sortOrder }).where(eq(categories.id, id));
    }
    map.set(c.slug, id);
  }
  return map;
}

async function seedWarehouses(): Promise<string> {
  let pusatId = '';
  for (const w of SEED_WAREHOUSES) {
    const rows = await db
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.code, w.code), isNull(warehouses.deletedAt)))
      .limit(1);
    if (rows[0]) {
      if (w.code === 'GUD-PUSAT') pusatId = rows[0].id;
      continue;
    }
    const [ins] = await db
      .insert(warehouses)
      .values({ code: w.code, name: w.name, address: w.address, pic: w.pic, capacity: w.capacity, isActive: true })
      .returning();
    if (w.code === 'GUD-PUSAT') pusatId = ins.id;
  }
  if (!pusatId) throw new Error('Gudang GUD-PUSAT tidak ditemukan setelah seed');
  return pusatId;
}

async function seedUsers(): Promise<Map<string, string>> {
  const map = new Map<string, string>(); // email → id
  for (const u of SEED_USERS) {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, u.email), isNull(users.deletedAt)))
      .limit(1);
    if (rows[0]) {
      map.set(u.email, rows[0].id);
      continue;
    }
    const passwordHash = await Bun.password.hash(SEED_PASSWORD);
    const [ins] = await db
      .insert(users)
      .values({ name: u.name, email: u.email, passwordHash, role: u.role, isActive: true })
      .returning();
    map.set(u.email, ins.id);
  }
  return map;
}

/**
 * Insert produk + varian + unit + movement initial + warehouse_stocks.
 * Semua insert multi-row (PGlite lambat utk insert tunggal). Urutan
 * returning() mengikuti urutan array insert (PostgreSQL multi-row).
 */
async function seedProducts(catMap: Map<string, string>, pusatId: string): Promise<void> {
  const existingSkus = new Set(
    (
      await db
        .select({ sku: products.sku })
        .from(products)
        .where(and(isNull(products.deletedAt), inArray(products.sku, SEED_PRODUCTS.map((p) => p.sku))))
    ).map((r) => r.sku as string),
  );

  const prodDefs: { def: (typeof SEED_PRODUCTS)[number]; catId: string }[] = [];
  for (const p of SEED_PRODUCTS) {
    const catId = catMap.get(p.category);
    if (!catId) throw new Error(`Kategori seed tidak ditemukan: ${p.category}`);
    if (existingSkus.has(p.sku)) continue; // skip-if-exists (crash-safe)
    prodDefs.push({ def: p, catId });
  }

  // 1) Produk — satu batch
  const prodRows =
    prodDefs.length > 0
      ? await db
          .insert(products)
          .values(
            prodDefs.map(({ def: p, catId }) => {
              const hasVariants = (p.variants?.length ?? 0) > 0;
              return {
                categoryId: catId,
                name: p.name,
                sku: p.sku,
                barcode: p.barcode ?? null,
                unit: p.unit,
                costPrice: p.cost,
                sellingPrice: p.price,
                stockOnHand: hasVariants ? 0 : toQty(p.stock),
                minStock: toQty(p.minStock ?? 5),
                isActive: true,
                isTaxable: p.taxable ?? true,
                trackStock: p.trackStock ?? true,
                hasVariants,
                expiryDate: p.expiry ?? null,
              };
            }),
          )
          .returning()
      : [];

  // 2) Varian — satu batch; simpan pasangan (varianIdx → productIdx) agar
  //    id varian (returning) bisa dipetakan kembali.
  const variantPlan: { productIdx: number; def: SeedVariant }[] = [];
  for (let pi = 0; pi < prodDefs.length; pi++) {
    for (const v of prodDefs[pi]!.def.variants ?? []) {
      variantPlan.push({ productIdx: pi, def: v });
    }
  }
  const variantRows =
    variantPlan.length > 0
      ? await db
          .insert(productVariants)
          .values(
            variantPlan.map(({ productIdx, def: v }) => ({
              productId: prodRows[productIdx]!.id,
              name: v.name,
              sku: v.sku,
              barcode: v.barcode ?? null,
              costPrice: prodDefs[productIdx]!.def.cost,
              sellingPrice: v.price,
              stockOnHand: toQty(v.stock),
              minStock: toQty(prodDefs[productIdx]!.def.minStock ?? 5),
              isActive: true,
            })),
          )
          .returning()
      : [];

  // 3) Satuan tambahan, warehouse_stocks, movement initial — batch
  const unitInserts: (typeof productUnits.$inferInsert)[] = [];
  const whInserts: (typeof warehouseStocks.$inferInsert)[] = [];
  const initialMovements: (typeof stockMovements.$inferInsert)[] = [];

  for (let pi = 0; pi < prodDefs.length; pi++) {
    const { def: p } = prodDefs[pi]!;
    const prod = prodRows[pi]!;
    const hasVariants = (p.variants?.length ?? 0) > 0;

    whInserts.push({
      warehouseId: pusatId,
      productId: prod.id,
      productVariantId: null,
      quantity: hasVariants ? 0 : toQty(p.stock),
      minStock: toQty(p.minStock ?? 5),
    });
    if (!hasVariants && p.stock > 0) {
      initialMovements.push({
        productId: prod.id,
        type: 'initial',
        quantity: toQty(p.stock),
        beforeQty: 0,
        afterQty: toQty(p.stock),
        reference: 'SEED',
        note: 'Stok awal seed Fase 2',
      });
    }
    for (const u of p.units ?? []) {
      unitInserts.push({
        productId: prod.id,
        unit: u.unit,
        factor: toQty(u.factor),
        sellPrice: Math.round(u.sellPrice),
        isSellable: u.isSellable ?? true,
        isPurchaseUnit: u.isPurchaseUnit ?? false,
        minQty: 1,
      });
    }
  }
  // Varian: id dari variantRows (urutan sama dgn variantPlan)
  let vi = 0;
  for (let pi = 0; pi < prodDefs.length; pi++) {
    const { def: p } = prodDefs[pi]!;
    const prod = prodRows[pi]!;
    for (const v of p.variants ?? []) {
      const vId = variantRows[vi]!.id;
      vi++;
      whInserts.push({
        warehouseId: pusatId,
        productId: prod.id,
        productVariantId: vId,
        quantity: toQty(v.stock),
        minStock: toQty(p.minStock ?? 5),
      });
      if (v.stock > 0) {
        initialMovements.push({
          productId: prod.id,
          productVariantId: vId,
          type: 'initial',
          quantity: toQty(v.stock),
          beforeQty: 0,
          afterQty: toQty(v.stock),
          reference: 'SEED',
          note: 'Stok awal varian (seed Fase 2)',
        });
      }
    }
  }

  if (unitInserts.length > 0) await db.insert(productUnits).values(unitInserts).onConflictDoNothing();
  if (initialMovements.length > 0) await db.insert(stockMovements).values(initialMovements);
  if (whInserts.length > 0) await db.insert(warehouseStocks).values(whInserts).onConflictDoNothing();
}

/* ------------------------------------------------------------------ */
/* Pelanggan & member                                                  */
/* ------------------------------------------------------------------ */
async function seedCustomers(): Promise<{ customerIds: string[]; memberIds: string[] }> {
  const customerIds: string[] = [];
  const memberIds: string[] = [];
  for (let i = 0; i < SEED_CUSTOMERS.length; i++) {
    const name = SEED_CUSTOMERS[i]!;
    const phone = `0812${String(34000000 + i * 137).padStart(8, '0')}`;
    const isMember = i < 10; // 10 member
    const rows = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.phone, phone), isNull(customers.deletedAt)))
      .limit(1);
    let custId = rows[0]?.id;
    if (!custId) {
      const [c] = await db
        .insert(customers)
        .values({ name, phone, email: isMember ? `${name.toLowerCase().replace(/\s+/g, '.')}@example.com` : null, address: `Jl. Contoh No. ${i + 1}, Kota` })
        .returning();
      custId = c.id;
    }
    customerIds.push(custId);
    if (isMember) {
      const mRows = await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.customerId, custId)).limit(1);
      if (!mRows[0]) {
        await db.insert(memberships).values({
          customerId: custId,
          memberCode: `MBR-${String(i + 1).padStart(5, '0')}`,
          tier: i < 3 ? 'gold' : i < 6 ? 'silver' : 'bronze',
          pointsBalance: 0,
          pointsEarnedTotal: 0,
          pointsRedeemedTotal: 0,
          joinedAt: new Date(Date.now() - (60 - i) * 86_400_000),
        });
      }
      memberIds.push(custId);
    }
  }
  return { customerIds, memberIds };
}

/* ------------------------------------------------------------------ */
/* Transaksi (300+ / 60 hari)                                          */
/* ------------------------------------------------------------------ */
interface StockRef {
  key: string; // 'p:<productId>' | 'v:<variantId>' | 'j:<productId>'
  productId: string;
  variantId: string | null;
  name: string;
  sku: string;
  unit: string; // unit dasar
  price: number;
  cost: number;
  taxable: boolean;
  available: number;
}

async function loadStockRefs(): Promise<StockRef[]> {
  const refs: StockRef[] = [];
  const prodRows = await db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      unit: products.unit,
      sellingPrice: products.sellingPrice,
      costPrice: products.costPrice,
      isTaxable: products.isTaxable,
      stockOnHand: products.stockOnHand,
      trackStock: products.trackStock,
      hasVariants: products.hasVariants,
    })
    .from(products)
    .where(isNull(products.deletedAt));
  for (const p of prodRows) {
    if (p.trackStock && !p.hasVariants) {
      refs.push({
        key: `p:${p.id}`,
        productId: p.id,
        variantId: null,
        name: p.name,
        sku: p.sku ?? '',
        unit: p.unit,
        price: Number(p.sellingPrice),
        cost: Number(p.costPrice),
        taxable: p.isTaxable,
        available: Number(p.stockOnHand),
      });
    }
    if (p.trackStock && p.hasVariants) {
      const vRows = await db
        .select({ id: productVariants.id, name: productVariants.name, sku: productVariants.sku, sellingPrice: productVariants.sellingPrice, costPrice: productVariants.costPrice, stockOnHand: productVariants.stockOnHand })
        .from(productVariants)
        .where(and(eq(productVariants.productId, p.id), isNull(productVariants.deletedAt), eq(productVariants.isActive, true)));
      for (const v of vRows) {
        refs.push({
          key: `v:${v.id}`,
          productId: p.id,
          variantId: v.id,
          name: `${p.name} — ${v.name}`,
          sku: v.sku ?? '',
          unit: p.unit,
          price: Number(v.sellingPrice),
          cost: Number(v.costPrice),
          taxable: p.isTaxable,
          available: Number(v.stockOnHand),
        });
      }
    }
  }
  // Produk jasa (track_stock=false): bisa dijual tanpa cek stok (AC-04.1)
  for (const p of prodRows) {
    if (!p.trackStock) {
      refs.push({
        key: `j:${p.id}`,
        productId: p.id,
        variantId: null,
        name: p.name,
        sku: p.sku ?? '',
        unit: p.unit,
        price: Number(p.sellingPrice),
        cost: Number(p.costPrice),
        taxable: p.isTaxable,
        available: Number.MAX_SAFE_INTEGER,
      });
    }
  }
  return refs;
}

interface GenItem {
  ref: StockRef;
  qty: number; // qty satuan penjualan (= unit dasar di seed)
  discountPct?: number;
}

interface PendingItem {
  productId: string;
  productVariantId: string | null;
  unit: string;
  unitFactor: number;
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: number;
  costPrice: number;
  discountAmount: number;
  taxAmount: number;
  lineTotal: number;
  jasa: boolean;
}

interface PendingMovement {
  productId: string;
  productVariantId: string | null;
  type: 'sale_out' | 'cancellation';
  quantity: number;
  beforeQty: number;
  afterQty: number;
  note: string;
  createdAt: Date;
}

interface PendingTx {
  invoiceNumber: string;
  soldAt: Date;
  userId: string;
  customerId: string | null;
  status: 'completed' | 'cancelled';
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  pointsEarned: number;
  pointsRedeemed: number;
  redeemedPointsValue: number;
  method: 'cash' | 'qris' | 'transfer';
  cashReceived: number | null;
  changeAmount: number | null;
  referenceNumber: string | null;
  items: PendingItem[];
  movements: PendingMovement[];
}

function buildItems(refs: StockRef[], stockMap: Map<string, number>): GenItem[] {
  const sellable = refs.filter((r) => {
    const avail = r.key.startsWith('j:') ? Number.MAX_SAFE_INTEGER : (stockMap.get(r.key) ?? 0);
    return avail > 0;
  });
  const count = Math.min(randInt(1, 8), sellable.length);
  const chosen = new Set<number>();
  const items: GenItem[] = [];
  for (let i = 0; i < count; i++) {
    let idx = Math.floor(rnd() * sellable.length);
    let guard = 0;
    while (chosen.has(idx) && guard < 50) {
      idx = Math.floor(rnd() * sellable.length);
      guard++;
    }
    chosen.add(idx);
    const ref = sellable[idx]!;
    const avail = ref.key.startsWith('j:') ? Number.MAX_SAFE_INTEGER : (stockMap.get(ref.key) ?? 0);
    const maxQty = Math.min(5, Math.floor(avail));
    if (maxQty < 1 && !ref.key.startsWith('j:')) continue;
    const qty = ref.key.startsWith('j:') ? randInt(1, 2) : randInt(1, maxQty);
    // qty desimal untuk unit kg/liter (SPEC §5.10: sembako kg)
    const finalQty = ['kg', 'liter', 'L'].includes(ref.unit) && pct(0.15) ? toQty(qty + (pct(0.5) ? 0.5 : 0.25)) : qty;
    items.push({ ref, qty: finalQty, discountPct: pct(0.08) ? randInt(5, 10) : undefined });
  }
  return items;
}

/** Hitung angka transaksi (mirip checkout service — server truth). */
function computeTx(items: GenItem[], redeemPoints: number, isMember: boolean) {
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  const lines = items.map((it) => {
    const lineSubtotal = roundMoney(it.ref.price * it.qty);
    const dAmount = it.discountPct ? Math.min(Math.round((lineSubtotal * it.discountPct) / 100), lineSubtotal) : 0;
    const tax = it.ref.taxable ? taxExclusive(lineSubtotal - dAmount, TAX_RATE) : 0;
    subtotal += lineSubtotal;
    discountTotal += dAmount;
    taxTotal += tax;
    return { item: it, lineSubtotal, dAmount, tax, lineTotal: lineSubtotal - dAmount + tax };
  });
  let redeemedPointsValue = 0;
  let pointsRedeemed = 0;
  if (redeemPoints > 0) {
    const base = subtotal - discountTotal + taxTotal;
    const value = Math.min(redeemPoints * 10, base); // 1 poin = Rp 10 (settings)
    pointsRedeemed = Math.floor(value / 10);
    redeemedPointsValue = pointsRedeemed * 10;
  }
  const total = subtotal - discountTotal + taxTotal - redeemedPointsValue;
  const pointsEarned = isMember ? pointsFrom(total, 1000) : 0;
  return { subtotal, discountTotal, taxTotal, redeemedPointsValue, total, pointsEarned, pointsRedeemed, lines };
}

/**
 * Generate SEMUA transaksi di memori (stok runtime), lalu insert multi-row
 * per tabel — PGlite sangat lambat utk insert tunggal (~45ms/query).
 */
async function generateTransactions(refs: StockRef[], stockMap: Map<string, number>, customerIds: string[], memberIds: string[], userIds: Map<string, string>): Promise<{ completed: number; cancelled: number }> {
  const memberIdSet = new Set(memberIds);
  const membershipIdByCust = new Map<string, string>();
  const memberBalance = new Map<string, number>();
  if (memberIds.length > 0) {
    const rows = await db.select({ customerId: memberships.customerId, id: memberships.id, balance: memberships.pointsBalance }).from(memberships).where(inArray(memberships.customerId, memberIds));
    for (const r of rows) {
      membershipIdByCust.set(r.customerId, r.id);
      memberBalance.set(r.customerId, Number(r.balance));
    }
  }

  const txs: PendingTx[] = [];
  const dayCounter = new Map<string, number>();
  // 2 transaksi void (SPEC §5.10): hari acak awal & akhir rentang
  const cancelledSlots = new Set<number>([randInt(5, DAYS_BACK - 21), randInt(DAYS_BACK - 20, DAYS_BACK - 1)]);

  for (let d = DAYS_BACK - 1; d >= 0; d--) {
    const dayStart = dayStartUtc(d);
    const dayKey = yyyymmddWib(dayStart);
    const n = randInt(4, 7); // 4–7 transaksi/hari → ~330 total
    const slots: { hour: number; minute: number }[] = [];
    for (let i = 0; i < n; i++) slots.push({ hour: randInt(8, 20), minute: randInt(0, 59) });
    slots.sort((a, b) => a.hour * 60 + a.minute - b.hour * 60 + b.minute);

    for (let i = 0; i < n; i++) {
      const isCancelled = cancelledSlots.has(d) && i === 2;
      const soldAt = wibToUtc(dayStart, slots[i]!.hour, slots[i]!.minute);
      const items = buildItems(refs, stockMap);
      if (items.length === 0) continue;

      let customerId: string | null = null;
      if (pct(0.4)) customerId = pick(customerIds);
      const isMember = customerId !== null && memberIdSet.has(customerId);

      let redeemPoints = 0;
      if (isMember && !isCancelled && pct(0.12)) {
        const bal = memberBalance.get(customerId!) ?? 0;
        if (bal > 0) redeemPoints = Math.min(bal, randInt(10, Math.max(11, Math.min(bal, 100))));
      }

      const calc = computeTx(items, redeemPoints, isMember);
      const method: 'cash' | 'qris' | 'transfer' = rnd() < 0.6 ? 'cash' : rnd() < 0.85 ? 'qris' : 'transfer';
      let cashReceived: number | null = null;
      let changeAmount: number | null = null;
      let referenceNumber: string | null = null;
      if (method === 'cash') {
        cashReceived = Math.ceil(calc.total / 5000) * 5000 + (pct(0.5) ? 5000 : 0);
        changeAmount = cashReceived - calc.total;
      } else {
        referenceNumber = `${method === 'qris' ? 'QR' : 'TRF'}${soldAt.getTime().toString(36).toUpperCase()}${randInt(100, 999)}`;
      }

      const seq = (dayCounter.get(dayKey) ?? 0) + 1;
      dayCounter.set(dayKey, seq);
      const invoiceNumber = `TRX-${dayKey}-${String(seq).padStart(4, '0')}`;

      const userEmail = pct(0.15) ? 'manager@fakhripos.local' : pct(0.5) ? 'kasir1@fakhripos.local' : 'kasir2@fakhripos.local';
      const firstUserId = userIds.values().next().value as string;
      const userId = userIds.get(userEmail) ?? firstUserId;

      const movements: PendingMovement[] = [];
      const pendingItems: PendingItem[] = [];
      for (const l of calc.lines) {
        const it = l.item;
        const jasa = it.ref.key.startsWith('j:');
        pendingItems.push({
          productId: it.ref.productId,
          productVariantId: it.ref.variantId,
          unit: it.ref.unit,
          unitFactor: 1,
          productName: it.ref.name,
          productSku: it.ref.sku,
          quantity: it.qty,
          unitPrice: it.ref.price,
          costPrice: it.ref.cost,
          discountAmount: l.dAmount,
          taxAmount: l.tax,
          lineTotal: l.lineTotal,
          jasa,
        });
        if (jasa) continue; // jasa: TANPA movement (AC-04.1)
        const before = stockMap.get(it.ref.key) ?? 0;
        const qtyStock = toQty(it.qty);
        movements.push({
          productId: it.ref.productId,
          productVariantId: it.ref.variantId,
          type: 'sale_out',
          quantity: qtyStock,
          beforeQty: before,
          afterQty: toQty(before - qtyStock),
          note: invoiceNumber,
          createdAt: soldAt,
        });
        stockMap.set(it.ref.key, toQty(before - qtyStock));
        if (isCancelled) {
          const beforeC = stockMap.get(it.ref.key) ?? 0;
          movements.push({
            productId: it.ref.productId,
            productVariantId: it.ref.variantId,
            type: 'cancellation',
            quantity: qtyStock,
            beforeQty: beforeC,
            afterQty: toQty(beforeC + qtyStock),
            note: `Void ${invoiceNumber}`,
            createdAt: new Date(soldAt.getTime() + 60_000),
          });
          stockMap.set(it.ref.key, toQty(beforeC + qtyStock));
        }
      }

      if (isMember && !isCancelled) {
        const bal = memberBalance.get(customerId!) ?? 0;
        memberBalance.set(customerId!, bal + calc.pointsEarned - calc.pointsRedeemed);
      }

      txs.push({
        invoiceNumber,
        soldAt,
        userId,
        customerId: isCancelled ? null : customerId,
        status: isCancelled ? 'cancelled' : 'completed',
        subtotal: calc.subtotal,
        discountTotal: calc.discountTotal,
        taxTotal: calc.taxTotal,
        total: calc.total,
        pointsEarned: isCancelled ? 0 : calc.pointsEarned,
        pointsRedeemed: isCancelled ? 0 : calc.pointsRedeemed,
        redeemedPointsValue: isCancelled ? 0 : calc.redeemedPointsValue,
        method,
        cashReceived,
        changeAmount,
        referenceNumber,
        items: pendingItems,
        movements,
      });
    }
  }

  // ---- Batch insert per tabel ----
  const txRows =
    txs.length > 0
      ? await db
          .insert(transactions)
          .values(
            txs.map((t) => ({
              invoiceNumber: t.invoiceNumber,
              outletId: 1,
              customerId: t.customerId,
              userId: t.userId,
              status: t.status,
              subtotal: t.subtotal,
              discountTotal: t.discountTotal,
              taxTotal: t.taxTotal,
              total: t.total,
              pointsEarned: t.pointsEarned,
              pointsRedeemed: t.pointsRedeemed,
              redeemedPointsValue: t.redeemedPointsValue,
              paymentStatus: (t.status === 'cancelled' ? 'refunded' : 'paid') as 'refunded' | 'paid',
              notes: t.status === 'cancelled' ? 'Void seed (data test): transaksi dibatalkan' : null,
              soldAt: t.soldAt,
              createdAt: t.soldAt,
              updatedAt: t.soldAt,
            })),
          )
          .returning()
      : [];

  const itemsAll: (typeof transactionItems.$inferInsert)[] = [];
  const movAll: (typeof stockMovements.$inferInsert)[] = [];
  const payAll: (typeof payments.$inferInsert)[] = [];
  const pointAll: (typeof pointMovements.$inferInsert)[] = [];
  const memberDelta = new Map<string, { earn: number; redeem: number }>();

  for (let i = 0; i < txs.length; i++) {
    const t = txs[i]!;
    const trx = txRows[i]!;
    for (const it of t.items) {
      itemsAll.push({
        transactionId: trx.id,
        productId: it.productId,
        productVariantId: it.productVariantId,
        unit: it.unit,
        unitFactor: it.unitFactor,
        productName: it.productName,
        productSku: it.productSku,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        costPrice: it.costPrice,
        discountAmount: it.discountAmount,
        taxAmount: it.taxAmount,
        lineTotal: it.lineTotal,
        createdAt: t.soldAt,
      });
    }
    for (const m of t.movements) {
      movAll.push({
        productId: m.productId,
        productVariantId: m.productVariantId,
        type: m.type,
        quantity: m.quantity,
        beforeQty: m.beforeQty,
        afterQty: m.afterQty,
        transactionId: trx.id,
        note: m.note,
        createdAt: m.createdAt,
      });
    }
    payAll.push({
      transactionId: trx.id,
      outletId: 1,
      type: 'sale',
      method: t.method,
      amount: t.total,
      cashReceived: t.cashReceived,
      changeAmount: t.changeAmount,
      referenceNumber: t.referenceNumber,
      status: 'paid',
      paidAt: t.soldAt,
      createdBy: t.userId,
    });
    if (t.status === 'cancelled') {
      payAll.push({
        transactionId: trx.id,
        outletId: 1,
        type: 'refund',
        method: t.method,
        amount: t.total,
        status: 'paid',
        paidAt: new Date(t.soldAt.getTime() + 120_000),
        createdBy: t.userId,
      });
    }
    if (t.customerId && t.pointsEarned > 0) {
      const mId = membershipIdByCust.get(t.customerId);
      if (mId) {
        pointAll.push({ membershipId: mId, transactionId: trx.id, type: 'earned', points: t.pointsEarned, balanceAfter: 0, createdAt: t.soldAt });
        const d = memberDelta.get(t.customerId) ?? { earn: 0, redeem: 0 };
        d.earn += t.pointsEarned;
        memberDelta.set(t.customerId, d);
      }
    }
    if (t.customerId && t.pointsRedeemed > 0) {
      const mId = membershipIdByCust.get(t.customerId);
      if (mId) {
        pointAll.push({ membershipId: mId, transactionId: trx.id, type: 'redeemed', points: -t.pointsRedeemed, balanceAfter: 0, createdAt: t.soldAt });
        const d = memberDelta.get(t.customerId) ?? { earn: 0, redeem: 0 };
        d.redeem += t.pointsRedeemed;
        memberDelta.set(t.customerId, d);
      }
    }
  }

  if (itemsAll.length > 0) await db.insert(transactionItems).values(itemsAll);
  if (movAll.length > 0) await db.insert(stockMovements).values(movAll);
  if (payAll.length > 0) await db.insert(payments).values(payAll);

  // Saldo member: update per member + balanceAfter point_movements
  const pointFinal: (typeof pointMovements.$inferInsert)[] = [];
  for (const [custId, d] of memberDelta) {
    const mId = membershipIdByCust.get(custId);
    if (!mId) continue;
    const [m] = await db
      .update(memberships)
      .set({
        pointsBalance: sql`${memberships.pointsBalance} + ${d.earn - d.redeem}`,
        pointsEarnedTotal: sql`${memberships.pointsEarnedTotal} + ${d.earn}`,
        pointsRedeemedTotal: sql`${memberships.pointsRedeemedTotal} + ${d.redeem}`,
      })
      .where(eq(memberships.id, mId))
      .returning({ balance: memberships.pointsBalance });
    const balanceAfter = Number(m?.balance ?? 0);
    for (const p of pointAll) {
      if (p.membershipId === mId) pointFinal.push({ ...p, balanceAfter });
    }
  }
  if (pointFinal.length > 0) await db.insert(pointMovements).values(pointFinal);

  let completed = 0;
  let cancelled = 0;
  for (const t of txs) {
    if (t.status === 'cancelled') cancelled++;
    else completed++;
  }
  return { completed, cancelled };
}

/**
 * Tulis kembali stok akhir (runtime) ke products / product_variants DAN
 * warehouse_stocks (GUD-PUSAT) — invariant (d) Σ gudang = stock_on_hand.
 * Multi-row UPDATE via VALUES (PGlite lambat utk update tunggal).
 */
async function writeBackStock(stockMap: Map<string, number>): Promise<void> {
  const prodPairs: [string, number][] = [];
  const varPairs: [string, number][] = [];
  for (const [key, qty] of stockMap) {
    const id = key.slice(2);
    if (key.startsWith('p:')) prodPairs.push([id, toQty(qty)]);
    else if (key.startsWith('v:')) varPairs.push([id, toQty(qty)]);
  }
  if (prodPairs.length > 0) {
    await client`update products set stock_on_hand = v.qty::numeric from (values ${client(prodPairs)}) as v(id, qty) where products.id = v.id::uuid`;
    await client`update warehouse_stocks set quantity = v.qty::numeric from (values ${client(prodPairs)}) as v(id, qty)
                 where warehouse_stocks.product_id = v.id::uuid and warehouse_stocks.product_variant_id is null`;
  }
  if (varPairs.length > 0) {
    await client`update product_variants set stock_on_hand = v.qty::numeric from (values ${client(varPairs)}) as v(id, qty) where product_variants.id = v.id::uuid`;
    await client`update warehouse_stocks set quantity = v.qty::numeric from (values ${client(varPairs)}) as v(id, qty)
                 where warehouse_stocks.product_variant_id = v.id::uuid`;
  }
}

/* ------------------------------------------------------------------ */
/* Self-check (SPEC §5.12 — exit ≠ 0 bila gagal)                       */
/* ------------------------------------------------------------------ */
async function selfCheck(completed: number): Promise<void> {
  void completed;
  const errors: string[] = [];

  const prodCount = Number((await db.execute(sql`SELECT count(*)::int AS c FROM products WHERE deleted_at IS NULL`))[0].c);
  if (prodCount < 60 || prodCount > 80) errors.push(`(a) jumlah produk ${prodCount} di luar 60–80`);
  const txCount = Number((await db.execute(sql`SELECT count(*)::int AS c FROM transactions WHERE status = 'completed'`))[0].c);
  if (txCount < 300) errors.push(`(b) transaksi completed ${txCount} < 300`);

  // (c) net movement = stok akhir per produk & varian
  const movs = await db.execute(sql`
    SELECT product_id, product_variant_id,
           sum(CASE WHEN type IN ('initial','purchase_in','return_in','cancellation') THEN quantity
                    WHEN type = 'sale_out' THEN -quantity
                    WHEN type = 'adjustment' THEN after_qty - before_qty
                    ELSE 0 END)::numeric AS net
    FROM stock_movements GROUP BY product_id, product_variant_id`);
  const netMap = new Map<string, number>();
  for (const r of movs) {
    const key = `${r.product_id}:${r.product_variant_id ?? ''}`;
    netMap.set(key, Number(netMap.get(key) ?? 0) + Number(r.net));
  }
  const prodRows = await db.execute(sql`SELECT id, stock_on_hand FROM products WHERE track_stock = true`);
  for (const p of prodRows) {
    const net = netMap.get(`${p.id}:`) ?? 0;
    if (Math.abs(net - Number(p.stock_on_hand)) > 0.001) errors.push(`(c) produk ${p.id}: net movement ${net} ≠ stok akhir ${p.stock_on_hand}`);
  }
  const varRows = await db.execute(sql`SELECT id, product_id, stock_on_hand FROM product_variants WHERE deleted_at IS NULL`);
  for (const v of varRows) {
    const net = netMap.get(`${v.product_id}:${v.id}`) ?? 0;
    if (Math.abs(net - Number(v.stock_on_hand)) > 0.001) errors.push(`(c) varian ${v.id}: net ${net} ≠ stok akhir ${v.stock_on_hand}`);
  }

  // (d) Σ warehouse_stocks = stock_on_hand
  const whSum = await db.execute(sql`
    SELECT product_id, product_variant_id, sum(quantity)::numeric AS qty
    FROM warehouse_stocks GROUP BY product_id, product_variant_id`);
  const whMap = new Map<string, number>();
  for (const r of whSum) whMap.set(`${r.product_id}:${r.product_variant_id ?? ''}`, Number(r.qty));
  for (const p of prodRows) {
    if ((whMap.get(`${p.id}:`) ?? 0) !== Number(p.stock_on_hand)) errors.push(`(d) produk ${p.id}: Σ gudang ≠ stock_on_hand`);
  }
  for (const v of varRows) {
    if ((whMap.get(`${v.product_id}:${v.id}`) ?? 0) !== Number(v.stock_on_hand)) errors.push(`(d) varian ${v.id}: Σ gudang ≠ stock_on_hand`);
  }

  // (e) tidak ada stok negatif
  const negP = Number((await db.execute(sql`SELECT count(*)::int AS c FROM products WHERE stock_on_hand < 0`))[0].c);
  const negV = Number((await db.execute(sql`SELECT count(*)::int AS c FROM product_variants WHERE stock_on_hand < 0`))[0].c);
  if (negP + negV > 0) errors.push(`(e) stok negatif ditemukan (produk ${negP}, varian ${negV})`);

  // (f) invoice unik
  const dupInv = Number((await db.execute(sql`SELECT count(*)::int AS c FROM (SELECT invoice_number FROM transactions GROUP BY invoice_number HAVING count(*) > 1) d`))[0].c);
  if (dupInv > 0) errors.push(`(f) ${dupInv} invoice duplikat`);

  // (g) formula total
  const badTotal = Number((await db.execute(sql`SELECT count(*)::int AS c FROM transactions WHERE total <> subtotal - discount_total + tax_total - redeemed_points_value`))[0].c);
  if (badTotal > 0) errors.push(`(g) ${badTotal} transaksi dengan total tidak konsisten`);

  // AC-07.5: ≥5 produk jasa tanpa sale_out
  const jasa = Number((await db.execute(sql`
    SELECT count(*)::int AS c FROM products p
    WHERE p.track_stock = false AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.product_id = p.id AND m.type = 'sale_out')`))[0].c);
  if (jasa < 5) errors.push(`AC-07.5: produk jasa tanpa sale_out hanya ${jasa}`);

  if (errors.length > 0) {
    console.error('[seed] SELF-CHECK GAGAL:');
    for (const e of errors) console.error('  ✗', e);
    process.exit(1);
  }
  console.log(`[seed] self-check OK (produk ${prodCount}, transaksi completed ${txCount}, jasa ${jasa}, net & gudang konsisten).`);
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */
async function main(): Promise<void> {
  const t0 = Date.now();
  if (env.NODE_ENV === 'production' && !env.SEED_DEMO) {
    console.error('[seed] DITOLAK: seed hanya untuk dev/demo. Set SEED_DEMO=true untuk memaksa di produksi (SPEC §8.2.9).');
    process.exit(1);
  }

  // Idempotensi: marker versi (SPEC §7.2.7) — jsonb mengembalikan objek
  const marker = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, 'seed.fase2.version')).limit(1);
  const markerVersion = (marker[0]?.value as { version?: string } | null)?.version;
  if (markerVersion === SEED_VERSION && !FORCE) {
    const counts = await db.execute(sql`
      SELECT (SELECT count(*)::int FROM products WHERE deleted_at IS NULL) AS products,
             (SELECT count(*)::int FROM transactions) AS transactions`);
    console.log(`[seed] skip — seed Fase 2 v${SEED_VERSION} sudah ada (${counts[0].products} produk, ${counts[0].transactions} transaksi).`);
    console.log('[seed] Jalankan ulang dengan --force untuk reset lalu seed ulang.');
    await client.end();
    return;
  }

  if (FORCE) await forceCleanup();

  console.log(`[seed] mulai seed Fase 2 v${SEED_VERSION} (${SEED_PRODUCTS.length} produk, ${DAYS_BACK} hari transaksi)...`);
  const catMap = await seedCategories();
  const pusatId = await seedWarehouses();
  const userMap = await seedUsers();
  await seedProducts(catMap, pusatId);
  const { customerIds, memberIds } = await seedCustomers();

  // Stok runtime (dari DB — aman untuk run parsial)
  const refs = await loadStockRefs();
  const stockMap = new Map<string, number>();
  for (const r of refs) {
    if (!r.key.startsWith('j:')) stockMap.set(r.key, r.available);
  }

  const { completed, cancelled } = await generateTransactions(refs, stockMap, customerIds, memberIds, userMap);

  // Stok akhir runtime → DB (produk/varian + warehouse_stocks)
  await writeBackStock(stockMap);

  await db
    .insert(settings)
    .values({ key: 'seed.fase2.version', value: { version: SEED_VERSION }, description: 'Penanda idempotensi seed Fase 2' })
    .onConflictDoUpdate({ target: settings.key, set: { value: { version: SEED_VERSION } } });

  // Self-check wajib
  await selfCheck(completed);

  const summary = await db.execute(sql`
    SELECT (SELECT count(*)::int FROM products WHERE deleted_at IS NULL) AS products,
           (SELECT count(*)::int FROM product_variants WHERE deleted_at IS NULL) AS variants,
           (SELECT count(*)::int FROM product_units) AS units,
           (SELECT count(*)::int FROM customers WHERE deleted_at IS NULL) AS customers,
           (SELECT count(*)::int FROM transactions WHERE status = 'completed') AS transactions,
           (SELECT count(*)::int FROM warehouses WHERE deleted_at IS NULL) AS warehouses,
           (SELECT coalesce(sum(total), 0)::bigint FROM transactions WHERE status = 'completed') AS revenue`);
  const s = summary[0] as Record<string, unknown>;
  const n = (v: unknown): number => Number(v ?? 0);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('==============================================================');
  console.log('[seed] RINGKASAN (Fase 2):');
  console.log(`  produk        : ${n(s.products)} (target 60–80)`);
  console.log(`  varian        : ${n(s.variants)}`);
  console.log(`  satuan        : ${n(s.units)}`);
  console.log(`  pelanggan     : ${n(s.customers)} (member ${memberIds.length})`);
  console.log(`  transaksi     : ${n(s.transactions)} completed + ${cancelled} cancelled (total ${n(s.transactions) + cancelled}, target ≥300)`);
  console.log(`  gudang        : ${n(s.warehouses)} (GUD-PUSAT memegang seluruh stok)`);
  console.log(`  total pendapatan: Rp ${n(s.revenue).toLocaleString('id-ID')}`);
  console.log(`  user demo     : admin/manager/kasir1/kasir2 @fakhripos.local — password ${SEED_PASSWORD}`);
  console.log(`  waktu         : ${elapsed}s`);
  console.log('[seed] selesai ✓');
  await client.end();
}

main().catch((err) => {
  console.error('[seed] GAGAL:', err);
  process.exit(1);
});
