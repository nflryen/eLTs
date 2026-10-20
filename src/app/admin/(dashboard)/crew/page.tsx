import type { Metadata } from "next";
import Link from "next/link";
import { requirePageOps } from "@/lib/auth/roles";
import { getCrewMembersList } from "@/app/actions/crew";
import { Users, Phone, Banknote, BadgeCheck, UserX } from "lucide-react";

export const metadata: Metadata = {
  title: "Kru & Dispatch — Elts.",
  robots: { index: false, follow: false },
};

/**
 * Operational crew roster.
 *
 * WHY THIS IS NOT IN SETTINGS
 * ---------------------------
 * Crew management is day-to-day operational work — who is available, what they
 * are rated, how they are paid — not account configuration. It belongs in the
 * main navigation alongside Projects and Calendar. Settings is reserved for a
 * person's own profile, their sessions, and (for SUPER_ADMIN) RBAC tiers.
 *
 * GATED AT ADMIN (80), matching `getCrewMembersList()` which calls
 * `requireOps()`. The sidebar entry is visible from WORKER (60) because a
 * WORKER legitimately needs to see who is on a job; the page itself refuses
 * below 80 and redirects rather than throwing. If that mismatch is unwanted,
 * raise the nav `minRank` — but do not lower the action guard, because the
 * roster includes bank details.
 */
export default async function CrewPage() {
  await requirePageOps("/admin/crew");
  const crew = await getCrewMembersList();

  const active = crew.filter((c) => c.is_active);
  const linked = crew.filter((c) => Boolean(c.auth_user_id));

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <p className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1aa]">
          Operasional
        </p>
        <h1 className="mt-1 text-xl font-semibold text-[#18181b]">Kru & Dispatch</h1>
        <p className="mt-1 text-sm text-[#71717a]">
          Direktori kru operasional. Penugasan per proyek dilakukan dari halaman Proyek.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Kru aktif" value={String(active.length)} icon={<Users size={15} />} />
        <Stat label="Punya akun" value={String(linked.length)} icon={<BadgeCheck size={15} />} />
        <Stat
          label="Tanpa akun"
          value={String(crew.length - linked.length)}
          icon={<UserX size={15} />}
        />
      </div>

      {crew.length === 0 ? (
        <div className="rounded-xl border border-[#ececee] bg-white p-8 text-center">
          <p className="text-sm text-[#71717a]">Belum ada kru terdaftar.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#ececee] bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[#ececee] bg-[#fafafa] text-[11px] uppercase tracking-wide text-[#71717a]">
              <tr>
                <th className="px-4 py-3 font-medium">Kru</th>
                <th className="px-4 py-3 font-medium">Tipe</th>
                <th className="px-4 py-3 font-medium">Kontak</th>
                <th className="px-4 py-3 font-medium">Rate / Hari</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f4f4f5]">
              {crew.map((c) => (
                <tr key={c.crew_member_id} className="hover:bg-[#fafafa]">
                  <td className="px-4 py-3">
                    <p className="font-medium text-[#18181b]">{c.full_name}</p>
                    <p className="font-mono text-[10px] text-[#a1a1aa]">{c.crew_code}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-[#f4f4f5] px-1.5 py-0.5 text-[10px] font-medium text-[#52525b]">
                      {c.member_type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1 text-xs text-[#52525b]">
                      <Phone size={11} className="text-[#a1a1aa]" />
                      {c.phone || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1 font-mono text-xs text-[#3f3f46]">
                      <Banknote size={11} className="text-[#a1a1aa]" />
                      {Number(c.standard_day_rate ?? 0).toLocaleString("id-ID")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span
                        className={`w-fit rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          c.is_active
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-[#f4f4f5] text-[#71717a]"
                        }`}
                      >
                        {c.is_active ? "Aktif" : "Nonaktif"}
                      </span>
                      <span className="text-[10px] text-[#a1a1aa]">
                        {c.auth_user_id ? "Punya akun" : "Tanpa akun"}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-[#a1a1aa]">
        Untuk menugaskan kru ke sebuah proyek, buka{" "}
        <Link href="/admin/projects" className="font-medium text-[#3f3f46] underline">
          Proyek
        </Link>{" "}
        lalu pilih tab Kru pada proyek tersebut.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[#ececee] bg-white p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#71717a]">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums text-[#18181b]">{value}</p>
    </div>
  );
}
