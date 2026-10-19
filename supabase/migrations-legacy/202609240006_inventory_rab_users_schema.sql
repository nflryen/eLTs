-- Migration: 202609240006_inventory_rab_users_schema.sql
BEGIN;

-- ============================================================================
-- 1. EXTEND CREW MEMBERS WITH CLASSIFICATION & ACTIVE AVAILABILITY
-- ============================================================================
ALTER TABLE public.crew_members
  ADD COLUMN IF NOT EXISTS role_category TEXT NOT NULL DEFAULT 'OPERATOR' 
    CHECK (role_category IN ('OPERATOR', 'AUDIO_ENGINEER', 'DIRECTOR', 'EDITOR', 'TECHNICIAN')),
  ADD COLUMN IF NOT EXISTS emergency_contact TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- ============================================================================
-- 2. MASTER INVENTORY & HARDWARE ASSET REGISTRY (inventory_assets)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code TEXT NOT NULL UNIQUE CHECK (asset_code ~ '^AST-[A-Z0-9]{2,6}-[0-9]{2,4}$'),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 160),
  category TEXT NOT NULL CHECK (category IN (
    'CAMERA', 'LENS', 'WIRELESS_VIDEO', 'BROADCAST_SWITCHER', 
    'AUDIO', 'INTERCOM', 'LIGHTING', 'SUPPORT_RIG', 'CABLE_ACCESSORY'
  )),
  source_type TEXT NOT NULL DEFAULT 'IN_HOUSE' CHECK (source_type IN (
    'IN_HOUSE',        -- Milik Studio KINEVA/ELTS
    'PARTNER_OWNED',   -- Milik Co-Founder / Partner (e.g., El, Cahyo)
    'VENDOR_RENTAL'    -- Sewa dari vendor luar (e.g., Koi Rental)
  )),
  owner_name TEXT NOT NULL DEFAULT 'Studio',
  vendor_name TEXT,
  vendor_phone TEXT,
  daily_rental_rate NUMERIC NOT NULL DEFAULT 0 CHECK (daily_rental_rate >= 0),
  replacement_value NUMERIC NOT NULL DEFAULT 0 CHECK (replacement_value >= 0),
  serial_number TEXT,
  condition_status TEXT NOT NULL DEFAULT 'GOOD' CHECK (condition_status IN (
    'EXCELLENT', 'GOOD', 'FAIR', 'MAINTENANCE', 'RETIRED'
  )),
  is_available_for_outgoing_rental BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_category_source ON public.inventory_assets (category, source_type);
CREATE INDEX IF NOT EXISTS idx_inv_vendor ON public.inventory_assets (vendor_name);

