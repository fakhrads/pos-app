"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Confirmation dialog untuk aksi merusak (P5)
 * 
 * Contoh:
 * - "Hapus produk Indomie Goreng? Stok 24 bungkus akan ikut hilang."
 * - "Batalkan transaksi #047? Stok akan dikembalikan."
 * 
 * Selalu tampilkan:
 * 1. Apa yang terjadi
 * 2. Dampaknya (stok hilang, uang dikembalikan, dll)
 * 3. Oksi batalkan
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "Ya, Lanjutkan",
  cancelText = "Batal",
  variant = "destructive",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "destructive" | "default";
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelText}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={
              variant === "destructive"
                ? "bg-danger text-danger-fg hover:bg-danger/90"
                : ""
            }
          >
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Contoh penggunaan:
 * 
 * <ConfirmDialog
 *   open={showDeleteConfirm}
 *   onOpenChange={setShowDeleteConfirm}
 *   title="Hapus produk Indomie Goreng?"
 *   description="Stok 24 bungkus akan ikut hilang dari semua gudang. Tindakan ini tidak bisa dibatalkan."
 *   confirmText="Ya, Hapus"
 *   onConfirm={handleDelete}
 * />
 */
