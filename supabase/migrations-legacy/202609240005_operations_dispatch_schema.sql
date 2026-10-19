-- Migration: 202609240005_operations_dispatch_schema.sql
BEGIN;

-- ============================================================================
-- 1. FREELANCER DIRECTORY (crew_members)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.crew_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_code TEXT NOT NULL UNIQUE CHECK (crew_code ~ '^CRW-[A-Z0-9]{2,6}$'),
  full_name TEXT NOT NULL CHECK (length(full_name) BETWEEN 2 AND 160),
  phone TEXT NOT NULL CHECK (length(phone) BETWEEN 8 AND 32),
  email TEXT CHECK (email IS NULL OR length(email) <= 254),
  primary_skills TEXT[] NOT NULL DEFAULT '{}',
  bank_name TEXT NOT NULL,
  bank_account_number TEXT NOT NULL,
  bank_account_holder TEXT NOT NULL,
  standard_day_rate NUMERIC NOT NULL DEFAULT 0 CHECK (standard_day_rate >= 0),
  rating NUMERIC NOT NULL DEFAULT 5.0 CHECK (rating BETWEEN 1.0 AND 5.0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crew_members_skills_idx ON public.crew_members USING gin (primary_skills);
CREATE INDEX IF NOT EXISTS crew_members_active_idx ON public.crew_members (is_active);

-- ============================================================================
-- 2. FREELANCE PROJECT ASSIGNMENTS & CALL SHEETS (project_crew_assignments)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.project_crew_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  crew_member_id UUID NOT NULL REFERENCES public.crew_members(id) ON DELETE RESTRICT,
  magic_token TEXT NOT NULL UNIQUE CHECK (magic_token ~ '^[A-Za-z0-9_-]{32,64}$'),
  role_title TEXT NOT NULL CHECK (length(role_title) BETWEEN 2 AND 100),
  call_time TIMESTAMPTZ NOT NULL,
  roll_time TIMESTAMPTZ,
  venue_name TEXT NOT NULL,
  venue_address TEXT NOT NULL,
  venue_maps_url TEXT,
  dress_code TEXT NOT NULL DEFAULT 'Seragam Hitam / Studio Polo',
  technical_notes TEXT,
  allocated_equipment TEXT[] NOT NULL DEFAULT '{}',
  raw_drop_url TEXT,
  fee_agreed NUMERIC NOT NULL DEFAULT 0 CHECK (fee_agreed >= 0),
  payment_status TEXT NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID', 'PARTIAL', 'PAID')),
  paid_at TIMESTAMPTZ,
  payment_receipt_url TEXT,
  check_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, crew_member_id)
);

CREATE INDEX IF NOT EXISTS pca_project_idx ON public.project_crew_assignments (project_id);
CREATE INDEX IF NOT EXISTS pca_crew_idx ON public.project_crew_assignments (crew_member_id);
CREATE INDEX IF NOT EXISTS pca_token_idx ON public.project_crew_assignments (magic_token);

-- ============================================================================
-- 3. HARDWARE & COST PRESET REGISTRY (equipment_presets)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.equipment_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 2 AND 160),
  category TEXT NOT NULL CHECK (category IN (
    'CAMERA', 'LENS', 'WIRELESS_VIDEO', 'BROADCAST_SWITCHER', 
    'AUDIO', 'INTERCOM', 'LIGHTING', 'SUPPORT_RIG'
  )),
  default_rental_rate NUMERIC NOT NULL DEFAULT 0 CHECK (default_rental_rate >= 0),
  ownership_type TEXT NOT NULL DEFAULT 'IN_HOUSE' CHECK (ownership_type IN ('IN_HOUSE', 'EXTERNAL_RENTAL')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS equipment_presets_cat_idx ON public.equipment_presets (category, is_active);

-- Seed Default Studio & Broadcast Equipment Presets
INSERT INTO public.equipment_presets (name, category, default_rental_rate, ownership_type)
VALUES
  ('Sony FX3 Full-Frame Cinema Body', 'CAMERA', 450000, 'IN_HOUSE'),
  ('Sony A7IV Full-Frame Hybrid Body', 'CAMERA', 350000, 'IN_HOUSE'),
  ('Sony FE 24-70mm f/2.8 GM II', 'LENS', 250000, 'IN_HOUSE'),
  ('Sony FE 70-200mm f/2.8 GM OSS II', 'LENS', 300000, 'IN_HOUSE'),
  ('Hollyland Cosmo C1 Wireless HDMI/SDI Kit', 'WIRELESS_VIDEO', 350000, 'IN_HOUSE'),
  ('Hollyland Mars 4K Wireless Transmitter', 'WIRELESS_VIDEO', 200000, 'IN_HOUSE'),
  ('vMix Broadcast Rig (Core i9 + RTX 4080 + DeckLink 4K)', 'BROADCAST_SWITCHER', 750000, 'IN_HOUSE'),
  ('ATEM Mini Pro HDMI Switcher', 'BROADCAST_SWITCHER', 200000, 'IN_HOUSE'),
  ('Behringer X32 Producer Digital Mixer', 'AUDIO', 400000, 'EXTERNAL_RENTAL'),
  ('Saramonic Blink 500 Pro Wireless Mic (Pair)', 'AUDIO', 100000, 'IN_HOUSE'),
  ('Hollyland Solidcom C1 Pro (4-Station Intercom)', 'INTERCOM', 350000, 'IN_HOUSE'),
  ('Aputure Amaran 200d LED Continuous Light', 'LIGHTING', 150000, 'IN_HOUSE'),
  ('Heavy-Duty Broadcast Tripod w/ Fluid Head', 'SUPPORT_RIG', 100000, 'IN_HOUSE')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- 4. GRANULAR PROJECT EXPENSE WORKSHEET (project_expenses)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.project_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'CREW_FEE', 'EQUIPMENT_RENTAL', 'EQUIPMENT_DEPRECIATION', 
    'TRANSPORT_LOGISTICS', 'MEALS_CONSUMPTION', 'BANDWIDTH_SIM', 
    'SUPPLIES_MISC', 'CLIENT_ADDON'
  )),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  unit_cost NUMERIC NOT NULL CHECK (unit_cost >= 0),
  quantity NUMERIC NOT NULL DEFAULT 1 CHECK (quantity > 0),
  total_cost NUMERIC GENERATED ALWAYS AS (unit_cost * quantity) STORED,
  crew_assignment_id UUID REFERENCES public.project_crew_assignments(id) ON DELETE SET NULL,
  equipment_preset_id UUID REFERENCES public.equipment_presets(id) ON DELETE SET NULL,
  paid_by TEXT NOT NULL DEFAULT 'STUDIO_CASH' CHECK (paid_by IN (
    'STUDIO_CASH', 'FOUNDER_A_ADVANCE', 'FOUNDER_B_ADVANCE', 'CLIENT_BILLED'
  )),
  receipt_proof_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pe_project_category_idx ON public.project_expenses (project_id, category);

