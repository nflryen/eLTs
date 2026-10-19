# Verifikasi fondasi

Tanggal: 18 September 2026.

## Pemeriksaan otomatis

- `npm run lint`: lulus tanpa warning.
- `npm run typecheck`: lulus.
- `npm test`: 16 tests/subtests lulus.
- `npm run build`: production build lulus; homepage, client information page, sitemap, robots, favicon diprerender.
- npm install audit: 0 known vulnerabilities pada dependency graph saat instalasi.

## Pengujian keamanan

Tes memakai PGlite (PostgreSQL in-memory) dan menjalankan kedua file migration asli, dengan schema Auth/Storage fixture. Diperiksa:

- anon dan user authenticated non-admin tidak dapat membaca data/private object;
- user biasa tidak dapat menambah admin, memanggil limiter atau membaca session;
- admin membership memberikan akses yang sesuai;
- favorites dan cover lintas project ditolak;
- plaintext PIN ditolak constraint;
- limiter membatasi 5 attempt per 10 menit dan reset ketika window lewat;
- archive membatalkan session, mempertahankan favorites;
- bucket originals/previews private;
- key preview lintas project ditolak;
- penghapusan cover mempertahankan project dan mengosongkan cover reference;
- scrypt salt unik, wrong PIN/pepper ditolak;
- session dan locator memakai token random independen;
- media project lain dan download tanpa izin ditolak;
- invalid timestamp/expiry/revocation/status gagal tertutup.

Ini menguji fondasi, bukan autentikasi end-to-end. Belum ada endpoint galeri aktif.

## Pemeriksaan browser

- Diperiksa di browser pada viewport desktop default, 1440px, tablet 768px, dan mobile 390px/360px.
- Homepage dan Client Area tidak memiliki overflow horizontal pada ukuran yang diperiksa.
- Foto homepage berhasil dimuat; hero, services, footer dan Client Area diperiksa visual.
- Menu mobile membuka dialog dan menutup ketika link section dipilih.
- Featured Works membuka lightbox; Next, ArrowLeft dan Escape berfungsi.
- Focus setelah lightbox ditutup kembali ke foto pembuka yang tepat.
- URL booking dan service inquiries mengarah ke `wa.me/6280000000000` dengan pesan ter-encode.
- Client Area menampilkan status persiapan dan kontak; tidak menawarkan autentikasi yang belum tersedia.
- Tidak ada browser error teramati. Warning development terkait LCP hero ditangani dengan eager/high-priority loading; foto section bawah tetap lazy.
- Gesture swipe tersedia pada kode, tetapi belum diuji dengan perangkat sentuh fisik. Screen reader dan zoom 200% masih perlu pemeriksaan tambahan sebelum peluncuran.

## Batas pengujian

Belum terhubung ke Supabase hosted, belum login admin nyata, belum upload/original download/video streaming, belum deploy Vercel. Lighthouse >90 tetap target, belum diukur. Model cookie/CSRF/gateway di dokumentasi belum berupa endpoint production.
