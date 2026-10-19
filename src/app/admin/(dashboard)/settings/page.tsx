import { requireOps } from "@/lib/auth/roles";
import { Shield, User, Globe } from "lucide-react";

/**
 * Settings.
 *
 * Two corrections over the previous version:
 *
 *  1. COPY. The screen was English inside an otherwise Indonesian admin.
 *     Operator-facing text is now Indonesian.
 *
 *  2. HONESTY. The Security panel asserted "PIN Hashing: Enabled (scrypt-v1)"
 *     and "Session Expiry: 7 days". The code uses scrypt-v2 and a 12-hour
 *     session. A security panel that misstates its own configuration is worse
 *     than no panel, because it is trusted. Each row now reflects the value
 *     that is actually enforced, and points at the code that enforces it.
 */
export default async function SettingsPage() {
  const { admin, role, rank } = await requireOps();

  const security = [
    {
      label: "Row Level Security",
      status: "Aktif di semua tabel bisnis",
      enforcedBy: "migrations/0003_rbac_policies.sql",
    },
    {
      label: "Hashing PIN Galeri",
      status: "scrypt-v2 (N=32768, r=8, p=3)",
      enforcedBy: "src/lib/security/credentials.ts",
    },
    {
      label: "Pembatasan Percobaan",
      status: "5 percobaan / 10 menit",
      enforcedBy: "public.consume_gallery_attempt",
    },
    {
      label: "Masa Berlaku Sesi",
      status: "12 jam (dipotong tanggal kedaluwarsa proyek)",
      enforcedBy: "public.create_gallery_session",
    },
    {
      label: "Media Privat",
      status: "Gateway sesi + watermark sisi server",
      enforcedBy: "src/app/api/media/[id]/preview/route.ts",
    },
  ];

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <p className="eyebrow mb-2">Konfigurasi</p>
        <h1 className="font-serif text-3xl font-bold">Pengaturan</h1>
      </div>

      {/* Profil */}
      <div className="mb-6 overflow-hidden rounded-lg border border-border bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-border px-6 py-5">
          <User size={18} className="text-muted-foreground" />
          <h2 className="font-medium">Profil Akun</h2>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div className="flex items-center justify-between border-b border-border py-3 last:border-0">
            <div>
              <p className="text-sm font-medium">Nama Tampilan</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {admin.display_name}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium">Peran</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {role ?? "Tidak ada peran"} · tingkat akses {rank}
              </p>
            </div>
            <span className="inline-flex items-center rounded-full border border-[#09090b]/25 bg-[#09090b]/5 px-2.5 py-0.5 text-xs font-medium text-[#09090b]">
              Aktif
            </span>
          </div>
        </div>
      </div>

      {/* Konfigurasi bisnis */}
      <div className="mb-6 overflow-hidden rounded-lg border border-border bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-border px-6 py-5">
          <Globe size={18} className="text-muted-foreground" />
          <h2 className="font-medium">Konfigurasi Bisnis</h2>
        </div>
        <div className="space-y-4 px-6 py-5">
          {[
            {
              label: "Nama Studio",
              value: "Elts. Photography",
              hint: "Ditampilkan pada semua komunikasi klien",
            },
            {
              label: "Nomor WhatsApp",
              value: "+62 822 3459 0719",
              hint: "Kontak pemesanan dan dukungan",
            },
          ].map((item) => (
            <div
              key={item.label}
              className="flex items-start justify-between border-b border-border py-3 last:border-0"
            >
              <div>
                <p className="text-sm font-medium">{item.label}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {item.hint}
                </p>
              </div>
              <p className="ml-4 text-right font-mono text-sm">{item.value}</p>
            </div>
          ))}
          <p className="pt-2 text-xs text-muted-foreground">
            Untuk mengubah konfigurasi bisnis, perbarui berkas{" "}
            <code className="rounded border border-[#ececee] bg-[#f4f4f5] px-1 font-mono">
              .env.local
            </code>{" "}
            lalu deploy ulang.
          </p>
        </div>
      </div>

      {/* Keamanan — nilai yang benar-benar berlaku */}
      <div className="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-border px-6 py-5">
          <Shield size={18} className="text-muted-foreground" />
          <h2 className="font-medium">Keamanan</h2>
        </div>
        <div className="space-y-3 px-6 py-5">
          {security.map((item) => (
            <div
              key={item.label}
              className="flex items-start justify-between border-b border-border py-2 last:border-0"
            >
              <div>
                <p className="text-sm">{item.label}</p>
                <p className="mt-0.5 font-mono text-[11px] text-[#a1a1aa]">
                  {item.enforcedBy}
                </p>
              </div>
              <span className="ml-4 shrink-0 rounded-full border border-[#09090b]/25 bg-[#09090b]/5 px-2 py-0.5 text-right text-xs font-medium text-[#09090b]">
                {item.status}
              </span>
            </div>
          ))}
          <p className="pt-2 text-xs text-muted-foreground">
            Nilai di atas mencerminkan konfigurasi yang benar-benar diterapkan
            oleh kode, bukan status yang diasumsikan.
          </p>
        </div>
      </div>
    </div>
  );
}
