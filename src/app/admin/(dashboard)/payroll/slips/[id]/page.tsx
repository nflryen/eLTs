import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { formatPayoutDestination, loadPayslipData } from "@/lib/pdf/load-payslip";
import { formatRupiah, formatDateId } from "@/lib/reminders/compose";

export const metadata: Metadata = {
  title: "Slip Gaji — Elts.",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ id: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PayslipPage({ params }: Props) {
  const { id } = await params;
  if (!UUID_RE.test(id)) redirect("/admin?denied=unauthorized");

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");

  const data = await loadPayslipData(id);
  if (!data) redirect("/admin?denied=unauthorized");

  /*
   * AUTHORISATION: recipient, or ADMIN and above.
   *
   * Checked here AND in the PDF route. The page check prevents the document from
   * being rendered into the DOM; the route check prevents the same content being
   * fetched as a PDF by bypassing the page.
   */
  const rankRes = await supabase.rpc("get_caller_role");
  const rank = Number((rankRes.data as Array<{ role_rank: number }> | null)?.[0]?.role_rank ?? 0);

  let isRecipient = data.payeeUserId === user.id;
  if (!isRecipient && data.payeeCrewId) {
    /*
     * Same check as the PDF route, against the same read model: an identity read
     * for this feature comes from `v_crew_identity`, never `crew_members`.
     * Filtering on `crew_member_id` too means a duplicated `auth_user_id` link
     * can never widen this to somebody else's slip.
     */
    const { data: crew } = await createServiceSupabase()
      .from("v_crew_identity")
      .select("crew_member_id")
      .eq("crew_member_id", data.payeeCrewId)
      .eq("auth_user_id", user.id)
      .maybeSingle();
    isRecipient = Boolean(crew);
  }

  if (!isRecipient && rank < 80) redirect("/admin?denied=unauthorized");

  const paidLabel = data.status === "DISBURSED" || data.status === "CLOSED";
  const payoutLine = formatPayoutDestination(data);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 print:max-w-none print:py-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link
          href={rank >= 80 ? "/admin/payroll" : "/my-earnings"}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#71717a] hover:text-[#09090b]"
        >
          <ArrowLeft size={12} /> Kembali
        </Link>
        <a
          href={`/api/payroll/slips/${data.id}/pdf`}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-[10px] bg-[#09090b] px-3.5 text-xs font-semibold text-white hover:bg-[#27272a]"
        >
          <Download size={13} /> Unduh PDF
        </a>
      </div>

      <article className="rounded-[18px] border border-[#ececee] bg-white p-7 print:border-0 print:p-0">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <header className="flex items-start justify-between border-b border-[#ececee] pb-5">
          <div>
            <p className="font-serif text-xl font-bold tracking-[0.18em] text-[#09090b]">ELTS.</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-[#a1a1aa]">Photography</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#71717a]">
              Bukti Pembayaran Kompensasi
            </p>
            <p className="mt-1 font-mono text-sm font-semibold text-[#09090b]">{data.slipNumber}</p>
            <p className="mt-0.5 text-[11px] text-[#a1a1aa]">{formatDateId(data.issuedAt)}</p>
          </div>
        </header>

        {/* ── Recipient ──────────────────────────────────────────────── */}
        <section className="mt-5 rounded-[12px] bg-[#f7f7f8] p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#a1a1aa]">Penerima</p>
              <p className="mt-1 text-base font-bold text-[#09090b]">{data.payeeName}</p>
              <p className="mt-0.5 text-[11px] text-[#71717a]">
                {data.payeeCode ? `${data.payeeCode} · ` : ""}
                {data.payeeType === "FREELANCE" ? "Kru Lepas" : "Staff Internal"}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                paidLabel ? "bg-[#065f46] text-white" : "bg-[#fef3c7] text-[#92400e]"
              }`}
            >
              {paidLabel ? "Lunas / Paid" : data.status}
            </span>
          </div>
          {/*
            Same formatter as the printed PDF: a crew slip with no account on
            file shows an explicit "BELUM DIATUR" warning instead of silently
            omitting the row. Destination comes from `v_crew_identity`, which
            reads `user_profiles` for linked crew and `crew_contact_details` for
            unlinked crew — never the dropped `crew_members.bank_*` columns.
          */}
          {payoutLine ? (
            <p
              className={`mt-3 border-t border-[#ececee] pt-2.5 font-mono text-[11px] ${
                data.bank ? "text-[#52525b]" : "font-semibold text-[#92400e]"
              }`}
            >
              {payoutLine}
            </p>
          ) : null}
        </section>

        {/* ── Items ──────────────────────────────────────────────────── */}
        <section className="mt-5">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#ececee] text-left text-[9px] uppercase tracking-[0.1em] text-[#a1a1aa]">
                <th className="py-2 font-semibold">Tanggal</th>
                <th className="py-2 font-semibold">Proyek / Penugasan</th>
                <th className="hidden py-2 font-semibold sm:table-cell">Peran</th>
                <th className="py-2 text-right font-semibold">Kompensasi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f4f4f5]">
              {data.lines.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap py-2.5 text-[11px] text-[#71717a]">
                    {formatDateId(l.earnedOn)}
                  </td>
                  <td className="py-2.5 text-[12px] text-[#09090b]">{l.projectName ?? "—"}</td>
                  <td className="hidden py-2.5 text-[11px] text-[#71717a] sm:table-cell">
                    {l.roleLabel ?? "—"}
                  </td>
                  <td className="py-2.5 text-right font-mono text-[12px] tabular-nums text-[#09090b]">
                    {formatRupiah(l.netAmount)}
                  </td>
                </tr>
              ))}
              {data.lines.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-xs text-[#a1a1aa]">
                    Tidak ada item pada periode ini.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>

        {/* ── Summary ────────────────────────────────────────────────── */}
        <section className="mt-4 rounded-[12px] bg-[#f7f7f8] p-4">
          <div className="flex justify-between text-[12px] text-[#52525b]">
            <span>Subtotal Kompensasi Bruto</span>
            <span className="font-mono tabular-nums">{formatRupiah(data.totalGross)}</span>
          </div>
          <div className="mt-1.5 flex justify-between text-[12px] text-[#52525b]">
            <span>Total Potongan / Administrasi</span>
            <span className="font-mono tabular-nums">{formatRupiah(data.totalDeduction)}</span>
          </div>
          <div className="mt-3 flex justify-between border-t border-[#ececee] pt-3">
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#09090b]">
              Total Bersih Diterima
            </span>
            <span className="font-mono text-lg font-bold tabular-nums text-[#09090b]">
              {formatRupiah(data.totalNet)}
            </span>
          </div>
        </section>

        {/* ── Security footer ────────────────────────────────────────── */}
        <footer className="mt-5 border-t border-[#ececee] pt-4">
          <p className="text-[10px] leading-relaxed text-[#a1a1aa]">
            Dokumen ini ditandatangani secara digital. Pindai QR pada PDF untuk verifikasi
            keabsahan di server resmi Elts.
          </p>
          <p className="mt-1.5 break-all font-mono text-[9px] text-[#c4c4c8]">
            {data.verificationHash}
          </p>
        </footer>
      </article>
    </div>
  );
}
