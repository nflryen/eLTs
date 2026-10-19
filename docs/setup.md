# Konfigurasi lingkungan dan deployment

## Development lokal

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

`.env.local` diabaikan Git. Homepage tidak membutuhkan akun database. Font sudah berasal dari package lokal; build tidak mengambil font dari Google. Package versions dipin dan lockfile disertakan.

## Environment

| Variable                                                               | Lokasi           | Fungsi                                                                    |
| ---------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`                                                 | Public           | Canonical origin; localhost hanya untuk development                       |
| `NEXT_PUBLIC_WHATSAPP_NUMBER`                                          | Public           | Digits internasional, saat ini `6280000000000`                            |
| `NEXT_PUBLIC_INSTAGRAM_URL`                                            | Public, opsional | URL Instagram bisnis yang nyata                                           |
| `NEXT_PUBLIC_SUPABASE_URL`                                             | Public           | Supabase project URL                                                      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`                                        | Public           | Anon key; RLS tetap wajib                                                 |
| `SUPABASE_SERVICE_ROLE_KEY`                                            | Server secret    | Restricted server operations; bypass RLS                                  |
| `GALLERY_PIN_PEPPER`                                                   | Server secret    | Pepper ≥32 random bytes; jangan disimpan di database                      |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Server           | Wajib untuk upload dan delivery foto/video galeri; secret hanya di server |

Generate pepper pada environment tepercaya:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Simpan hasil langsung di secret manager/env project. Jangan kirim ke log CI atau commit. Rotasi pepper memerlukan versioned pepper strategy atau reset semua PIN; jangan menggantinya tanpa rencana migrasi.

## Supabase

1. Buat development project Supabase. Simpan URL, anon key, service role key dalam `.env.local` di komputer atau secret store Vercel. Jangan menaruh service key di variable `NEXT_PUBLIC_`.
2. Jalankan isi migration **berurutan** melalui SQL Editor atau Supabase CLI yang sudah terhubung:
   - `supabase/migrations/202609180001_foundation.sql`
   - `supabase/migrations/202609180002_private_storage.sql`
   - `supabase/migrations/202609190001_gallery_access_and_delivery.sql`
3. Review bahwa semua tabel bisnis RLS ON, kedua bucket `public=false`, schema private tidak masuk exposed schemas, dan tidak ada policy lama yang memberikan public access.
4. Buat user admin melalui Supabase Auth Dashboard. Nonaktifkan signup publik untuk aplikasi admin-only. Masukkan UUID Auth user tersebut menggunakan SQL tepercaya berikut (ganti placeholder, jangan memasukkan email sebagai UUID):

```sql
insert into public.admins (user_id, display_name)
values ('<uuid-dari-auth-users>', 'Elts. Studio');
```

5. Atur Auth Site URL dan allowed redirect origins persis sesuai dev/staging/production. Jangan wildcard seluruh internet. Email/password login, logout dan proxy baru diimplementasikan pada tahap Admin.
6. Setelah CLI login/link tersedia, regenerate types tanpa menambahkan private schema ke API:

```text
npx supabase gen types typescript --project-id YOUR_PROJECT_ID --schema public
```

Simpan output ke `src/types/database.ts`, lalu sesuaikan alias row yang diperlukan dan jalankan typecheck. Gunakan file UTF-8 ketika mengalihkan output di Windows.

Migration berasumsi schema `auth`/`storage`, role `anon`/`authenticated`/`service_role` disediakan oleh Supabase. Jangan menjalankannya ke database yang tidak diketahui. Tidak ada migration yang dijalankan otomatis saat aplikasi start.

Untuk database yang sudah memakai dua migration foundation, jalankan hanya migration `202609190001_gallery_access_and_delivery.sql` yang belum diterapkan. Migration ini menambahkan kolom `media.cloudinary_delivery_type`, mendukung hash PIN versi baru, dan membuat RPC sesi galeri tanpa menghapus data customer atau media. Tanpa migration ini, file dapat berhasil masuk Cloudinary tetapi gagal disimpan sebagai media proyek.

