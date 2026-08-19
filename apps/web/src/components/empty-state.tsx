import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

/**
 * RC-06 — Empty State yang Mengajarkan
 *
 * Setiap halaman kosong harus menampilkan: ilustrasi + kalimat penjelasan
 * + 1 tombol aksi (SPEC US-06). Tampil sebagai kartu tengah yang ramah.
 *
 * Contoh:
 * "Belum ada produk. Tambah produk pertamamu supaya bisa mulai jualan."
 *   + tombol "Tambah Produk"
 */
export function EmptyState({
  icon,
  title = "Belum ada data",
  description,
  action,
}: {
  icon?: ReactNode;
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground">
        {icon ?? <Inbox className="size-7" />}
      </div>
      <p className="mt-1 text-sm font-semibold text-text-primary">{title}</p>
      {description && (
        <p className="max-w-sm text-xs text-text-secondary">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
