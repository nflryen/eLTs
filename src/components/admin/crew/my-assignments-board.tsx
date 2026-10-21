"use client";

import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Inbox, Wallet, UserCog } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { MyAssignmentCard } from "@/components/admin/crew/my-assignments-card";
import type { MyAssignment } from "@/app/actions/crew-dashboard";

/**
 * The crew member's own board, grouped by what they can DO about each row.
 *
 * Grouping is by effective state, not by raw column value: a PENDING_OFFER whose
 * deadline has passed resolves as EXPIRED server-side, so a lapsed invitation
 * cannot sit in "Undangan Masuk" with live accept buttons.
 *
 * "Selesai/Batal" deliberately collects three different things — wrapped,
 * declined, expired — because the crew member's action is identical for all of
 * them: read it and move on. Splitting them into three empty-ish sections would
 * add headers without adding decisions.
 */

type Group = {
  key: string;
  title: string;
  description: string;
  items: MyAssignment[];
};

function groupAssignments(assignments: MyAssignment[]): Group[] {
  /*
   * A wrapped assignment keeps `acceptance_status = 'ACCEPTED'` — it WAS
   * accepted, and completion is recorded separately in `completed_at`. It
   * therefore has to be pulled OUT of "Diterima" explicitly, or a finished shoot
   * sits in the live queue with nothing left to do on it.
   */
  const offers = assignments.filter((a) => a.state === "PENDING_OFFER");
  const accepted = assignments.filter((a) => a.state === "ACCEPTED" && !a.completed_at);
  const closed = assignments.filter(
    (a) =>
      a.state === "DECLINED" ||
      a.state === "EXPIRED" ||
      (a.state === "ACCEPTED" && a.completed_at !== null),
  );

  return [
    {
      key: "offers",
      title: "Undangan Masuk",
      description: "Konfirmasi kehadiran Anda agar studio bisa mengunci jadwal.",
      items: offers,
    },
    {
      key: "accepted",
      title: "Diterima",
      description: "Penugasan yang sudah Anda konfirmasi dan belum ditandai selesai.",
      items: accepted,
    },
    {
      key: "closed",
      title: "Selesai / Batal",
      description: "Riwayat penugasan yang sudah tuntas, Anda tolak, atau kedaluwarsa.",
      items: closed,
    },
  ];
}

export function MyAssignmentsBoard({
  assignments,
  crewCode,
}: {
  assignments: MyAssignment[];
  crewCode: string;
}) {
  const groups = groupAssignments(assignments);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          href="/my-earnings"
          className="group flex min-h-11 items-center justify-between gap-3 rounded-[var(--radius-cards)] border border-[var(--color-cloud)] bg-[var(--color-snow)] px-5 py-4 transition-colors hover:border-[var(--color-mist)]"
        >
          <span className="flex items-center gap-2.5">
            <Wallet aria-hidden="true" className="size-4 text-[var(--color-steel)]" />
            <span>
              <span className="block text-[13px] font-semibold text-[var(--color-graphite)]">
                Pendapatan Saya
              </span>
              <span className="block text-[11px] text-[var(--color-fog)]">
                Slip gaji dan total yang sudah dibayarkan
              </span>
            </span>
          </span>
          <ArrowUpRight
            aria-hidden="true"
            className="size-4 shrink-0 text-[var(--color-ash)] transition-colors group-hover:text-[var(--color-obsidian)]"
          />
        </Link>

        <Link
          href="/settings/profile"
          className="group flex min-h-11 items-center justify-between gap-3 rounded-[var(--radius-cards)] border border-[var(--color-cloud)] bg-[var(--color-snow)] px-5 py-4 transition-colors hover:border-[var(--color-mist)]"
        >
          <span className="flex items-center gap-2.5">
            <UserCog aria-hidden="true" className="size-4 text-[var(--color-steel)]" />
            <span>
              <span className="block text-[13px] font-semibold text-[var(--color-graphite)]">
                Profil & Rekening
              </span>
              <span className="block text-[11px] text-[var(--color-fog)]">
                Data diri dan tujuan pembayaran fee
              </span>
            </span>
          </span>
          <ArrowUpRight
            aria-hidden="true"
            className="size-4 shrink-0 text-[var(--color-ash)] transition-colors group-hover:text-[var(--color-obsidian)]"
          />
        </Link>
      </div>

      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`group-${group.key}`}>
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h2
                id={`group-${group.key}`}
                className="text-[15px] font-semibold text-[var(--color-obsidian)]"
              >
                {group.title}
              </h2>
              <p className="mt-0.5 text-[12px] text-[var(--color-fog)]">{group.description}</p>
            </div>
            <span className="shrink-0 rounded-[var(--radius-badges)] bg-[var(--color-paper)] px-2 py-1 text-[11px] font-medium tabular-nums text-[var(--color-steel)]">
              {group.items.length}
            </span>
          </div>

          <div className="mt-3 space-y-3">
            {group.items.length === 0 ? (
              <p className="rounded-[var(--radius-cards)] border border-dashed border-[var(--color-mist)] px-5 py-6 text-center text-[12px] text-[var(--color-ash)]">
                {group.key === "offers"
                  ? "Belum ada undangan baru untuk Anda."
                  : group.key === "accepted"
                    ? "Belum ada penugasan aktif."
                    : "Belum ada riwayat penugasan."}
              </p>
            ) : (
              group.items.map((assignment) => (
                <MyAssignmentCard key={assignment.id} assignment={assignment} />
              ))
            )}
          </div>
        </section>
      ))}

      <p className="flex items-center gap-1.5 text-[11px] text-[var(--color-ash)]">
        <CheckCircle2 aria-hidden="true" className="size-3.5" />
        ID Kru Anda: <span className="font-mono">{crewCode}</span>
      </p>
    </div>
  );
}

/**
 * Rendered when the signed-in person has a staff login but no `crew_members`
 * row. That is a real, honest state — a producer, an editor, an accountant — and
 * it must read as "nothing assigned to you yet", not as an error or a crash.
 */
export function MyAssignmentsNoCrewProfile() {
  return (
    <EmptyState
      icon={<Inbox aria-hidden="true" className="size-6" />}
      title="Akun ini belum terhubung ke profil kru"
      description="Halaman ini menampilkan penugasan lapangan milik Anda. Akun Anda memiliki akses studio, tetapi belum tercatat sebagai kru, jadi tidak ada penugasan yang bisa ditampilkan. Hubungi koordinator produksi jika Anda seharusnya menerima penugasan."
    />
  );
}
