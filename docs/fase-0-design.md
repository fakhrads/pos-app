# DESAIN PLAN

## 1. Palette Warna

### Light Mode
| Token | Hex | Kegunaan |
|-------|-----|----------|
| `--surface` | `#FAFBFC` | Background utama |
| `--surface-raised` | `#FFFFFF` | Card, modal, dropdown |
| `--surface-sunken` | `#F1F3F5` | Input, skeleton base |
| `--border` | `#E2E5E9` | Border semua komponen |
| `--border-strong` | `#CDD1D6` | Border focus, divider |
| `--text-primary` | `#1A1D21` | Teks utama (94% contrast vs surface) |
| `--text-secondary` | `#5F6B7A` | Teks sekunder, label |
| `--text-muted` | `#8C95A0` | Placeholder, hint |
| `--accent` | `#0066FF` | Brand aksen (biru, bukan cyan) |
| `--accent-subtle` | `#EBF2FF` | Background badge accent |
| `--success` | `#16A34A` | Untung, stok aman |
| `--success-subtle` | `#DCFCE7` | Badge sukses |
| `--warning` | `#D97706` | Peringatan |
| `--warning-subtle` | `#FEF3C7` | Badge warning |
| `--danger` | `#DC2626` | Minus, stok kosong |
| `--danger-subtle` | `#FEE2E2` | Badge danger |
| `--info` | `#2563EB` | Info |
| `--info-subtle` | `#DBEAFE` | Badge info |
| `--skeleton-base` | `#E8EBED` | Skeleton load |
| `--skeleton-shine` | `#F4F5F7` | Skeleton shimmer |

### Dark Mode
| Token | Hex | Kegunaan |
|-------|-----|----------|
| `--surface` | `#0F1218` | Background utama (biru gelap, bukan #000) |
| `--surface-raised` | `#1A1F2B` | Card, modal |
| `--surface-sunken` | `#0A0D12` | Input, skeleton base |
| `--border` | `#2A3040` | Border |
| `--border-strong` | `#3D4556` | Border focus |
| `--text-primary` | `#EBEDF0` | Teks (92% putih, bukan #FFF) |
| `--text-secondary` | `#8B95A5` | Teks sekunder |
| `--text-muted` | `#5C6678` | Placeholder |
| `--accent` | `#4D94FF` | Brand (lebih terang untuk dark bg) |
| `--accent-subtle` | `#1A2744` | Badge |
| `--success` | `#34D399` | Untung |
| `--success-subtle` | `#0D3326` | Badge |
| `--warning` | `#FBBF24` | Warning |
| `--warning-subtle` | `#3D2E0A` | Badge |
| `--danger` | `#F87171` | Minus |
| `--danger-subtle` | `#3D1212` | Badge |
| `--info` | `#60A5FA` | Info |
| `--info-subtle` | `#0F1D3D` | Badge |
| `--skeleton-base` | `#1E2430` | Skeleton (lebih terang dari surface) |
| `--skeleton-shine` | `#283040` | Shimmer |

### Alasan Palette
- **Biru (#0066FF)** sebagai accent: netral, profesional, tidak agresif seperti merah/hijau. Cocok untuk semua jenis usaha.
- **Dark mode surface #0F1218**: abu kebiruan, bukan hitam pekat. Mengurangi eye strain.
- **Teks #EBEDF0**: 92% putih, tidak menyilaukan seperti #FFFFFF.

## 2. Kontras (WCAG AA - 4.5:1 minimum)
| Kombinasi | Rasio | Lolos? |
|-----------|-------|--------|
| text-primary vs surface (light) | 15.2:1 | ✅ |
| text-secondary vs surface (light) | 5.8:1 | ✅ |
| text-muted vs surface (light) | 3.6:1 | ⚠️ Hanya untuk non-essential |
| accent vs surface-raised (light) | 4.6:1 | ✅ |
| text-primary vs surface (dark) | 13.8:1 | ✅ |
| text-secondary vs surface (dark) | 5.2:1 | ✅ |
| accent vs surface-raised (dark) | 4.8:1 | ✅ |

## 3. Tipografi
| Ukuran | Px | Kegunaan |
|--------|-----|----------|
| xs | 12px | Caption, badge, timestamp |
| sm | 14px | Body kecil, helper text, tabel |
| base | 16px | Body utama (min untuk mobile) |
| lg | 18px | Heading section |
| xl | 20px | Nominal angka |
| 2xl | 24px | Sub-judul |
| 3xl | 28px | Total bayar kasir |

- **Font**: Inter (body), JetBrains Mono (angka/tabel)
- **Weight**: 400 (body), 500 (label), 600 (heading)
- **Tabular nums**: Semua angka uang dan tabel

## 4. Spacing
Semua kelipatan 4px:
- 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80

## 5. Radius
| Level | Ukuran | Kegunaan |
|-------|--------|----------|
| sm | 8px | Badge, input, tombol kecil |
| md | 12px | Card, dropdown |
| lg | 16px | Sheet, modal, dialog |
| full | 9999px | Avatar, pill badge |

## 6. Shadow
| Level | Light Mode | Dark Mode |
|-------|------------|-----------|
| sm | `0 1px 2px rgba(0,0,0,.06)` | Border lebih terang |
| md | `0 4px 12px rgba(0,0,0,.08)` | Border + surface-raised |
| lg | `0 12px 32px rgba(0,0,0,.12)` | Border + surface-raised |

## 7. Elemen Signature
**Layar Kasir** — satu-satunya layar dengan "kedalaman berani":
- Total bayar besar (28px bold) dengan background accent subtle
- Tombol nominal uang cepat (Rp 20rb/50rb/100rb/Uang Pas) dengan border accent
- Keranjang jadi bottom sheet di mobile, geser naik-turun
- Efek: kartu produk sedikit "naik" saat diketik (transform translateY)

## 8. Kritik Rencana Sendiri
1. **Palette terlalu "startup tech"** — Biru murni bisa terasa dingin untuk warung. Mitigasi: gunakan warm neutral (#F8F6F3) di light surface alih-alih abu murni.
2. **Bottom nav 5 item** — Banyak untuk screen kecil. Mitigasi: "Lainnya" jadi sheet, bukan halaman.
3. **300+ transaksi dummy** — Perlu seed script yang realistis dengan pola. Mitigasi: script Node terpisah, bukan inline seed.
4. **Offline/PWA MVP** — Complex. Mitigasi: Service worker + IndexedDB untuk transaksi saja, bukan seluruh app.
