# Elts. Photography

Fondasi **Photography Portfolio + Private Client Gallery + Admin Dashboard**.
Tahap ini menyelesaikan arsitektur, setup project, migration, helper keamanan, dan homepage. Sistem galeri privat belum diaktifkan.

## Jalankan

Node.js 22 atau lebih baru, npm.

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Buka `http://127.0.0.1:3000`. Homepage berjalan tanpa kredensial Supabase.
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
- Dua migration PostgreSQL untuk tabel/RLS dan private Storage; tidak berisi data customer contoh.
- Supabase SSR/browser/service clients dan helper verifikasi admin, belum dihubungkan ke login/dashboard.
- PIN scrypt dengan salt + pepper, token acak, hashing session, access policy dan storage interface.
- Tes PostgreSQL in-memory atas SQL asli, RLS, isolasi project, limiter dan lifecycle akses.
- GitHub Actions untuk lint, typecheck, test dan build.

## Batas tahap ini

`/` adalah homepage lengkap. Tautan Portfolio, Services, About, dan Contact menuju section homepage; halaman terpisah ada dalam rencana route. `/client` adalah halaman informasi dengan kontak WhatsApp, **bukan login aktif**. Admin, access API, private gallery, upload dan favorites belum diimplementasikan. Helper keamanan tidak boleh dianggap sebagai fitur autentikasi yang sudah aktif.

Migration belum diterapkan ke Supabase hosted. Integrasi Auth/Storage, pengujian cloud, deployment Vercel dan pembuatan repository GitHub memerlukan konfigurasi project/akun yang sebenarnya. Tidak ada koneksi atau deployment eksternal yang dibuat di tahap ini.

Foto yang disertakan adalah **preview publik yang sudah dikecilkan**, bukan file customer/original. Ganti dengan portfolio Elts. yang sudah mendapat izin publikasi sebelum peluncuran. Footer menandai status gambar contoh. Akun Instagram tidak ditampilkan sampai URL yang benar tersedia.

## Dokumentasi

- [Arsitektur, database, route dan komponen](docs/architecture.md)
- [Setup Supabase, environment, GitHub dan Vercel](docs/setup.md)
- [Atribusi dan sumber foto](docs/asset-sources.md)
- [Catatan verifikasi](docs/verification.md)

## Tahap berikutnya

1. Admin Auth + membership + proxy + Projects/Customers minimal.
2. Client Access + persistent sessions + rate limiter terintegrasi.
3. Private Gallery + authenticated media gateway.
4. Direct/resumable Upload + background variant processor.
5. Favorites + review/export admin.

Setiap tahap memiliki kriteria penerimaan dan pemeriksaan keamanan di dokumen arsitektur. Analytics, Download All, booking internal, invoice dan payment tetap di luar MVP ini.
