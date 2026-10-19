-- Migration: 202609240007_crew_consent_and_asset_calendar.sql
BEGIN;

-- ============================================================================
-- 1. CLASSIFY CORE TEAM VS. EXTERNAL FREELANCE PERSONNEL
-- ============================================================================
ALTER TABLE public.crew_members
  ADD COLUMN IF NOT EXISTS member_type TEXT NOT NULL DEFAULT 'FREELANCE' 
    CHECK (member_type IN ('CORE_TEAM', 'FREELANCE')),
  ADD COLUMN IF NOT EXISTS jobdesk_specialties TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_crew_member_type ON public.crew_members (member_type, is_active);

-- ============================================================================
-- 2. SEED DEFAULT FIXED CORE TEAM & EXTERNAL FREELANCERS
-- ============================================================================
INSERT INTO public.crew_members (
  id, crew_code, full_name, phone, email, member_type, 
  primary_skills, jobdesk_specialties, bank_name, bank_account_number, 
  bank_account_holder, standard_day_rate, rating, is_active
) VALUES
  -- CORE TEAM (Founders & Managing Partners)
  ('f0000000-0000-0000-0000-000000000001', 'CRW-RAY', 'Rayyan Nufail (Ray)', '081234567890', 'ray@elts.id', 'CORE_TEAM',
   ARRAY['Technical Director', 'Switcher Operator', 'UI/UX Engineer', 'Lead Editor'],
   ARRAY['FOH_SWITCHER', 'TECHNICAL_DIRECTOR', 'LEAD_EDITOR'],
   'BCA', '0000000000', 'Muhammad Rayyan Nufail', 500000, 5.0, true),
  
  ('f0000000-0000-0000-0000-000000000002', 'CRW-EL', 'El (Partner / Creative Lead)', '081234567891', 'el@elts.id', 'CORE_TEAM',
   ARRAY['Director of Photography', 'Creative Director', 'Camera Operator'],
   ARRAY['CAM_MASTER', 'CAM_ROVING', 'CREATIVE_DIRECTOR'],
   'BCA', '0000000000', 'El Partner Studio', 450000, 5.0, true),
  
  ('f0000000-0000-0000-0000-000000000003', 'CRW-CYO', 'Cahyo (Partner / Operations)', '081234567892', 'cahyo@elts.id', 'CORE_TEAM',
   ARRAY['Operations Manager', 'Audio Engineer', 'Camera Operator'],
   ARRAY['AUDIO_ENGINEER', 'CAM_STEADY', 'FIELD_OPERATIONS'],
   'Mandiri', '0000000000000', 'Cahyo Operations', 400000, 5.0, true),

  -- EXTERNAL FREELANCERS
  ('f0000000-0000-0000-0000-000000000004', 'CRW-AZR', 'Azrian (Production Crew)', '081399887766', 'azrian.crew@gmail.com', 'FREELANCE',
   ARRAY['Camera Operator', 'Lighting Technician', 'Gaffer'],
   ARRAY['CAM_ROVING', 'GAFFER', 'GRIP'],
   'BCA', '0000000000', 'Azrian', 350000, 4.9, true),

  ('f0000000-0000-0000-0000-000000000005', 'CRW-FAT', 'Fatteh (Field Support)', '081399887755', 'fatteh.tech@gmail.com', 'FREELANCE',
   ARRAY['Audio Assistant', 'Broadcast Cable Routing', 'Stream Runner'],
   ARRAY['AUDIO_ASSISTANT', 'RUNNER', 'CABLE_TECH'],
   'BRI', '000000000000000', 'Fatteh', 300000, 4.8, true)
ON CONFLICT (crew_code) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  member_type = EXCLUDED.member_type,
  primary_skills = EXCLUDED.primary_skills,
  jobdesk_specialties = EXCLUDED.jobdesk_specialties,
  standard_day_rate = EXCLUDED.standard_day_rate;