-- Seed Default Comprehensive Banyumas Production Assets
INSERT INTO public.inventory_assets (asset_code, name, category, source_type, owner_name, vendor_name, vendor_phone, daily_rental_rate, is_available_for_outgoing_rental)
VALUES
  ('AST-CAM-01', 'Sony FX3 Cinema Line Body', 'CAMERA', 'IN_HOUSE', 'Studio', NULL, NULL, 450000, true),
  ('AST-CAM-02', 'Sony A7IV Full-Frame Body', 'CAMERA', 'IN_HOUSE', 'Studio', NULL, NULL, 350000, true),
  ('AST-CAM-03', 'Sony ZV-E10 Body', 'CAMERA', 'PARTNER_OWNED', 'El', NULL, NULL, 150000, false),
  ('AST-CAM-04', 'Sony A6000 Body (Backup Cam)', 'CAMERA', 'PARTNER_OWNED', 'Cahyo', NULL, NULL, 100000, false),
  ('AST-CAM-05', 'Sony HXR-NX200 Camcorder 4K', 'CAMERA', 'VENDOR_RENTAL', 'Koi Rental', 'Koi Rental Purwokerto', '081327889900', 400000, false),
  ('AST-LNS-01', 'Sony FE 24-70mm f/2.8 GM II', 'LENS', 'IN_HOUSE', 'Studio', NULL, NULL, 250000, true),
  ('AST-LNS-02', 'Sony FE 70-200mm f/2.8 GM OSS II', 'LENS', 'IN_HOUSE', 'Studio', NULL, NULL, 300000, true),
  ('AST-WRL-01', 'Hollyland Cosmo C1 Wireless HDMI/SDI', 'WIRELESS_VIDEO', 'IN_HOUSE', 'Studio', NULL, NULL, 350000, true),
  ('AST-SWT-01', 'vMix 4K Broadcast Rig (Core i9 + RTX 4080)', 'BROADCAST_SWITCHER', 'IN_HOUSE', 'Studio', NULL, NULL, 750000, false),
  ('AST-AUD-01', 'Behringer X32 Producer Digital Mixer', 'AUDIO', 'VENDOR_RENTAL', 'Koi Rental', 'Koi Rental Purwokerto', '081327889900', 400000, false),
  ('AST-ITM-01', 'Hollyland Solidcom C1 Pro 4-Station Intercom', 'INTERCOM', 'IN_HOUSE', 'Studio', NULL, NULL, 350000, true),
  ('AST-CBL-01', 'Kabel HDMI Fiber Optic 20m (4K 60Hz)', 'CABLE_ACCESSORY', 'VENDOR_RENTAL', 'Koi Rental', 'Koi Rental Purwokerto', '081327889900', 50000, false),
  ('AST-CBL-02', 'Kabel SDI Belden 30m w/ Reel', 'CABLE_ACCESSORY', 'IN_HOUSE', 'Studio', NULL, NULL, 40000, true)
ON CONFLICT (asset_code) DO NOTHING;

-- ============================================================================
-- 3. EXTEND PROJECT EXPENSES WITH ASSET LINK & RENTAL LOGISTICS
-- ============================================================================
ALTER TABLE public.project_expenses
  ADD COLUMN IF NOT EXISTS asset_id UUID REFERENCES public.inventory_assets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'IN_HOUSE' 
    CHECK (source_type IN ('IN_HOUSE', 'PARTNER_OWNED', 'VENDOR_RENTAL')),
  ADD COLUMN IF NOT EXISTS owner_name TEXT,
  ADD COLUMN IF NOT EXISTS vendor_name TEXT,
  ADD COLUMN IF NOT EXISTS vendor_phone TEXT,
  ADD COLUMN IF NOT EXISTS rental_duration_days NUMERIC NOT NULL DEFAULT 1 CHECK (rental_duration_days > 0),
  ADD COLUMN IF NOT EXISTS return_date DATE,
  ADD COLUMN IF NOT EXISTS return_status TEXT NOT NULL DEFAULT 'RETURNED' 
    CHECK (return_status IN ('PENDING', 'RETURNED', 'OVERDUE'));

CREATE INDEX IF NOT EXISTS idx_pe_vendor_return ON public.project_expenses (vendor_name, return_status);

-- ============================================================================
-- 4. HARDWARE SCHEDULING COLLISION DETECTOR RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_asset_scheduling_conflict(
  p_asset_id UUID,
  p_project_id UUID,
  p_event_date DATE
)
RETURNS TABLE (
  conflict_found BOOLEAN,
  conflicting_project_id UUID,
  conflicting_project_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    true,
    pr.id,
    pr.name
  FROM public.project_expenses pe
  JOIN public.projects pr ON pr.id = pe.project_id
  WHERE pe.asset_id = p_asset_id
    AND pe.project_id <> p_project_id
    AND pr.shoot_date = p_event_date
    AND pr.status IN ('draft', 'editing', 'ready')
  LIMIT 1;
END;
$$;

-- RLS Policies
ALTER TABLE public.inventory_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_all_inventory ON public.inventory_assets TO authenticated USING ((SELECT private.is_admin()));

GRANT ALL ON TABLE public.inventory_assets TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_asset_scheduling_conflict(UUID, UUID, DATE) TO authenticated, service_role;
COMMIT;
