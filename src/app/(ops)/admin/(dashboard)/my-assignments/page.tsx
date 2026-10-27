import type { Metadata } from "next";
import { requirePageStaff } from "@/lib/auth/roles";
import { listMyAssignments } from "@/app/actions/crew-dashboard";
import {
  MyAssignmentsBoard,
  MyAssignmentsNoCrewProfile,
} from "@/components/admin/crew/my-assignments-board";

export const metadata: Metadata = {
  title: "Penugasan Saya — Elts.",
  robots: { index: false, follow: false },
};

/**
 * A crew member's own assignments.
 *
 * GATED AT STAFF (60), not OPS: this is the WORKER's own surface, the
 * authenticated counterpart to the token-based `/crew/[magicToken]` portal. The
 * data is scoped by the ACTION — `listMyAssignments()` resolves the crew row
 * from `auth.uid()` and accepts no crew id — so a WORKER cannot widen the query
 * by calling it directly. RLS (`pca_worker_read`, migration 0006) is the second
 * line: a WORKER may read assignments, and the action narrows that to their own.
 *
 * A staff member with no `crew_members` row is a legitimate state (a producer,
 * an accountant). They get an honest explanation, not a crash and not an empty
 * list that looks like a quiet week.
 */
export default async function MyAssignmentsPage() {
  await requirePageStaff("/admin/my-assignments");
  const board = await listMyAssignments();

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ash)]">
          Kru
        </p>
        <h1 className="mt-1 text-xl font-semibold text-[var(--color-obsidian)]">Penugasan Saya</h1>
        <p className="mt-1 text-sm text-[var(--color-fog)]">
          Undangan, jadwal panggilan, dan status fee Anda. Terima atau tolak undangan sebelum
          tenggatnya agar studio bisa mengunci jadwal.
        </p>
      </header>

      {!board.ok ? (
        <div
          role="alert"
          className="rounded-[var(--radius-cards)] border border-[var(--color-cloud)] bg-[var(--color-snow)] px-5 py-4 text-sm text-[var(--color-fog)]"
        >
          {board.error}
        </div>
      ) : !board.crewMember ? (
        <MyAssignmentsNoCrewProfile />
      ) : (
        <MyAssignmentsBoard
          assignments={board.assignments}
          crewCode={board.crewMember.crewCode}
        />
      )}
    </div>
  );
}
