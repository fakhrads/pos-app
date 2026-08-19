import type { CartItem } from "@/lib/types";
import { formatNumber } from "@/lib/utils";

/** Kunci baris keranjang: unik per (produk, varian, satuan) */
export function lineKey(item: {
  productId: string;
  variantId?: string | null;
  unit?: string | null;
}): string {
  return `${item.productId}::${item.variantId ?? ""}::${item.unit ?? ""}`;
}

/** Label satuan baris: "1 dus = 12 pcs" (untuk sub-label harga) */
export function unitLabel(item: Pick<CartItem, "unit" | "unitBaseLabel" | "unitFactor">): string {
  const unit = item.unit || "pcs";
  if (item.unitFactor && item.unitFactor > 1 && item.unitBaseLabel) {
    return `1 ${unit} = ${item.unitBaseLabel}`;
  }
  return unit;
}

/** Total qty keranjang (jumlah satuan penjualan) */
export function cartTotalQty(cart: CartItem[]): number {
  return cart.reduce((s, i) => s + i.quantity, 0);
}

/** Label qty × konversi untuk struk/ringkasan, mis. "2 dus × 12 pcs" */
export function qtyTimesLabel(item: Pick<CartItem, "quantity" | "unit" | "unitBaseLabel" | "unitFactor">): string {
  const qty = formatNumber(item.quantity);
  const unit = item.unit || "pcs";
  if (item.unitFactor && item.unitFactor > 1 && item.unitBaseLabel) {
    return `${qty} ${unit} × ${item.unitBaseLabel}`;
  }
  return `${qty} ${unit}`;
}