-- ============================================================================
-- 3. EXTEND PROJECT CREW ASSIGNMENTS WITH DUAL-CONSENT LIFECYCLE
-- ============================================================================
ALTER TABLE public.project_crew_assignments
  ADD COLUMN IF NOT EXISTS acceptance_status TEXT NOT NULL DEFAULT 'PENDING_OFFER'
    CHECK (acceptance_status IN ('PENDING_OFFER', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS declined_reason TEXT,
  ADD COLUMN IF NOT EXISTS offer_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pca_acceptance ON public.project_crew_assignments (project_id, acceptance_status);

-- ============================================================================
-- 4. CONDITIONAL RAB INGESTION TRIGGER (trg_sync_crew_fee)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sync_crew_fee_to_expenses()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_crew_name TEXT;
BEGIN
  -- Obtain crew member name for line-item description
  SELECT full_name INTO v_crew_name 
  FROM public.crew_members 
  WHERE id = COALESCE(NEW.crew_member_id, OLD.crew_member_id);

  IF TG_OP = 'INSERT' THEN
    -- Only inject into project_expenses if created in ACCEPTED state
    IF NEW.acceptance_status = 'ACCEPTED' THEN
      INSERT INTO public.project_expenses (
        project_id, category, name, unit_cost, quantity, 
        crew_assignment_id, paid_by, notes
      ) VALUES (
        NEW.project_id,
        'CREW_FEE',
        'Honor: ' || NEW.role_title || ' (' || v_crew_name || ')',
        NEW.fee_agreed,
        1,
        NEW.id,
        'STUDIO_CASH',
        'Disetujui oleh kru pada ' || to_char(COALESCE(NEW.accepted_at, now()), 'DD Mon YYYY HH24:MI')
      );
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Transition 1: Offer accepted -> Inject into expenses
    IF NEW.acceptance_status = 'ACCEPTED' AND (OLD.acceptance_status IS DISTINCT FROM 'ACCEPTED') THEN
      INSERT INTO public.project_expenses (
        project_id, category, name, unit_cost, quantity, 
        crew_assignment_id, paid_by, notes
      ) VALUES (
        NEW.project_id,
        'CREW_FEE',
        'Honor: ' || NEW.role_title || ' (' || v_crew_name || ')',
        NEW.fee_agreed,
        1,
        NEW.id,
        'STUDIO_CASH',
        'Disetujui oleh kru pada ' || to_char(COALESCE(NEW.accepted_at, now()), 'DD Mon YYYY HH24:MI')
      )
      ON CONFLICT DO NOTHING;

    -- Transition 2: Still accepted, but fee or role updated -> Update expense line item
    ELSIF NEW.acceptance_status = 'ACCEPTED' AND OLD.acceptance_status = 'ACCEPTED' THEN
      UPDATE public.project_expenses
      SET 
        name = 'Honor: ' || NEW.role_title || ' (' || v_crew_name || ')',
        unit_cost = NEW.fee_agreed,
        updated_at = now()
      WHERE crew_assignment_id = NEW.id;

    -- Transition 3: Revoked or Declined -> Purge from expenses
    ELSIF NEW.acceptance_status <> 'ACCEPTED' AND OLD.acceptance_status = 'ACCEPTED' THEN
      DELETE FROM public.project_expenses WHERE crew_assignment_id = NEW.id;
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM public.project_expenses WHERE crew_assignment_id = OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_crew_fee ON public.project_crew_assignments;
CREATE TRIGGER trg_sync_crew_fee
  AFTER INSERT OR UPDATE OF fee_agreed, role_title, acceptance_status OR DELETE
  ON public.project_crew_assignments
  FOR EACH ROW EXECUTE FUNCTION public.sync_crew_fee_to_expenses();

-- ============================================================================
-- 5. WORKER DUAL-CONSENT RPC: respond_crew_assignment_offer
-- ============================================================================
CREATE OR REPLACE FUNCTION public.respond_crew_assignment_offer(
  p_magic_token TEXT,
  p_accept BOOLEAN,
  p_declined_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_assignment public.project_crew_assignments%ROWTYPE;
  v_response JSONB;
BEGIN
  -- 1. Fetch assignment under row-lock
  SELECT * INTO v_assignment
  FROM public.project_crew_assignments
  WHERE magic_token = p_magic_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TOKEN', 'message', 'Tautan penugasan tidak valid.');
  END IF;

  IF v_assignment.acceptance_status = 'ACCEPTED' AND p_accept = true THEN
    RETURN jsonb_build_object('success', true, 'status', 'ACCEPTED', 'message', 'Penugasan sudah Anda terima sebelumnya.');
  END IF;

  -- 2. Process Acceptance vs. Decline
  IF p_accept THEN
    UPDATE public.project_crew_assignments
    SET 
      acceptance_status = 'ACCEPTED',
      accepted_at = now(),
      declined_at = NULL,
      declined_reason = NULL,
      updated_at = now()
    WHERE id = v_assignment.id;

    v_response := jsonb_build_object(
      'success', true, 
      'status', 'ACCEPTED', 
      'message', 'Tugas berhasil diterima. Rincian call sheet dan perlengkapan aktif sepenuhnya.'
    );
  ELSE
    UPDATE public.project_crew_assignments
    SET 
      acceptance_status = 'DECLINED',
      declined_at = now(),
      declined_reason = COALESCE(p_declined_reason, 'Tidak dapat hadir pada jadwal tersebut'),
      updated_at = now()
    WHERE id = v_assignment.id;

    v_response := jsonb_build_object(
      'success', true, 
      'status', 'DECLINED', 
      'message', 'Penolakan tugas telah dicatat. Studio Owner akan menerima notifikasi untuk penugasan pengganti.'
    );
  END IF;

  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION public.respond_crew_assignment_offer(TEXT, BOOLEAN, TEXT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_crew_assignment_offer(TEXT, BOOLEAN, TEXT) TO anon, authenticated, service_role;

-- ============================================================================
-- 6. ASSET UTILIZATION & BOOKED DATES QUERY RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_asset_utilization_calendar(p_asset_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_asset RECORD;
  v_bookings JSONB;
BEGIN
  SELECT id, asset_code, name, category, source_type, owner_name, vendor_name, daily_rental_rate, condition_status
  INTO v_asset
  FROM public.inventory_assets
  WHERE id = p_asset_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'project_id', pr.id,
    'project_name', pr.name,
    'service_pillar', pr.service_pillar,
    'shoot_date', pr.shoot_date,
    'status', pr.status,
    'quantity', pe.quantity,
    'total_cost', pe.total_cost,
    'return_status', pe.return_status
  ) ORDER BY pr.shoot_date ASC), '[]'::jsonb)
  INTO v_bookings
  FROM public.project_expenses pe
  JOIN public.projects pr ON pr.id = pe.project_id
  WHERE pe.asset_id = p_asset_id
    AND pr.shoot_date IS NOT NULL;

  RETURN jsonb_build_object(
    'asset', row_to_json(v_asset),
    'bookings', v_bookings
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_asset_utilization_calendar(UUID) TO authenticated, service_role;

-- ============================================================================
-- 7. UPDATE get_crew_hub_payload TO EXPOSE ACCEPTANCE STATUS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_crew_hub_payload(p_magic_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_assignment RECORD;
  v_crew RECORD;
  v_project RECORD;
  v_response JSONB;
BEGIN
  -- 1. Fetch Assignment Record
  SELECT * INTO v_assignment
  FROM public.project_crew_assignments
  WHERE magic_token = p_magic_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'INVALID_TOKEN', 'message', 'Tautan kru tidak ditemukan atau telah kedaluwarsa.');
  END IF;

  -- 2. Fetch Crew Member Profile
  SELECT full_name, crew_code, phone INTO v_crew
  FROM public.crew_members
  WHERE id = v_assignment.crew_member_id;

  -- 3. Fetch Project Non-Sensitive Metadata ONLY (Strict Zero-Leakage Invariant)
  SELECT id, name, slug, photography_type, service_pillar, shoot_date INTO v_project
  FROM public.projects
  WHERE id = v_assignment.project_id;

  -- 4. Assemble Scoped DTO
  v_response := jsonb_build_object(
    'assignment_id', v_assignment.id,
    'project_id', v_assignment.project_id,
    'role_title', v_assignment.role_title,
    'call_time', v_assignment.call_time,
    'roll_time', v_assignment.roll_time,
    'venue_name', v_assignment.venue_name,
    'venue_address', v_assignment.venue_address,
    'venue_maps_url', v_assignment.venue_maps_url,
    'dress_code', v_assignment.dress_code,
    'technical_notes', v_assignment.technical_notes,
    'allocated_equipment', v_assignment.allocated_equipment,
    'raw_drop_url', v_assignment.raw_drop_url,
    'fee_agreed', v_assignment.fee_agreed,
    'payment_status', v_assignment.payment_status,
    'paid_at', v_assignment.paid_at,
    'payment_receipt_url', v_assignment.payment_receipt_url,
    'check_in_at', v_assignment.check_in_at,
    'acceptance_status', v_assignment.acceptance_status,
    'accepted_at', v_assignment.accepted_at,
    'declined_at', v_assignment.declined_at,
    'declined_reason', v_assignment.declined_reason,
    'crew_member', jsonb_build_object(
      'full_name', v_crew.full_name,
      'crew_code', v_crew.crew_code
    ),
    'project', jsonb_build_object(
      'name', v_project.name,
      'service_pillar', v_project.service_pillar,
      'shoot_date', v_project.shoot_date
    )
  );

  RETURN v_response;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_crew_hub_payload(TEXT) TO anon, authenticated, service_role;

COMMIT;
