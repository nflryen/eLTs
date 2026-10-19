-- Migration: 202609240008_phase1_operational_integrity.sql
BEGIN;

-- ============================================================================
-- 1. RESCHEDULING CASCADE TRIGGER & STALE CONSENT PURGE
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cascade_project_reschedule()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_delta INTERVAL;
BEGIN
  IF NEW.shoot_date IS DISTINCT FROM OLD.shoot_date THEN
    v_delta := (NEW.shoot_date - OLD.shoot_date) * INTERVAL '1 day';

    -- 1. Shift call and roll times by the date delta
    -- 2. Invalidate crew acceptance status (forces re-confirmation on new date)
    UPDATE public.project_crew_assignments
    SET 
      call_time = call_time + v_delta,
      roll_time = CASE WHEN roll_time IS NOT NULL THEN roll_time + v_delta ELSE NULL END,
      acceptance_status = 'PENDING_OFFER',
      accepted_at = NULL,
      declined_reason = 'Jadwal proyek diubah oleh studio dari ' || to_char(OLD.shoot_date, 'DD/MM/YYYY') || ' ke ' || to_char(NEW.shoot_date, 'DD/MM/YYYY'),
      updated_at = now()
    WHERE project_id = NEW.id;

    -- Note: Because acceptance_status transitions away from 'ACCEPTED',
    -- trg_sync_crew_fee automatically executes and purges the CREW_FEE items from public.project_expenses!
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascade_project_reschedule ON public.projects;
CREATE TRIGGER trg_cascade_project_reschedule
  AFTER UPDATE OF shoot_date ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.cascade_project_reschedule();

-- ============================================================================
-- 2. TWO-BUCKET EXPENSE ROUTING (CASH OUTFLOW VS. IN-HOUSE GEAR DEPRECIATION)
-- ============================================================================
ALTER TABLE public.project_expenses
  ADD COLUMN IF NOT EXISTS is_cash_outflow BOOLEAN NOT NULL DEFAULT true;

-- Default in-house equipment depreciation to non-cash outflow
UPDATE public.project_expenses
SET is_cash_outflow = false
WHERE (source_type = 'IN_HOUSE' AND category = 'EQUIPMENT_DEPRECIATION')
   OR (paid_by = 'STUDIO_CASH' AND category = 'EQUIPMENT_DEPRECIATION');

CREATE INDEX IF NOT EXISTS idx_pe_cash_outflow ON public.project_expenses (project_id, is_cash_outflow);

-- ============================================================================
-- 3. DUPLICATE CREW FEE BLOCKER AT DATABASE LEVEL
-- ============================================================================
-- Change FK to CASCADE so deleting an assignment deletes the crew fee line item
ALTER TABLE public.project_expenses
  DROP CONSTRAINT IF EXISTS project_expenses_crew_assignment_id_fkey;

ALTER TABLE public.project_expenses
  ADD CONSTRAINT project_expenses_crew_assignment_id_fkey
  FOREIGN KEY (crew_assignment_id)
  REFERENCES public.project_crew_assignments(id)
  ON DELETE CASCADE;

-- Enforce that any CREW_FEE row MUST be linked to a verified crew_assignment_id
ALTER TABLE public.project_expenses
  DROP CONSTRAINT IF EXISTS chk_crew_fee_requires_assignment;

ALTER TABLE public.project_expenses
  ADD CONSTRAINT chk_crew_fee_requires_assignment
  CHECK (category <> 'CREW_FEE' OR crew_assignment_id IS NOT NULL);
-- ============================================================================
-- 4. BUFFER-AWARE CONFLICT DETECTION RPC (H-1 PREP & H+1 RETURN)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_asset_scheduling_conflict_v2(
  p_asset_id UUID,
  p_project_id UUID,
  p_target_date DATE,
  p_prep_days_before INT DEFAULT 1,
  p_return_days_after INT DEFAULT 1
)
RETURNS TABLE (
  conflict_found BOOLEAN,
  conflicting_project_id UUID,
  conflicting_project_name TEXT,
  conflicting_date DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_window_start DATE := p_target_date - p_prep_days_before;
  v_window_end DATE := p_target_date + p_return_days_after;
BEGIN
  RETURN QUERY
  SELECT 
    true,
    pr.id,
    pr.name,
    pr.shoot_date
  FROM public.project_expenses pe
  JOIN public.projects pr ON pr.id = pe.project_id
  WHERE pe.asset_id = p_asset_id
    AND pe.project_id <> p_project_id
    AND pr.status IN ('draft', 'editing', 'ready')
    AND pr.shoot_date BETWEEN v_window_start AND v_window_end
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_asset_scheduling_conflict_v2(UUID, UUID, DATE, INT, INT) TO authenticated, service_role;

COMMIT;
