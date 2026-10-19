# Elts. Photography

Fondasi **Photography Portfolio + Private Client Gallery + Admin Dashboard**.

**Rilis terbaru: `v2.2.1`.** Admin shell, galeri klien privat, portal kru, dan
invoice PDF sudah berjalan di atas Supabase hosted.
Lihat [Arsitektur rilis v2.2.1](#arsitektur-rilis-v221).

## Jalankan

Node.js 22 atau lebih baru, npm.

```powershell
npm ci
Copy-Item .env.example .env.local
# Isi INVOICE_PDF_SECRET (>= 32 karakter) di .env.local sebelum memakai invoice PDF.
npm run dev
```

Buka `http://127.0.0.1:3000`. Homepage berjalan tanpa kredensial Supabase, tetapi
`/admin`, galeri klien, dan `/crew/[token]` memerlukannya.
Nomor WhatsApp saat ini: **6280000000000**, sesuai nomor yang diberikan pemilik.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

## Yang tersedia

- Next.js 16.3.5 App Router, React, TypeScript strict, Tailwind CSS v4.
- Fondasi shadcn/ui: token tema, Button/Slot/CVA, Skeleton, Radix Dialog, alias dan `components.json`.
- Homepage editorial responsif: hero, about, lima layanan, featured carousel/lightbox, CTA dan footer.
- Lightbox dengan keyboard, focus trap, swipe; mobile navigation; reduced motion.
- Booking WhatsApp dengan pesan sesuai layanan.
- Metadata, Open Graph, Twitter Card, sitemap, robots, favicon; font di-host lokal.
- Sembilan migration PostgreSQL (`0001`–`0009`) untuk tabel, RLS berjenjang, Storage privat, siklus token kru, dan proyeksi kolom.
- Admin shell berbasis peran (FOUNDER/ADMIN/WORKER), console proyek, inventory, invoice, kalender dan dashboard eksekutif.
- Galeri klien privat dengan PIN scrypt + pepper, sesi bertoken, dan gateway media terautentikasi.
- Portal kru `/crew/[token]` tanpa login: tawaran tugas, check-in lapangan, fee slip.
- Invoice PDF bertanda tangan HMAC SHA-256 di `/api/invoices/[id]/pdf`.
- Tes PostgreSQL in-memory atas SQL asli, RLS, isolasi project, limiter dan lifecycle akses.
- GitHub Actions untuk lint, typecheck, test dan build.

## Batas saat ini

`/` adalah homepage lengkap. Tautan Portfolio, Services, About, dan Contact menuju section homepage; halaman terpisah ada dalam rencana route.
Migration **sudah diterapkan** ke Supabase hosted (lihat `npm run migrate`).
Yang belum ada: deployment Vercel, repository GitHub terhubung, dan unggah media resumable.

`INVOICE_PDF_SECRET` (≥ 32 karakter) wajib diisi di setiap environment; tanpa nilai
yang sah, route PDF menolak dengan `503` dan tidak pernah menandatangani dengan kunci kosong.

Foto yang disertakan adalah **preview publik yang sudah dikecilkan**, bukan file customer/original. Ganti dengan portfolio Elts. yang sudah mendapat izin publikasi sebelum peluncuran. Footer menandai status gambar contoh. Akun Instagram tidak ditampilkan sampai URL yang benar tersedia.

## Arsitektur rilis v2.2.1

Rilis ini menutup satu kelas cacat otorisasi: **UI menyembunyikan sebuah
permukaan, tetapi route dan lapisan data tetap menyajikannya.** Setiap batas di
bawah kini ditegakkan dua kali — penjaga route dan database — sehingga regresi
di salah satunya tidak otomatis menjadi kebocoran.

### 1. RBAC yang diperkuat dan model data tanpa kebocoran

- **`0007_rbac_access_repair`** — mengembalikan `USAGE` dan `EXECUTE` untuk role
  `authenticated` pada schema `private`. Tanpa ini setiap evaluasi RLS atas
  `private.has_role_rank()` gagal dengan *permission denied*, sehingga seluruh
  policy menolak baris. Migration ini menutup dengan blok `DO` yang melempar
  error bila grant hilang, agar cacat yang sama tidak bisa masuk lagi diam-diam.
- **`0009_inventory_worker_projection`** — memperkenalkan
  `v_inventory_assets_for_caller`, yang mengubah `replacement_value` dan
  `daily_rental_rate` menjadi `NULL` untuk role di bawah `ADMIN` (Rank < 80).
  Pakai view karena grant kolom bersifat per-role, sedangkan seluruh staf
  adalah `authenticated` yang sama.
- **Proyeksi per-rank di lapisan aplikasi** — `/admin/projects` menyusun
  `SELECT` berdasarkan rank, sehingga `contract_value` dan `dp_amount` tidak
  pernah masuk payload `WORKER`. Kolomnya **tidak dikirim sama sekali**, bukan
  disembunyikan di JSX — menyembunyikan sel tetap mengirim nilainya di payload RSC.
- **Penjaga batas yang ramah** — penjaga halaman (`requirePageRole`,
  `requirePageOps`, `requirePageStaff`, `requirePageFounder`) memancarkan `307`
  ke `/admin?denied=unauthorized`. Penolakan wewenang bukan error 500, dan
  parameter `denied` bernilai tetap sehingga tidak membocorkan path internal.
  `requireRole()` sengaja tetap *throw* karena Server Action mengandalkan
  penolakan itu untuk mengembalikan `{ success, error }`.
- **Preservasi receiver RPC** — memperbaiki *prototype detachment*: `const rpc =
  supabase.rpc` melepaskan method dari `this`, sehingga pemanggilan gagal dengan
  `Cannot read properties of undefined (reading 'rest')` sebelum request HTTP
  dibuat. Pemanggilan kini lewat `Function.prototype.call` yang mempertahankan
  receiver.

### 2. Workspace operasional sesuai Tupoksi

| Peran | Rank | Cakupan |
|---|---:|---|
| `SUPER_ADMIN` / `FOUNDER` | 120 / 100 | Telemetri eksekutif, penyelesaian ledger, pengguna, audit |
| `ADMIN` | 80 | Dispatch proyek, penjadwalan gear, penerbitan invoice. Treasury dan administrasi pengguna **tertutup seluruhnya** |
| `WORKER` | 60 | Hanya `Hari Ini`, `Kalender`, `Proyek`, `Post-Produksi`. Tanpa metrik finansial di DOM |
| `FREELANCER` | 30 | Portal `/crew/[token]` terisolasi. Tanpa route admin shell, manifest gear, atau kontak klien |

Middleware memetakan `/admin/finance` dan `/admin/users` ke rank `100`, sisanya
ke rank `60`, dan menyelesaikan rank lewat `public.get_caller_role()` — fungsi
yang sama yang dipakai penjaga halaman, sehingga keduanya tidak bisa berbeda
pendapat.

### 3. Siklus hidup freelancer dan token sekali pakai

`0008_crew_token_lifecycle`:

- **State machine** — tawaran bertransisi atomik dengan `SELECT … FOR UPDATE`
  (`PENDING_OFFER` → `ACCEPTED` / `DECLINED`). Aksi berulang mengembalikan
  `ALREADY_RESPONDED`, sehingga tab kedaluwarsa tidak bisa membalik status
  setelah jadwal dikunci.
- **Check-in idempoten** — kehadiran di lokasi mensyaratkan token penugasan yang
  sah, bukan UUID penugasan (UUID muncul di URL admin). Check-in berulang
  mengembalikan timestamp verifikasi pertama tanpa menimpanya.
- **DTO fail-closed** — fallback query service-role di portal kru dihapus. Bila
  RPC gagal, portal menampilkan layar token tidak valid, bukan payload yang
  direkonstruksi tangan.

### 4. Mesin invoice PDF kriptografis

- **Tanda tangan HMAC** — `/api/invoices/[id]/pdf` memverifikasi token HMAC
  SHA-256 sebelum merender.
- **Matriks verifikasi ketat** — token terikat pada `invoiceId` (token invoice A
  ditolak untuk invoice B), request tanpa token atau bertanda tangan salah
  ditolak `401`, dan ID bukan UUID ditolak `400`.
- **Konfigurasi** — memerlukan `INVOICE_PDF_SECRET` (≥ 32 karakter). Bila tidak
  diisi, route gagal tertutup dengan `503` dan tidak pernah menandatangani
  dengan kunci kosong.

### 5. Shell mobile-first dan UI editorial

- **Layout responsif** — di bawah `768px` sidebar diganti bottom navigation
  (~57px: item `min-h-12` + padding + border) dengan `env(safe-area-inset-bottom)`
  agar tidak tertutup home indicator iOS. Tablet memakai rail ikon 72px, desktop
  memakai drawer 256px yang bisa diciutkan dan tersimpan antar-kunjungan.
- **Folder card** — direktori dua mode (`Kartu` / `Tabel`) dengan geometri
  sleeve bertab, lembar dokumen mengintip di belakang kantong, dan strip
  metadata tabular.
- **Kalender operasi proporsional** — grid hari responsif yang beralih ke Agenda
  vertikal di mobile (390px) dan mengembang penuh 7 kolom di desktop.

### Catatan pemutakhiran

1. Terapkan migration berurutan: `0007`, `0008`, `0009`. Ketiganya transaksional
   dan idempoten.
2. **RLS kini benar-benar berjalan.** Server action yang masih memakai
   `createServiceSupabase()` kini tidak lagi punya policy rusak sebagai lapisan
   kedua.
3. `checkInCrewMember()` berubah dari `(assignmentId)` menjadi `(magicToken)`.

Detail lengkap: [Catatan rilis v2.2.0](docs/release-v2.2.0.md).

## Dokumentasi

- [Arsitektur, database, route dan komponen](docs/architecture.md)
- [Setup Supabase, environment, GitHub dan Vercel](docs/setup.md)
- [Atribusi dan sumber foto](docs/asset-sources.md)
- [Catatan verifikasi](docs/verification.md)

## Tahap berikutnya

Selesai sampai `v2.2.1`: admin auth + membership + proxy, Projects/Customers,
client access dengan sesi persisten, private gallery dengan media gateway
terautentikasi, favorites, serta invoice PDF.

Yang tersisa:

1. Direct/resumable upload + background variant processor.
2. Rate limiter klien yang terhubung penuh ke access API.
3. Deployment Vercel dan repository GitHub terhubung.

Setiap tahap memiliki kriteria penerimaan dan pemeriksaan keamanan di dokumen
arsitektur. Analytics dan Download All tetap di luar cakupan.
