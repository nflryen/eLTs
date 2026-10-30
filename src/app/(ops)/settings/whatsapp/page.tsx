import type { Metadata } from "next";
import { requirePageOps } from "@/lib/auth/roles";
import { getWhatsAppStatusWithQrAction } from "@/app/actions/whatsapp-actions";
import { WhatsAppPanel } from "@/components/admin/settings/whatsapp-panel";

export const metadata: Metadata = {
  title: "WhatsApp Gateway — Elts.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SettingsWhatsAppPage() {
  await requirePageOps("/settings/whatsapp");
  const initialStatus = await getWhatsAppStatusWithQrAction();

  return (
    <div className="space-y-6">
      <div className="border-b border-[#ececee] pb-4">
        <h2 className="text-base font-semibold text-[#18181b]">Koneksi WhatsApp Gateway</h2>
        <p className="mt-0.5 text-xs text-[#71717a]">
          Kelola koneksi langsung WhatsApp Web Multi-Device untuk pengiriman notifikasi otomatis tanpa biaya pihak ketiga.
        </p>
      </div>

      <WhatsAppPanel initialStatus={initialStatus} />
    </div>
  );
}