-- ============================================================================
-- 5. ZERO-LEAKAGE SECURITY DEFINER RPC (Crew Hub Data Delivery)
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
  SELECT full_name, crew_code, phone, bank_name, bank_account_number, bank_account_holder INTO v_crew
  FROM public.crew_members
  WHERE id = v_assignment.crew_member_id;

  -- 3. Fetch Project Non-Sensitive Metadata ONLY (Strict Zero-Leakage Invariant)
  SELECT id, name, slug, photography_type, service_pillar, shoot_date INTO v_project
  FROM public.projects
  WHERE id = v_assignment.project_id;

  -- 4. Assemble Scoped DTO
  v_response := jsonb_build_object(
    'assignment_id', v_assignment.id,
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
    'crew_member', jsonb_build_object(
      'full_name', v_crew.full_name,
      'crew_code', v_crew.crew_code,
      'bank_name', v_crew.bank_name,
      'bank_account_number', v_crew.bank_account_number,
      'bank_account_holder', v_crew.bank_account_holder
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

REVOKE ALL ON FUNCTION public.get_crew_hub_payload(TEXT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_crew_hub_payload(TEXT) TO anon, authenticated, service_role;

-- ============================================================================
-- 6. AUTOMATED SYNC: CREW ASSIGNMENTS -> PROJECT EXPENSES TRIGGER
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sync_crew_fee_to_expenses()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.project_expenses (
      project_id, category, name, unit_cost, quantity, 
      crew_assignment_id, paid_by, notes
    ) VALUES (
      NEW.project_id,
      'CREW_FEE',
      'Honor: ' || NEW.role_title || ' (' || (SELECT full_name FROM public.crew_members WHERE id = NEW.crew_member_id) || ')',
      NEW.fee_agreed,
      1,
      NEW.id,
      'STUDIO_CASH',
      'Otomatis disinkronkan dari Penugasan Kru'
    );
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.project_expenses
    SET 
      name = 'Honor: ' || NEW.role_title || ' (' || (SELECT full_name FROM public.crew_members WHERE id = NEW.crew_member_id) || ')',
      unit_cost = NEW.fee_agreed,
      updated_at = now()
    WHERE crew_assignment_id = NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM public.project_expenses WHERE crew_assignment_id = OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_crew_fee ON public.project_crew_assignments;
CREATE TRIGGER trg_sync_crew_fee
  AFTER INSERT OR UPDATE OF fee_agreed, role_title OR DELETE
  ON public.project_crew_assignments
  FOR EACH ROW EXECUTE FUNCTION public.sync_crew_fee_to_expenses();

-- Row Level Security (RLS) Policies
ALTER TABLE public.crew_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_crew_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_expenses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crew_members, public.project_crew_assignments, public.equipment_presets, public.project_expenses FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crew_members, public.project_crew_assignments, public.equipment_presets, public.project_expenses TO authenticated;
GRANT ALL ON public.crew_members, public.project_crew_assignments, public.equipment_presets, public.project_expenses TO service_role;


CREATE POLICY admin_all_crew_members ON public.crew_members TO authenticated USING ((SELECT private.is_admin()));
CREATE POLICY admin_all_project_crew ON public.project_crew_assignments TO authenticated USING ((SELECT private.is_admin()));
CREATE POLICY admin_all_equipment_presets ON public.equipment_presets TO authenticated USING ((SELECT private.is_admin()));
CREATE POLICY admin_all_project_expenses ON public.project_expenses TO authenticated USING ((SELECT private.is_admin()));

COMMIT;
