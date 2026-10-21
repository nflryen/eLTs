-- ============================================================================
-- ELTS STUDIO OS — CREW SELF-SERVICE COMPLETION
-- Migration: 0029_crew_assignment_completion
-- ============================================================================
-- Gives a crew member's own dashboard a place to record "this shoot is done".
--
-- WHY NOT `check_in_at`
-- ---------------------
-- `check_in_at` is written by `public.crew_check_in()` (migration 0008) when the
-- crew member ARRIVES at the venue, and the studio reconciles attendance from
-- it. It is a start-of-day fact. Reusing it for "finished" would:
--
--   * make a crew member who arrived but never wrapped read as complete,
--   * destroy the attendance record the moment completion was marked,
--   * leave no way to tell "arrived 06:15, wrapped 19:40" — the only interval
--     that makes an overrun claim checkable.
--
-- A column with a meaning of its own is cheaper than either lie. Completion is
-- therefore recorded here, and the two facts stay independent.
--
-- WHY `raw_drop_url` IS NOT TOUCHED
-- ---------------------------------
-- `raw_drop_url` already exists and already means "where the raw files live".
-- `markShootCompleted()` writes it as part of the same action, but the column
-- is not redefined: an assignment can have a drop link without being complete
-- (the studio pastes one at dispatch) and completion does not require one.
--
-- `completed_at` is stamped once. Re-submitting the form corrects the link; it
-- never moves the timestamp, so the recorded wrap time stays the first one.

begin;

alter table public.project_crew_assignments
  add column if not exists completed_at timestamptz;

comment on column public.project_crew_assignments.completed_at is
  'When the crew member marked the shoot as wrapped from their own dashboard. '
  'Distinct from check_in_at (venue arrival, written by crew_check_in). '
  'Stamped once and never moved.';

/*
 * Guard against a completion that precedes the arrival it follows. The check is
 * NULL-tolerant on purpose: an assignment may be completed without ever being
 * checked in (a remote editor, a second-unit shoot), and a missing arrival must
 * not block the wrap.
 */
alter table public.project_crew_assignments
  drop constraint if exists project_crew_assignments_completed_after_checkin;
alter table public.project_crew_assignments
  add constraint project_crew_assignments_completed_after_checkin
  check (
    completed_at is null
    or check_in_at is null
    or completed_at >= check_in_at
  );

-- ── Read path for the crew dashboard ────────────────────────────────────────
/*
 * `/admin/my-assignments` reads `where crew_member_id = <caller> and revoked_at
 * is null order by call_time desc`. `pca_crew_idx` covers the first predicate;
 * this partial index matches the whole shape, so a freelancer with a long
 * history does not scan their revoked rows to render the current board.
 */
create index if not exists pca_crew_board_idx
  on public.project_crew_assignments (crew_member_id, call_time desc)
  where revoked_at is null;

commit;