## Cloudinary untuk upload galeri

Isi ketiga variable Cloudinary menggunakan kredensial dari product environment yang sama. Browser mengirim file langsung ke Cloudinary dalam potongan 6 MiB dengan parameter yang ditandatangani server. API key dan cloud name ikut dalam permintaan upload; API secret tetap di server. Tidak perlu membuat unsigned upload preset.

Upload baru memakai delivery type `authenticated`, termasuk thumbnail dan preview yang dibuat melalui eager transformations. Aplikasi memverifikasi hasil upload melalui Cloudinary Admin API sebelum menyimpan record Supabase, lalu melayani media melalui gateway `/api/media/` yang memeriksa akses pengguna. Server memerlukan akses jaringan ke Supabase dan Cloudinary; browser juga harus dapat mengakses endpoint upload Cloudinary.

Batas aplikasi adalah 100 MiB per foto (JPG, PNG, WEBP) dan 2 GiB per video (MP4, MOV). Batas akun Cloudinary tetap berlaku; upload dalam potongan tidak menaikkan batas akun. Periksa kuota dan batas ukuran pada environment Cloudinary yang dipakai sebelum mencoba file besar. Lihat [panduan upload Cloudinary](https://cloudinary.com/documentation/upload_images#troubleshooting_large_file_upload_failures).

Setelah konfigurasi dan migration selesai, uji satu foto dan satu video dari halaman media proyek admin. Pastikan upload selesai, media muncul setelah halaman dimuat ulang, dan preview dapat dibuka oleh admin. Uji akses galeri customer secara terpisah sebelum membagikan galeri.

## GitHub

Source sudah memiliki `.gitignore`, lockfile dan workflow CI. Workspace ini belum dihubungkan ke remote GitHub. Pada saat repository tujuan sudah ditetapkan:

1. Inisialisasi repository bila belum ada; review tracked files dan pastikan tidak ada `.env.local` atau file customer.
2. Buat/pilih private repository GitHub dan push source.
3. Aktifkan branch protection yang mensyaratkan job `Validate foundation`.
4. Simpan hanya preview portfolio publik yang kecil; semua original media masuk private storage.

## Vercel

1. Import repository ke Vercel, framework preset **Next.js**, Node **22.x**.
2. Install `npm ci`, build `npm run build`; output directory default Next.js.
3. Set `NEXT_PUBLIC_SITE_URL` ke URL deployment/domain aktual; isi env Supabase/pepper/Cloudinary di server environment yang sesuai. Supabase service role dan Cloudinary API secret tidak boleh berada di client config.
4. Deploy Preview lebih dulu. Gunakan database staging untuk pengujian akses; jangan melakukan tes destruktif pada production.
5. Uji desktop/mobile, links/SEO, static cache public, dan pastikan private responses tidak cache saat endpoint privat aktif.
6. Ganti gambar contoh dengan portfolio Elts. sebelum public launch, lalu hapus note preview secara sadar.

Tidak ada deployment dibuat dari tahap foundation ini; akun/project Supabase, repository tujuan, domain dan Vercel belum diberikan. Jangan menyatakan integrasi cloud atau authentication production sudah siap hanya karena local build sukses.

## Menambah komponen shadcn

`components.json`, path aliases, theme tokens dan Button/Skeleton tersedia. UI memakai Radix primitives. Komponen baru dapat ditambahkan melalui CLI shadcn pada saat fiturnya diperlukan; review diff agar tidak menimpa tema Elts.

## Acceptance sebelum galeri digunakan customer

Lihat gate setiap tahap di `architecture.md`. Khusus storage, lakukan pengujian live URL tanpa cookie, cookie project lain, project expired, watermark ON dan download OFF. Local SQL test menggunakan fixtures Auth/Storage dan tidak menggantikan pengujian Supabase hosted atau Vercel streaming.
