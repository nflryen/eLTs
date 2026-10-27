import type { Metadata } from "next";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { loadPayslipData } from "@/lib/pdf/load-payslip";
import { verifySlipSignature } from "@/lib/pdf/payslip-token";
import { formatRupiah, formatDateId } from "@/lib/reminders/compose";

export const metadata: Metadata = {
  title: "Verifikasi Slip Gaji — Elts.",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sig?: string }>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Initials only — the full name is never disclosed on a public page. */
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * PUBLIC verification. Deliberately unauthenticated: its purpose is for a third
 * party (bank, auditor, recipient) to confirm a printed slip without an account.
 *
 * What it discloses if — and only if — the signature matches:
 *   document number, recipient INITIALS, payment date, total amount.
 * It never discloses the full name, line items, project names or bank details.
 *
 * A bad signature returns exactly the same shape as an unknown id, so the page
 * cannot be used to probe which slip numbers exist.
 */
export default async function VerifySlipPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { sig } = await searchParams;

  const secret = process.env.INVOICE_PDF_SECRET;
  const validId = UUID_RE.test(id);
  const data = validId ? await loadPayslipData(id) : null;

  const verified =
    Boolean(data) &&
    Boolean(secret) &&
    verifySlipSignature(
      data!.id,
      data!.slipNumber,
      data!.totalNet,
      sig,
      secret as string,
    );

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7f7f8] px-4">
      <div className="w-full max-w-md rounded-[18px] border border-[#ececee] bg-white p-8 text-center">
        {verified && data ? (
          <>
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-[#ecfdf5]">
              <ShieldCheck className="size-6 text-[#059669]" aria-hidden="true" />
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#059669]">
              Dokumen Terverifikasi
            </p>
            <h1 className="mt-1 font-serif text-xl font-bold text-[#09090b]">
              Slip Gaji Sah
            </h1>
            <p className="mt-1 text-xs text-[#71717a]">
              Tanda tangan digital cocok dengan catatan ledger Elts. Photography.
            </p>

            <dl className="mt-6 divide-y divide-[#f4f4f5] rounded-[12px] border border-[#ececee] text-left">
              {[
                ["Nomor Slip", data.slipNumber],
                ["Penerima", `${initialsOf(data.payeeName)} (disamarkan)`],
                ["Tanggal Terbit", formatDateId(data.issuedAt)],
                ["Total Dibayar", formatRupiah(data.totalNet)],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between px-4 py-2.5">
                  <dt className="text-[11px] text-[#71717a]">{k}</dt>
                  <dd className="font-mono text-[12px] font-semibold tabular-nums text-[#09090b]">
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-[#fef2f2]">
              <ShieldAlert className="size-6 text-[#dc2626]" aria-hidden="true" />
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#dc2626]">
              Verifikasi Gagal
            </p>
            <h1 className="mt-1 font-serif text-xl font-bold text-[#09090b]">
              Slip Tidak Valid
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-[#71717a]">
              Tanda tangan tidak cocok, atau dokumen tidak diterbitkan oleh server resmi
              Elts. Photography. Jangan gunakan slip ini sebagai bukti pembayaran sebelum
              dikonfirmasi ke studio.
            </p>
          </>
        )}

        <p className="mt-6 border-t border-[#f4f4f5] pt-4 font-mono text-[9px] text-[#c4c4c8]">
          ELTS. PHOTOGRAPHY · VERIFIKASI DOKUMEN
        </p>
      </div>
    </div>
  );
}
