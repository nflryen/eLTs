-- ============================================================================
-- ELTS STUDIO OS — CONSOLIDATED SCHEMA (0001)
-- ============================================================================
-- Supersedes and replaces all 13 incremental migrations:
--   202609180001_foundation
--   202609180002_private_storage
--   202609190001_gallery_access_and_delivery
--   202609240001_elts_kineva_consolidation
--   202609240002_moodboard_schema
--   202609240003_finance_splits_schema
--   202609240004_calendar_events_schema
--   202609240005_operations_dispatch_schema
--   202609240006_inventory_rab_users_schema
--   202609240007_crew_consent_and_asset_calendar
--   202609240008_phase1_operational_integrity
--   202609270001_sector_specs_and_wizard
--   202609280001_client_invoices_and_crud_extensions
--
-- DESIGN CONTRACT
-- ---------------
-- 1. IDEMPOTENT. Safe to run repeatedly. Every statement is guarded:
--      CREATE TABLE IF NOT EXISTS        / ADD COLUMN IF NOT EXISTS
--      DROP CONSTRAINT IF EXISTS + ADD   / CREATE OR REPLACE FUNCTION
--      DROP TRIGGER IF EXISTS + CREATE   / DROP POLICY IF EXISTS + CREATE
--      INSERT ... ON CONFLICT DO NOTHING
-- 2. ADDITIVE ONLY. No DROP TABLE, no DROP COLUMN. The 5 tables that already
--    exist on the hosted instance (projects, customers, media, favorites,
--    admins) are brought forward via ADD COLUMN IF NOT EXISTS without data loss.
-- 3. TRANSACTIONAL. Wrapped in a single BEGIN/COMMIT. Any failure rolls back
--    everything — there is no partial application state.
-- 4. SELF-VERIFYING. Section 18 asserts the resulting object counts.
--
-- APPLY
-- -----
--   Supabase SQL Editor : paste this entire file and Run
--   CLI                 : DATABASE_URL=... psql "$DATABASE_URL" -f this_file
--   Node runner         : npm run migrate
--   ALWAYS follow with  : NOTIFY pgrst, 'reload schema';   (section 19)
--
-- Without the NOTIFY, PostgREST keeps serving its cached schema and every new
-- table still reports "Could not find the table ... in the schema cache".
-- ============================================================================

BEGIN;

-- ============================================================================
-- 0. EXTENSIONS, SCHEMA, HELPERS
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- pgcrypto is preinstalled on Supabase; guard so the file also runs on a
-- bare Postgres (e.g. CI / PGlite) where the extension may be absent.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgcrypto unavailable — gen_random_uuid() assumed built-in (PG13+)';
END $$;

-- Generic updated_at maintainer.
CREATE OR REPLACE FUNCTION private.set_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$ BEGIN new.updated_at = now(); RETURN new; END; $$;
REVOKE ALL ON FUNCTION private.set_updated_at() FROM PUBLIC, anon;

-- ============================================================================
-- 1. ENUMERATED DOMAIN TYPES
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE public.project_status AS ENUM ('draft','editing','ready','expired','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.photography_type AS ENUM ('wedding','prewedding','graduation','couple','event');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.media_type AS ENUM ('image','video');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 2. IDENTITY: ADMINS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.admins (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Admin predicate. SECURITY DEFINER so RLS policies can call it without
-- recursing through the admins table's own policies.
CREATE OR REPLACE FUNCTION private.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (SELECT 1 FROM public.admins WHERE user_id = (SELECT auth.uid())); $$;
REVOKE ALL ON FUNCTION private.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated, service_role;

-- ============================================================================
-- 3. CUSTOMERS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.customers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  email       text CHECK (length(email) <= 254),
  phone       text CHECK (length(phone) <= 32),
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customers_archived_idx ON public.customers (archived_at);

-- ============================================================================
-- 4. PROJECTS  (includes all 10 previously-missing columns)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.projects (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  name               text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  slug               text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  photography_type   public.photography_type NOT NULL,
  gallery_code       text NOT NULL UNIQUE CHECK (gallery_code ~ '^ELTS-[A-Z0-9]{8}$'),
  gallery_pin_hash   text NOT NULL CHECK (gallery_pin_hash ~ '^scrypt-v[12]\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$'),
  access_token       text NOT NULL UNIQUE CHECK (access_token ~ '^[A-Za-z0-9_-]{43}$'),
  shoot_date         date,
  cover_media_id     uuid,
  status             public.project_status NOT NULL DEFAULT 'draft',
  allow_download     boolean NOT NULL DEFAULT false,
  watermark_enabled  boolean NOT NULL DEFAULT true,
  expires_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_customer_id_idx   ON public.projects (customer_id);
CREATE INDEX IF NOT EXISTS projects_status_expiry_idx ON public.projects (status, expires_at);

-- ── Commercial & sector columns (existed only in later migrations) ──────────
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS contract_value     numeric  DEFAULT 0   CHECK (contract_value >= 0),
  ADD COLUMN IF NOT EXISTS dp_amount          numeric  DEFAULT 0   CHECK (dp_amount >= 0),
  ADD COLUMN IF NOT EXISTS is_dp_paid         boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_fully_paid      boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS service_pillar     text     DEFAULT 'EVENT_GRADUATION_PHOTO',
  ADD COLUMN IF NOT EXISTS selection_quota_min integer NOT NULL DEFAULT 15 CHECK (selection_quota_min >= 0),
  ADD COLUMN IF NOT EXISTS selection_quota_max integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS selection_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS sector_specs       jsonb    NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS rehearsal_date     date;

CREATE INDEX IF NOT EXISTS idx_projects_pillar     ON public.projects (service_pillar);
CREATE INDEX IF NOT EXISTS idx_projects_rehearsal  ON public.projects (rehearsal_date);
CREATE INDEX IF NOT EXISTS idx_projects_shoot_date ON public.projects (shoot_date);

-- ── Normalise legacy pillar values BEFORE the CHECK lands ──────────────────
-- Historical drift produced three spellings of the same concept
-- ('VISUAL_CREATIVE', 'BROADCAST_LIVE_STREAM', 'BROADCAST').
UPDATE public.projects SET service_pillar = 'BROADCAST_LIVE_STREAMING'
  WHERE service_pillar IN ('BROADCAST_LIVE_STREAM','BROADCAST','TECH_SOLUTION');
UPDATE public.projects SET service_pillar = 'COMMERCIAL_VIDEO'
  WHERE service_pillar IN ('VIDEO','AFTERMOVIE');
UPDATE public.projects SET service_pillar = 'EVENT_GRADUATION_PHOTO'
  WHERE service_pillar IS NULL
     OR service_pillar NOT IN ('BROADCAST_LIVE_STREAMING','COMMERCIAL_VIDEO','EVENT_GRADUATION_PHOTO');

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_service_pillar_check;
ALTER TABLE public.projects ADD CONSTRAINT projects_service_pillar_check
  CHECK (service_pillar IN ('BROADCAST_LIVE_STREAMING','COMMERCIAL_VIDEO','EVENT_GRADUATION_PHOTO'));

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_selection_quota_check;
ALTER TABLE public.projects ADD CONSTRAINT projects_selection_quota_check
  CHECK (selection_quota_max >= selection_quota_min);

-- ============================================================================
-- 5. MEDIA & FAVORITES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.media (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  type                        public.media_type NOT NULL,
  file_name                   text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
  mime_type                   text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','video/mp4','video/quicktime')),
  storage_provider            text NOT NULL DEFAULT 'supabase' CHECK (storage_provider IN ('supabase','cloudinary')),
  original_key                text NOT NULL UNIQUE,
  thumbnail_key               text UNIQUE,
  preview_key                 text UNIQUE,
  watermarked_thumbnail_key   text UNIQUE,
  watermarked_preview_key     text UNIQUE,
  cloudinary_public_id        text UNIQUE,
  width                       integer CHECK (width > 0),
  height                      integer CHECK (height > 0),
  file_size                   bigint NOT NULL CHECK (file_size > 0),
  duration_seconds            numeric CHECK (duration_seconds > 0),
  processing_status           text NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending','processing','ready','failed')),
  sort_order                  integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, id),
  CHECK ((type = 'image' AND mime_type LIKE 'image/%') OR (type = 'video' AND mime_type LIKE 'video/%')),
  CHECK (storage_provider <> 'supabase' OR original_key LIKE project_id::text || '/%'),
  CHECK (storage_provider <> 'supabase' OR thumbnail_key IS NULL OR thumbnail_key LIKE project_id::text || '/%'),
  CHECK (storage_provider <> 'supabase' OR preview_key IS NULL OR preview_key LIKE project_id::text || '/%'),
  CHECK (storage_provider <> 'supabase' OR watermarked_thumbnail_key IS NULL OR watermarked_thumbnail_key LIKE project_id::text || '/%'),
  CHECK (storage_provider <> 'supabase' OR watermarked_preview_key IS NULL OR watermarked_preview_key LIKE project_id::text || '/%')
);
CREATE INDEX IF NOT EXISTS media_project_order_idx ON public.media (project_id, sort_order, created_at);

ALTER TABLE public.media ADD COLUMN IF NOT EXISTS cloudinary_delivery_type text;
ALTER TABLE public.media DROP CONSTRAINT IF EXISTS media_cloudinary_delivery_type_check;
ALTER TABLE public.media ADD CONSTRAINT media_cloudinary_delivery_type_check
  CHECK (cloudinary_delivery_type IS NULL OR cloudinary_delivery_type IN ('upload','authenticated'));

-- Composite FK prerequisites. A drifted hosted instance created before these
-- migrations may lack the unique keys the composite FKs reference, so they are
-- added defensively here rather than assumed.
DO $$ BEGIN
  ALTER TABLE public.media ADD CONSTRAINT media_project_id_id_key UNIQUE (project_id, id);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;


-- Composite FK: a cover must belong to the same project.
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_cover_same_project_fk;
ALTER TABLE public.projects ADD CONSTRAINT projects_cover_same_project_fk
  FOREIGN KEY (id, cover_media_id) REFERENCES public.media(project_id, id)
  ON DELETE SET NULL (cover_media_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS private.gallery_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  token_hash     text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  gallery_access boolean NOT NULL DEFAULT true,
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, id),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS gallery_sessions_project_id_idx ON private.gallery_sessions (project_id);
CREATE INDEX IF NOT EXISTS gallery_sessions_expiry_idx     ON private.gallery_sessions (expires_at);

-- Defensive: the composite FKs below require these unique keys, which may be
-- absent on a hosted instance created before the migrations were applied.
DO $$ BEGIN
  ALTER TABLE private.gallery_sessions ADD CONSTRAINT gallery_sessions_project_id_id_key UNIQUE (project_id, id);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.favorites (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  media_id   uuid NOT NULL,
  session_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, media_id)   REFERENCES public.media(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, session_id) REFERENCES private.gallery_sessions(project_id, id) ON DELETE RESTRICT,
  UNIQUE (session_id, media_id)
);
CREATE INDEX IF NOT EXISTS favorites_project_id_idx      ON public.favorites (project_id);
CREATE INDEX IF NOT EXISTS favorites_media_id_idx        ON public.favorites (media_id);
CREATE INDEX IF NOT EXISTS favorites_project_session_idx ON public.favorites (project_id, session_id);

CREATE TABLE IF NOT EXISTS private.gallery_rate_limits (
  bucket_key text PRIMARY KEY CHECK (length(bucket_key) <= 128),
  attempts   integer NOT NULL CHECK (attempts > 0),
  resets_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS gallery_rate_limits_resets_idx ON private.gallery_rate_limits (resets_at);

-- ============================================================================
-- 6. CREW MEMBERS  (with tax identity fields for PPh 21 readiness)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.crew_members (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_code           text NOT NULL UNIQUE CHECK (crew_code ~ '^CRW-[A-Z0-9]{2,6}$'),
  full_name           text NOT NULL CHECK (length(full_name) BETWEEN 2 AND 160),
  phone               text NOT NULL CHECK (length(phone) BETWEEN 8 AND 32),
  email               text CHECK (email IS NULL OR length(email) <= 254),
  primary_skills      text[] NOT NULL DEFAULT '{}',
  bank_name           text NOT NULL,
  bank_account_number text NOT NULL,
  bank_account_holder text NOT NULL,
  standard_day_rate   numeric NOT NULL DEFAULT 0 CHECK (standard_day_rate >= 0),
  rating              numeric NOT NULL DEFAULT 5.0 CHECK (rating BETWEEN 1.0 AND 5.0),
  is_active           boolean NOT NULL DEFAULT true,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crew_members_skills_idx ON public.crew_members USING gin (primary_skills);
CREATE INDEX IF NOT EXISTS crew_members_active_idx ON public.crew_members (is_active);

ALTER TABLE public.crew_members
  ADD COLUMN IF NOT EXISTS role_category   text NOT NULL DEFAULT 'OPERATOR'
    CHECK (role_category IN ('OPERATOR','AUDIO_ENGINEER','DIRECTOR','EDITOR','TECHNICIAN')),
  ADD COLUMN IF NOT EXISTS emergency_contact text,
  ADD COLUMN IF NOT EXISTS avatar_url      text,
  ADD COLUMN IF NOT EXISTS member_type     text NOT NULL DEFAULT 'FREELANCE'
    CHECK (member_type IN ('CORE_TEAM','FREELANCE')),
  ADD COLUMN IF NOT EXISTS jobdesk_specialties text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_crew_member_type ON public.crew_members (member_type, is_active);

-- ============================================================================
-- 7. CREW ASSIGNMENTS (call sheets + dual-consent lifecycle)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.project_crew_assignments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  crew_member_id      uuid NOT NULL REFERENCES public.crew_members(id) ON DELETE RESTRICT,
  magic_token         text NOT NULL UNIQUE CHECK (magic_token ~ '^[A-Za-z0-9_-]{32,64}$'),
  role_title          text NOT NULL CHECK (length(role_title) BETWEEN 2 AND 100),
  call_time           timestamptz NOT NULL,
  roll_time           timestamptz,
  venue_name          text NOT NULL,
  venue_address       text NOT NULL,
  venue_maps_url      text,
  dress_code          text NOT NULL DEFAULT 'Seragam Hitam / Studio Polo',
  technical_notes     text,
  allocated_equipment text[] NOT NULL DEFAULT '{}',
  raw_drop_url        text,
  fee_agreed          numeric NOT NULL DEFAULT 0 CHECK (fee_agreed >= 0),
  payment_status      text NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID','PARTIAL','PAID')),
  paid_at             timestamptz,
  payment_receipt_url text,
  check_in_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, crew_member_id)
);
CREATE INDEX IF NOT EXISTS pca_project_idx ON public.project_crew_assignments (project_id);
CREATE INDEX IF NOT EXISTS pca_crew_idx    ON public.project_crew_assignments (crew_member_id);
CREATE INDEX IF NOT EXISTS pca_token_idx   ON public.project_crew_assignments (magic_token);

ALTER TABLE public.project_crew_assignments
  ADD COLUMN IF NOT EXISTS acceptance_status text NOT NULL DEFAULT 'PENDING_OFFER'
    CHECK (acceptance_status IN ('PENDING_OFFER','ACCEPTED','DECLINED','EXPIRED')),
  ADD COLUMN IF NOT EXISTS accepted_at     timestamptz,
  ADD COLUMN IF NOT EXISTS declined_at     timestamptz,
  ADD COLUMN IF NOT EXISTS declined_reason text,
  ADD COLUMN IF NOT EXISTS offer_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_pca_acceptance ON public.project_crew_assignments (project_id, acceptance_status);

-- ============================================================================
-- 8. EQUIPMENT PRESETS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.equipment_presets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL UNIQUE CHECK (length(name) BETWEEN 2 AND 160),
  category            text NOT NULL CHECK (category IN (
                        'CAMERA','LENS','WIRELESS_VIDEO','BROADCAST_SWITCHER',
                        'AUDIO','INTERCOM','LIGHTING','SUPPORT_RIG')),
  default_rental_rate numeric NOT NULL DEFAULT 0 CHECK (default_rental_rate >= 0),
  ownership_type      text NOT NULL DEFAULT 'IN_HOUSE' CHECK (ownership_type IN ('IN_HOUSE','EXTERNAL_RENTAL')),
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS equipment_presets_cat_idx ON public.equipment_presets (category, is_active);

-- ============================================================================
-- 9. INVENTORY ASSETS  (3-tier ownership + power/rental characteristics)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_assets (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code                    text NOT NULL UNIQUE CHECK (asset_code ~ '^AST-[A-Z0-9]{2,6}-[0-9]{2,4}$'),
  name                          text NOT NULL CHECK (length(name) BETWEEN 2 AND 160),
  category                      text NOT NULL CHECK (category IN (
                                  'CAMERA','LENS','WIRELESS_VIDEO','BROADCAST_SWITCHER',
                                  'AUDIO','INTERCOM','LIGHTING','SUPPORT_RIG','CABLE_ACCESSORY')),
  source_type                   text NOT NULL DEFAULT 'IN_HOUSE' CHECK (source_type IN (
                                  'IN_HOUSE','PARTNER_OWNED','VENDOR_RENTAL')),
  owner_name                    text NOT NULL DEFAULT 'Studio',
  vendor_name                   text,
  vendor_phone                  text,
  daily_rental_rate             numeric NOT NULL DEFAULT 0 CHECK (daily_rental_rate >= 0),
  replacement_value             numeric NOT NULL DEFAULT 0 CHECK (replacement_value >= 0),
  serial_number                 text,
  condition_status              text NOT NULL DEFAULT 'GOOD' CHECK (condition_status IN (
                                  'EXCELLENT','GOOD','FAIR','MAINTENANCE','RETIRED')),
  is_available_for_outgoing_rental boolean NOT NULL DEFAULT false,
  notes                         text,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_category_source ON public.inventory_assets (category, source_type);
CREATE INDEX IF NOT EXISTS idx_inv_vendor          ON public.inventory_assets (vendor_name);

-- Power / rental characteristics (feeds Packing Slip + Venue Power budget)
ALTER TABLE public.inventory_assets
  ADD COLUMN IF NOT EXISTS power_draw_watts    numeric CHECK (power_draw_watts >= 0),
  ADD COLUMN IF NOT EXISTS power_peak_watts    numeric CHECK (power_peak_watts >= 0),
  ADD COLUMN IF NOT EXISTS requires_clean_earth boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_ups        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS accessories_default jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ============================================================================
-- 10. PROJECT EXPENSES  (RAB / dual-stream manifest / two-bucket cash math)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.project_expenses (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  category             text NOT NULL CHECK (category IN (
                         'CREW_FEE','EQUIPMENT_RENTAL','EQUIPMENT_DEPRECIATION',
                         'TRANSPORT_LOGISTICS','MEALS_CONSUMPTION','BANDWIDTH_SIM',
                         'SUPPLIES_MISC','CLIENT_ADDON')),
  name                 text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  unit_cost            numeric NOT NULL CHECK (unit_cost >= 0),
  quantity             numeric NOT NULL DEFAULT 1 CHECK (quantity > 0),
  total_cost           numeric GENERATED ALWAYS AS (unit_cost * quantity) STORED,
  crew_assignment_id   uuid REFERENCES public.project_crew_assignments(id) ON DELETE CASCADE,
  equipment_preset_id  uuid REFERENCES public.equipment_presets(id) ON DELETE SET NULL,
  paid_by              text NOT NULL DEFAULT 'STUDIO_CASH' CHECK (paid_by IN (
                         'STUDIO_CASH','FOUNDER_A_ADVANCE','FOUNDER_B_ADVANCE','CLIENT_BILLED')),
  receipt_proof_url    text,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pe_project_category_idx ON public.project_expenses (project_id, category);

-- Two-bucket routing: cash outflow vs. in-house gear depreciation (non-cash)
ALTER TABLE public.project_expenses
  ADD COLUMN IF NOT EXISTS is_cash_outflow boolean NOT NULL DEFAULT true;

UPDATE public.project_expenses SET is_cash_outflow = false
  WHERE category = 'EQUIPMENT_DEPRECIATION';

-- Asset linkage + vendor rental logistics (feeds both export streams)
ALTER TABLE public.project_expenses
  ADD COLUMN IF NOT EXISTS asset_id              uuid REFERENCES public.inventory_assets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_type           text NOT NULL DEFAULT 'IN_HOUSE'
    CHECK (source_type IN ('IN_HOUSE','PARTNER_OWNED','VENDOR_RENTAL')),
  ADD COLUMN IF NOT EXISTS owner_name            text,
  ADD COLUMN IF NOT EXISTS vendor_name           text,
  ADD COLUMN IF NOT EXISTS vendor_phone          text,
  ADD COLUMN IF NOT EXISTS rental_duration_days  numeric NOT NULL DEFAULT 1 CHECK (rental_duration_days > 0),
  ADD COLUMN IF NOT EXISTS return_date           date,
  ADD COLUMN IF NOT EXISTS return_status         text NOT NULL DEFAULT 'RETURNED'
    CHECK (return_status IN ('PENDING','RETURNED','OVERDUE'));

-- Stream A (packing slip) preparation state
ALTER TABLE public.project_expenses
  ADD COLUMN IF NOT EXISTS pack_status       text NOT NULL DEFAULT 'PENDING'
    CHECK (pack_status IN ('PENDING','PACKED','LOADED','RETURNED','MISSING')),
  ADD COLUMN IF NOT EXISTS pack_checked_at   timestamptz,
  ADD COLUMN IF NOT EXISTS pack_checked_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS return_condition  text
    CHECK (return_condition IN ('GOOD','DAMAGED','LOST')),
  ADD COLUMN IF NOT EXISTS accessories       jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_pe_vendor_return ON public.project_expenses (vendor_name, return_status);
CREATE INDEX IF NOT EXISTS idx_pe_cash_outflow  ON public.project_expenses (project_id, is_cash_outflow);
CREATE INDEX IF NOT EXISTS idx_pe_asset         ON public.project_expenses (asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pe_pack_status   ON public.project_expenses (project_id, pack_status);
CREATE INDEX IF NOT EXISTS idx_pe_source_type   ON public.project_expenses (project_id, source_type);

-- A CREW_FEE row must always trace back to a real assignment.
ALTER TABLE public.project_expenses DROP CONSTRAINT IF EXISTS chk_crew_fee_requires_assignment;
ALTER TABLE public.project_expenses ADD CONSTRAINT chk_crew_fee_requires_assignment
  CHECK (category <> 'CREW_FEE' OR crew_assignment_id IS NOT NULL);

-- ============================================================================
-- 11. DOCUMENT NUMBERING (atomic, gap-free, per-type per-period)
-- ============================================================================
-- Replaces the ad-hoc `INV-${Date.now()}` pattern, which collides under
-- concurrency and leaves gaps when rows are deleted. A single upsert on a
-- counter row is atomic and monotonic.
CREATE TABLE IF NOT EXISTS public.document_sequences (
  doc_type   text NOT NULL,          -- 'INV' | 'PO' | 'OUT' | 'RCP'
  period_key text NOT NULL,          -- 'YYYY-MM'
  last_value integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_type, period_key)
);

CREATE OR REPLACE FUNCTION public.next_document_number(
  p_doc_type   text,
  p_period_key text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_next integer;
BEGIN
  IF p_doc_type NOT IN ('INV','PO','OUT','RCP') THEN
    RAISE EXCEPTION 'Unknown document type: %', p_doc_type;
  END IF;
  IF p_period_key !~ '^[0-9]{4}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'Invalid period key (expected YYYY-MM): %', p_period_key;
  END IF;

  INSERT INTO public.document_sequences (doc_type, period_key, last_value)
  VALUES (p_doc_type, p_period_key, 1)
  ON CONFLICT (doc_type, period_key)
    DO UPDATE SET last_value = public.document_sequences.last_value + 1,
                  updated_at = now()
  RETURNING last_value INTO v_next;

  RETURN p_doc_type || '/' || replace(p_period_key, '-', '/') || '/' ||
         lpad(v_next::text, 4, '0');
END;
$$;
REVOKE ALL ON FUNCTION public.next_document_number(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_document_number(text, text) TO authenticated, service_role;

-- ============================================================================
-- 12. CLIENT INVOICES + PAYMENT RECEIPT LEDGER
-- ============================================================================
-- LEDGER SPINE, DOCUMENT SKIN:
--   gross_contract_value is IMMUTABLE (the contract).
--   Payments are ROWS in invoice_payment_receipts, never columns.
--   Balance and status are DERIVED (see v_invoice_financial_position).
-- This is what allows a custom DP (e.g. 8,000,000 against a 15,000,000
-- contract with a 30% floor) to be represented without corrupting the
-- contract record.
CREATE TABLE IF NOT EXISTS public.project_invoices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  invoice_number        text NOT NULL UNIQUE CHECK (invoice_number ~ '^INV/[0-9]{4}/[0-9]{2}/[0-9]{4}$'),
  issue_date            date NOT NULL DEFAULT CURRENT_DATE,
  due_date              date NOT NULL CHECK (due_date >= issue_date),
  line_items            jsonb NOT NULL DEFAULT '[]'::jsonb,
  gross_contract_value  numeric NOT NULL CHECK (gross_contract_value >= 0),
  minimum_dp_pct        numeric NOT NULL DEFAULT 30 CHECK (minimum_dp_pct BETWEEN 0 AND 100),
  client_notes          text,
  pdf_storage_key       text,
  is_cancelled          boolean NOT NULL DEFAULT false,
  cancelled_reason      text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pi_project    ON public.project_invoices (project_id);
CREATE INDEX IF NOT EXISTS idx_pi_issue_date ON public.project_invoices (issue_date DESC);

-- Payment receipts: the ledger. A negative amount is a refund / credit note.
CREATE TABLE IF NOT EXISTS public.invoice_payment_receipts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id        uuid NOT NULL REFERENCES public.project_invoices(id) ON DELETE RESTRICT,
  receipt_number    text NOT NULL UNIQUE CHECK (receipt_number ~ '^RCP/[0-9]{4}/[0-9]{2}/[0-9]{4}$'),
  amount            numeric NOT NULL CHECK (amount <> 0),
  currency          text NOT NULL DEFAULT 'IDR',
  payment_method    text NOT NULL CHECK (payment_method IN (
                      'BANK_TRANSFER','CASH','QRIS','E_WALLET','CHEQUE','CREDIT_NOTE')),
  bank_name         text,
  reference_number  text,
  received_at       timestamptz NOT NULL DEFAULT now(),
  proof_storage_key text,
  applied_to        text NOT NULL DEFAULT 'UNALLOCATED' CHECK (applied_to IN (
                      'DP','FINAL_BALANCE','ADDON','LATE_FEE','DAMAGE','UNALLOCATED')),
  -- Verification gate: an unverified receipt is a claim, not cash.
  verified_at       timestamptz,
  verified_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes             text,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ipr_invoice  ON public.invoice_payment_receipts (invoice_id);
CREATE INDEX IF NOT EXISTS idx_ipr_received ON public.invoice_payment_receipts (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ipr_verified ON public.invoice_payment_receipts (invoice_id)
  WHERE verified_at IS NOT NULL;

-- Derived financial position. The single source of truth for balance & status.
-- Only VERIFIED receipts count toward the balance.
CREATE OR REPLACE VIEW public.v_invoice_financial_position AS
SELECT
  inv.id                                   AS invoice_id,
  inv.invoice_number,
  inv.project_id,
  inv.issue_date,
  inv.due_date,
  inv.gross_contract_value                 AS contract_value,
  inv.minimum_dp_pct,
  ROUND(inv.gross_contract_value * inv.minimum_dp_pct / 100.0, 2) AS minimum_dp_required,
  COALESCE(SUM(r.amount) FILTER (WHERE r.verified_at IS NOT NULL), 0) AS paid_amount,
  COALESCE(SUM(r.amount) FILTER (WHERE r.verified_at IS NULL), 0)     AS unverified_amount,
  inv.gross_contract_value
    - COALESCE(SUM(r.amount) FILTER (WHERE r.verified_at IS NOT NULL), 0) AS balance_due,
  GREATEST(
    COALESCE(SUM(r.amount) FILTER (WHERE r.verified_at IS NOT NULL), 0)
      - inv.gross_contract_value,
    0)                                                                 AS overpayment_amount,
  CASE
    WHEN inv.is_cancelled THEN 'CANCELLED'
    WHEN COALESCE(SUM(r.amount) FILTER (WHERE r.verified_at IS NOT NULL),0) <= 0 THEN 'UNPAID'
    WHEN COALESCE(SUM(r.amount) FILTER (WHERE r.verified_at IS NOT NULL),0)
         < inv.gross_contract_value THEN 'PARTIALLY_PAID'
    WHEN COALESCE(SUM(r.amount) FILTER (WHERE r.verified_at IS NOT NULL),0)
         = inv.gross_contract_value THEN 'PAID_IN_FULL'
    ELSE 'OVERPAID'
  END                                      AS derived_status,
  CASE
    WHEN COALESCE(SUM(r.amount) FILTER (WHERE r.verified_at IS NOT NULL),0)
         >= ROUND(inv.gross_contract_value * inv.minimum_dp_pct / 100.0, 2)
    THEN true ELSE false
  END                                      AS dp_floor_satisfied
FROM public.project_invoices inv
LEFT JOIN public.invoice_payment_receipts r ON r.invoice_id = inv.id
GROUP BY inv.id;

-- Keep projects.is_dp_paid / is_fully_paid synchronized with the ledger.
CREATE OR REPLACE FUNCTION public.sync_project_payment_from_ledger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_invoice_id uuid := COALESCE(NEW.invoice_id, OLD.invoice_id);
  v_position   record;
BEGIN
  SELECT * INTO v_position
  FROM public.v_invoice_financial_position
  WHERE invoice_id = v_invoice_id;

  IF FOUND THEN
    UPDATE public.projects
    SET is_dp_paid    = v_position.dp_floor_satisfied,
        is_fully_paid = v_position.derived_status IN ('PAID_IN_FULL','OVERPAID'),
        updated_at    = now()
    WHERE id = v_position.project_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_payment_from_receipt ON public.invoice_payment_receipts;
CREATE TRIGGER trg_sync_payment_from_receipt
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_payment_receipts
  FOR EACH ROW EXECUTE FUNCTION public.sync_project_payment_from_ledger();

-- ============================================================================
-- 13. VENDOR PURCHASE ORDERS  (Stream B — external rental houses)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.vendor_purchase_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number       text NOT NULL UNIQUE CHECK (po_number ~ '^PO/[0-9]{4}/[0-9]{2}/[0-9]{4}$'),
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  vendor_name     text NOT NULL,
  vendor_phone    text,
  vendor_address  text,
  pickup_at       timestamptz NOT NULL,
  return_due_at   timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
                    'DRAFT','SENT','CONFIRMED','PICKED_UP','RETURNED','CANCELLED')),
  -- Snapshot, not derived: an issued PO must not silently change face value.
  subtotal        numeric NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  deposit_amount  numeric NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  wa_sent_at      timestamptz,
  confirmed_at    timestamptz,
  picked_up_at    timestamptz,
  returned_at     timestamptz,
  notes           text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (return_due_at > pickup_at)
);
CREATE INDEX IF NOT EXISTS idx_vpo_project ON public.vendor_purchase_orders (project_id);
CREATE INDEX IF NOT EXISTS idx_vpo_vendor  ON public.vendor_purchase_orders (vendor_name, status);
CREATE INDEX IF NOT EXISTS idx_vpo_window  ON public.vendor_purchase_orders (pickup_at, return_due_at);

CREATE TABLE IF NOT EXISTS public.vendor_purchase_order_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id       uuid NOT NULL REFERENCES public.vendor_purchase_orders(id) ON DELETE CASCADE,
  asset_id    uuid REFERENCES public.inventory_assets(id) ON DELETE SET NULL,
  description text NOT NULL CHECK (length(description) BETWEEN 2 AND 200),
  quantity    numeric NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_days   numeric NOT NULL DEFAULT 1 CHECK (unit_days > 0),
  unit_rate   numeric NOT NULL DEFAULT 0 CHECK (unit_rate >= 0),
  line_total  numeric GENERATED ALWAYS AS (quantity * unit_days * unit_rate) STORED,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vpoi_po ON public.vendor_purchase_order_items (po_id);

-- ============================================================================
-- 14. OUTGOING RENTALS  (studio gear rented OUT — a demand source, not a flag)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.outgoing_rental_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number      text NOT NULL UNIQUE CHECK (order_number ~ '^OUT/[0-9]{4}/[0-9]{2}/[0-9]{4}$'),
  renter_name       text NOT NULL CHECK (length(renter_name) BETWEEN 2 AND 160),
  renter_type       text NOT NULL DEFAULT 'INDIVIDUAL'
                      CHECK (renter_type IN ('INDIVIDUAL','COMPANY','CREW_EXTERNAL')),
  company_name      text,
  renter_phone      text NOT NULL,
  renter_email      text,
  ktp_number        text,
  ktp_photo_key     text,
  ktp_verified_at   timestamptz,
  ktp_verified_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  pickup_at         timestamptz NOT NULL,
  return_due_at     timestamptz NOT NULL,
  buffer_hours      numeric NOT NULL DEFAULT 2 CHECK (buffer_hours >= 0),
  actual_returned_at timestamptz,
  rental_days       numeric NOT NULL DEFAULT 1 CHECK (rental_days > 0),
  subtotal          numeric NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  deposit_amount    numeric NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  deposit_held_at   timestamptz,
  deposit_refunded_at timestamptz,
  late_fee_accrued  numeric NOT NULL DEFAULT 0 CHECK (late_fee_accrued >= 0),
  late_fee_per_day  numeric NOT NULL DEFAULT 0 CHECK (late_fee_per_day >= 0),
  damage_charge     numeric NOT NULL DEFAULT 0 CHECK (damage_charge >= 0),
  status            text NOT NULL DEFAULT 'BOOKED' CHECK (status IN (
                      'BOOKED','PICKED_UP','IN_USE','RETURNED','OVERDUE','CANCELLED')),
  condition_on_return text CHECK (condition_on_return IN ('GOOD','DAMAGED','LOST')),
  notes             text,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (return_due_at > pickup_at)
);
CREATE INDEX IF NOT EXISTS idx_oro_status       ON public.outgoing_rental_orders (status);
CREATE INDEX IF NOT EXISTS idx_oro_window       ON public.outgoing_rental_orders (pickup_at, return_due_at);
CREATE INDEX IF NOT EXISTS idx_oro_renter_phone ON public.outgoing_rental_orders (renter_phone);

CREATE TABLE IF NOT EXISTS public.outgoing_rental_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES public.outgoing_rental_orders(id) ON DELETE CASCADE,
  -- RESTRICT: an asset with rental history is a legal record. Never silently drop it.
  asset_id        uuid NOT NULL REFERENCES public.inventory_assets(id) ON DELETE RESTRICT,
  quantity        numeric NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_rate       numeric NOT NULL DEFAULT 0 CHECK (unit_rate >= 0),
  line_total      numeric GENERATED ALWAYS AS (quantity * unit_rate) STORED,
  condition_out   text NOT NULL DEFAULT 'GOOD' CHECK (condition_out IN ('EXCELLENT','GOOD','FAIR')),
  accessories_out jsonb NOT NULL DEFAULT '{}'::jsonb,
  accessories_in  jsonb,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ori_order ON public.outgoing_rental_items (order_id);
CREATE INDEX IF NOT EXISTS idx_ori_asset ON public.outgoing_rental_items (asset_id);

-- ============================================================================
-- 15. PORTFOLIO SHOWCASE  (public bridge — separate table by design)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.portfolio_showcases (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SET NULL, not CASCADE: archiving a project must not destroy public content.
  project_id     uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  slug           text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title          text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  summary        text CHECK (length(summary) <= 600),
  category       text NOT NULL CHECK (category IN (
                   'BROADCAST_LIVE_STREAMING','COMMERCIAL_VIDEO','EVENT_GRADUATION_PHOTO')),
  cover_media_id uuid REFERENCES public.media(id) ON DELETE SET NULL,
  cover_url      text,
  embed_url      text,
  embed_provider text CHECK (embed_provider IN ('YOUTUBE','VIMEO','NONE')),
  embed_video_id text,
  thumbnail_url  text,
  client_name    text,
  client_logo_url text,
  credits        jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags           text[] NOT NULL DEFAULT '{}',
  is_published   boolean NOT NULL DEFAULT false,
  is_featured    boolean NOT NULL DEFAULT false,
  sort_order     integer NOT NULL DEFAULT 0,
  published_at   timestamptz,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ps_public   ON public.portfolio_showcases (is_published, sort_order)
  WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_ps_featured ON public.portfolio_showcases (is_featured)
  WHERE is_featured = true AND is_published = true;
CREATE INDEX IF NOT EXISTS idx_ps_category ON public.portfolio_showcases (category, published_at DESC);

-- ============================================================================
-- 16. MOODBOARD, CALENDAR, FINANCE, EDITOR TASKS, INQUIRIES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.moodboard_cards (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  card_type  text NOT NULL CHECK (card_type IN ('IMAGE_REF','COLOR_SWATCH','SHOT_LIST','TECH_NOTE')),
  title      text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS moodboard_cards_project_id_idx   ON public.moodboard_cards (project_id);
CREATE INDEX IF NOT EXISTS moodboard_cards_project_sort_idx ON public.moodboard_cards (project_id, sort_order, created_at);

CREATE TABLE IF NOT EXISTS public.moodboard_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id     uuid NOT NULL REFERENCES public.moodboard_cards(id) ON DELETE CASCADE,
  author_role text NOT NULL CHECK (author_role IN ('CLIENT','STUDIO')),
  author_name text NOT NULL,
  content     text NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS moodboard_comments_card_id_idx ON public.moodboard_comments (card_id, created_at ASC);

CREATE TABLE IF NOT EXISTS public.studio_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  event_type       text NOT NULL CHECK (event_type IN ('DISCOVERY_CALL','PRE_PRODUCTION','FIELD_SHOOT','DEADLINE')),
  client_name      text,
  client_phone     text,
  client_email     text,
  service_interest text,
  start_time       timestamptz NOT NULL,
  end_time         timestamptz NOT NULL CHECK (end_time > start_time),
  project_id       uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  assigned_crew_ids text[],
  google_event_id  text,
  meet_link        text,
  notes            text,
  status           text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','COMPLETED','CANCELLED')),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_events_start_end_idx  ON public.studio_events (start_time, end_time);
CREATE INDEX IF NOT EXISTS studio_events_status_idx     ON public.studio_events (status);
CREATE INDEX IF NOT EXISTS studio_events_event_type_idx ON public.studio_events (event_type);
CREATE INDEX IF NOT EXISTS studio_events_project_id_idx ON public.studio_events (project_id);
CREATE INDEX IF NOT EXISTS studio_events_google_id_idx  ON public.studio_events (google_event_id);

CREATE TABLE IF NOT EXISTS public.money_splits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
  gross_revenue   numeric NOT NULL CHECK (gross_revenue >= 0),
  direct_costs    numeric NOT NULL DEFAULT 0 CHECK (direct_costs >= 0),
  net_profit      numeric NOT NULL CHECK (net_profit >= 0),
  reserve_pct     numeric NOT NULL DEFAULT 5.0,
  reserve_amount  numeric NOT NULL DEFAULT 0 CHECK (reserve_amount >= 0),
  commission_pct  numeric NOT NULL DEFAULT 0.0,
  commission_amount numeric NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),
  closer_name     text,
  founder_a_share numeric NOT NULL DEFAULT 0 CHECK (founder_a_share >= 0),
  founder_b_share numeric NOT NULL DEFAULT 0 CHECK (founder_b_share >= 0),
  approved_by_a   boolean NOT NULL DEFAULT false,
  approved_by_b   boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS money_splits_project_id_idx ON public.money_splits (project_id);
CREATE INDEX IF NOT EXISTS money_splits_status_idx     ON public.money_splits (status);

CREATE TABLE IF NOT EXISTS public.cash_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  type        text NOT NULL CHECK (type IN ('INFLOW','OUTFLOW','FOUNDER_ADVANCE')),
  category    text NOT NULL CHECK (category IN (
                'PROJECT_SPLIT','EQUIPMENT_MAINTENANCE','RESERVE_INFLOW',
                'DIVIDEND_PAYOUT','OPERATIONAL')),
  amount      numeric NOT NULL CHECK (amount > 0),
  description text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cash_ledger_project_id_idx ON public.cash_ledger (project_id);
CREATE INDEX IF NOT EXISTS cash_ledger_category_idx   ON public.cash_ledger (category);
CREATE INDEX IF NOT EXISTS cash_ledger_created_at_idx ON public.cash_ledger (created_at DESC);

CREATE TABLE IF NOT EXISTS public.editor_tasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  assigned_editor_id  text,
  status              text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_PROGRESS','REVIEW','COMPLETED')),
  deliverable_count   integer NOT NULL DEFAULT 0 CHECK (deliverable_count >= 0),
  notes               text,
  manifest_json       jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS editor_tasks_project_id_idx ON public.editor_tasks (project_id);
CREATE INDEX IF NOT EXISTS editor_tasks_status_idx     ON public.editor_tasks (status);

CREATE TABLE IF NOT EXISTS public.inquiries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  brand_name   text,
  email        text CHECK (email IS NULL OR length(email) <= 254),
  phone        text NOT NULL CHECK (length(phone) BETWEEN 8 AND 32),
  pillar       text,
  budget_range text,
  message      text NOT NULL CHECK (length(message) BETWEEN 10 AND 2000),
  source_page  text,
  status       text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','CONTACTED','QUOTED','CONVERTED','ARCHIVED')),
  converted_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inquiries_status_idx  ON public.inquiries (status, created_at DESC);
CREATE INDEX IF NOT EXISTS inquiries_phone_idx   ON public.inquiries (phone);

-- ============================================================================
-- 17. TRIGGERS & CORE FUNCTIONS
-- ============================================================================

-- ── 17.1 updated_at maintainers ────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'customers','projects','crew_members','project_crew_assignments',
    'inventory_assets','project_expenses','project_invoices',
    'vendor_purchase_orders','outgoing_rental_orders','portfolio_showcases',
    'money_splits','editor_tasks'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_updated_at', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.set_updated_at()',
      t || '_updated_at', t);
  END LOOP;
END $$;

-- ── 17.2 Session revocation on access-settings change ──────────────────────
-- Editing the PIN, token, status, or expiry invalidates all existing cookies.
CREATE OR REPLACE FUNCTION private.revoke_project_sessions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF new.gallery_pin_hash IS DISTINCT FROM old.gallery_pin_hash
     OR new.access_token  IS DISTINCT FROM old.access_token
     OR new.status        IS DISTINCT FROM old.status
     OR new.expires_at    IS DISTINCT FROM old.expires_at THEN
    UPDATE private.gallery_sessions
    SET revoked_at = now()
    WHERE project_id = new.id AND revoked_at IS NULL;
  END IF;
  RETURN new;
END;
$$;
REVOKE ALL ON FUNCTION private.revoke_project_sessions() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS project_access_changed ON public.projects;
CREATE TRIGGER project_access_changed AFTER UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION private.revoke_project_sessions();

-- ── 17.3 Crew fee -> RAB sync (conditional on ACCEPTED) ────────────────────
-- A crew fee enters the RAB ONLY when the offer is accepted. Revoking consent
-- purges the line item, keeping the cost sheet honest.
CREATE OR REPLACE FUNCTION public.sync_crew_fee_to_expenses()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_crew_name text;
BEGIN
  SELECT full_name INTO v_crew_name
  FROM public.crew_members
  WHERE id = COALESCE(NEW.crew_member_id, OLD.crew_member_id);

  IF TG_OP = 'INSERT' THEN
    IF NEW.acceptance_status = 'ACCEPTED' THEN
      INSERT INTO public.project_expenses (
        project_id, category, name, unit_cost, quantity,
        crew_assignment_id, paid_by, notes
      ) VALUES (
        NEW.project_id, 'CREW_FEE',
        'Honor: ' || NEW.role_title || ' (' || v_crew_name || ')',
        NEW.fee_agreed, 1, NEW.id, 'STUDIO_CASH',
        'Disetujui oleh kru pada ' || to_char(COALESCE(NEW.accepted_at, now()), 'DD Mon YYYY HH24:MI')
      );
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.acceptance_status = 'ACCEPTED' AND (OLD.acceptance_status IS DISTINCT FROM 'ACCEPTED') THEN
      INSERT INTO public.project_expenses (
        project_id, category, name, unit_cost, quantity,
        crew_assignment_id, paid_by, notes
      ) VALUES (
        NEW.project_id, 'CREW_FEE',
        'Honor: ' || NEW.role_title || ' (' || v_crew_name || ')',
        NEW.fee_agreed, 1, NEW.id, 'STUDIO_CASH',
        'Disetujui oleh kru pada ' || to_char(COALESCE(NEW.accepted_at, now()), 'DD Mon YYYY HH24:MI')
      );
    ELSIF NEW.acceptance_status = 'ACCEPTED' AND OLD.acceptance_status = 'ACCEPTED' THEN
      UPDATE public.project_expenses
      SET name = 'Honor: ' || NEW.role_title || ' (' || v_crew_name || ')',
          unit_cost = NEW.fee_agreed,
          updated_at = now()
      WHERE crew_assignment_id = NEW.id;
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

-- ── 17.4 Reschedule cascade: shift call times, revoke stale consent ────────
CREATE OR REPLACE FUNCTION public.cascade_project_reschedule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_delta interval;
BEGIN
  IF NEW.shoot_date IS DISTINCT FROM OLD.shoot_date
     AND OLD.shoot_date IS NOT NULL AND NEW.shoot_date IS NOT NULL THEN
    v_delta := (NEW.shoot_date - OLD.shoot_date) * INTERVAL '1 day';

    UPDATE public.project_crew_assignments
    SET call_time = call_time + v_delta,
        roll_time = CASE WHEN roll_time IS NOT NULL THEN roll_time + v_delta ELSE NULL END,
        acceptance_status = 'PENDING_OFFER',
        accepted_at = NULL,
        declined_reason = 'Jadwal proyek diubah dari ' || to_char(OLD.shoot_date,'DD/MM/YYYY')
                          || ' ke ' || to_char(NEW.shoot_date,'DD/MM/YYYY'),
        updated_at = now()
    WHERE project_id = NEW.id;
    -- trg_sync_crew_fee fires on the acceptance_status change and purges
    -- the now-unconfirmed CREW_FEE rows automatically.
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascade_project_reschedule ON public.projects;
CREATE TRIGGER trg_cascade_project_reschedule
  AFTER UPDATE OF shoot_date ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.cascade_project_reschedule();

-- ── 17.5 Gallery access lifecycle ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.consume_gallery_attempt(p_bucket_key text)
RETURNS TABLE (allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_attempts integer;
  v_resets_at timestamptz;
BEGIN
  IF p_bucket_key IS NULL OR length(p_bucket_key) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'Invalid rate limit key';
  END IF;
  INSERT INTO private.gallery_rate_limits AS limits (bucket_key, attempts, resets_at)
  VALUES (p_bucket_key, 1, v_now + interval '10 minutes')
  ON CONFLICT (bucket_key) DO UPDATE SET
    attempts  = CASE WHEN limits.resets_at <= v_now THEN 1 ELSE least(limits.attempts + 1, 1000000) END,
    resets_at = CASE WHEN limits.resets_at <= v_now THEN v_now + interval '10 minutes' ELSE limits.resets_at END
  RETURNING attempts, resets_at INTO v_attempts, v_resets_at;
  RETURN QUERY SELECT v_attempts <= 5,
                      greatest(0, ceil(extract(epoch FROM v_resets_at - v_now))::integer);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_gallery_attempt(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_gallery_attempt(text) TO service_role;

CREATE OR REPLACE FUNCTION public.create_gallery_session(
  p_project_id uuid, p_verified_pin_hash text, p_token_hash text,
  p_upgraded_pin_hash text DEFAULT NULL
) RETURNS TABLE (session_id uuid, project_id uuid, access_token text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_project public.projects%ROWTYPE;
  v_session_id uuid;
  v_expires_at timestamptz;
BEGIN
  SELECT * INTO v_project FROM public.projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND
     OR v_project.gallery_pin_hash IS DISTINCT FROM p_verified_pin_hash
     OR v_project.status <> 'ready'
     OR (v_project.expires_at IS NOT NULL AND v_project.expires_at <= clock_timestamp()) THEN
    RETURN;
  END IF;
  IF p_upgraded_pin_hash IS NOT NULL THEN
    IF p_upgraded_pin_hash !~ '^scrypt-v2\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$' THEN
      RAISE EXCEPTION 'Invalid credential upgrade';
    END IF;
    UPDATE public.projects SET gallery_pin_hash = p_upgraded_pin_hash WHERE id = p_project_id;
  END IF;
  v_expires_at := least(clock_timestamp() + interval '12 hours',
                        coalesce(v_project.expires_at, 'infinity'::timestamptz));
  INSERT INTO private.gallery_sessions (project_id, token_hash, expires_at)
  VALUES (p_project_id, p_token_hash, v_expires_at)
  RETURNING id INTO v_session_id;
  RETURN QUERY SELECT v_session_id, p_project_id, v_project.access_token, v_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_gallery_session(p_token_hash text)
RETURNS TABLE (session_id uuid, project_id uuid, access_token text, slug text, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.id, s.project_id, p.access_token, p.slug,
         least(s.expires_at, coalesce(p.expires_at, 'infinity'::timestamptz))
  FROM private.gallery_sessions s
  JOIN public.projects p ON p.id = s.project_id
  WHERE s.token_hash = p_token_hash
    AND s.gallery_access AND s.revoked_at IS NULL
    AND s.expires_at > now() AND p.status = 'ready'
    AND (p.expires_at IS NULL OR p.expires_at > now());
$$;

CREATE OR REPLACE FUNCTION public.revoke_gallery_session(p_token_hash text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE private.gallery_sessions SET revoked_at = now()
  WHERE token_hash = p_token_hash AND revoked_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.create_gallery_session(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_gallery_session(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_gallery_session(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_gallery_session(uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_gallery_session(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_gallery_session(text) TO service_role;

-- ── 17.6 Photo selection locking + editor task creation ────────────────────
CREATE OR REPLACE FUNCTION public.submit_photo_selection(
  p_project_id uuid, p_session_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_project public.projects%ROWTYPE;
  v_count integer;
  v_now timestamptz := clock_timestamp();
  v_task_id uuid;
  v_manifest jsonb;
BEGIN
  SELECT * INTO v_project FROM public.projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found'; END IF;
  IF v_project.selection_locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Photo selection is already locked';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM private.gallery_sessions
    WHERE id = p_session_id AND project_id = p_project_id
      AND gallery_access AND revoked_at IS NULL AND expires_at > v_now
  ) THEN
    RAISE EXCEPTION 'Invalid or expired gallery session';
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.favorites WHERE project_id = p_project_id AND session_id = p_session_id;

  IF v_count < v_project.selection_quota_min THEN
    RAISE EXCEPTION 'Selection count % is below minimum quota of %', v_count, v_project.selection_quota_min;
  END IF;
  IF v_count > v_project.selection_quota_max THEN
    RAISE EXCEPTION 'Selection count % exceeds maximum quota of %', v_count, v_project.selection_quota_max;
  END IF;

  UPDATE public.projects
  SET selection_locked_at = v_now, updated_at = v_now
  WHERE id = p_project_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'media_id', f.media_id,
           'file_name', m.file_name,
           'mime_type', m.mime_type,
           'original_key', m.original_key,
           'storage_provider', m.storage_provider
         ) ORDER BY m.sort_order, f.created_at), '[]'::jsonb)
  INTO v_manifest
  FROM public.favorites f
  JOIN public.media m ON m.id = f.media_id
  WHERE f.project_id = p_project_id AND f.session_id = p_session_id;

  INSERT INTO public.editor_tasks (
    project_id, status, deliverable_count, notes, manifest_json, created_at, updated_at
  ) VALUES (
    p_project_id, 'PENDING', v_count,
    'Client selection submitted via gallery proofing.', v_manifest, v_now, v_now
  ) RETURNING id INTO v_task_id;

  RETURN jsonb_build_object(
    'success', true, 'task_id', v_task_id,
    'deliverable_count', v_count, 'locked_at', v_now
  );
END;
$$;
REVOKE ALL ON FUNCTION public.submit_photo_selection(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_photo_selection(uuid, uuid) TO authenticated, service_role;

-- ── 17.7 Crew dual-consent ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.respond_crew_assignment_offer(
  p_magic_token text, p_accept boolean, p_declined_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_assignment public.project_crew_assignments%ROWTYPE;
BEGIN
  SELECT * INTO v_assignment FROM public.project_crew_assignments
  WHERE magic_token = p_magic_token FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TOKEN',
                              'message', 'Tautan penugasan tidak valid.');
  END IF;

  IF v_assignment.acceptance_status = 'ACCEPTED' AND p_accept THEN
    RETURN jsonb_build_object('success', true, 'status', 'ACCEPTED',
                              'message', 'Penugasan sudah Anda terima sebelumnya.');
  END IF;

  IF p_accept THEN
    UPDATE public.project_crew_assignments
    SET acceptance_status = 'ACCEPTED', accepted_at = now(),
        declined_at = NULL, declined_reason = NULL, updated_at = now()
    WHERE id = v_assignment.id;
    RETURN jsonb_build_object('success', true, 'status', 'ACCEPTED',
      'message', 'Tugas berhasil diterima. Rincian call sheet dan perlengkapan aktif sepenuhnya.');
  ELSE
    UPDATE public.project_crew_assignments
    SET acceptance_status = 'DECLINED', declined_at = now(),
        declined_reason = COALESCE(p_declined_reason, 'Tidak dapat hadir pada jadwal tersebut'),
        updated_at = now()
    WHERE id = v_assignment.id;
    RETURN jsonb_build_object('success', true, 'status', 'DECLINED',
      'message', 'Penolakan tugas telah dicatat. Studio akan menerima notifikasi untuk penugasan pengganti.');
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.respond_crew_assignment_offer(text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_crew_assignment_offer(text, boolean, text) TO anon, authenticated, service_role;

-- ── 17.8 Zero-leakage crew hub payload ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_crew_hub_payload(p_magic_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_assignment public.project_crew_assignments%ROWTYPE;
  v_crew RECORD;
  v_project RECORD;
BEGIN
  SELECT * INTO v_assignment FROM public.project_crew_assignments
  WHERE magic_token = p_magic_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'INVALID_TOKEN',
      'message', 'Tautan kru tidak ditemukan atau telah kedaluwarsa.');
  END IF;

  SELECT full_name, crew_code, phone, bank_name, bank_account_number, bank_account_holder
  INTO v_crew FROM public.crew_members WHERE id = v_assignment.crew_member_id;

  -- Strict zero-leakage: NO contract_value, NO expenses, NO margins.
  SELECT id, name, slug, photography_type, service_pillar, shoot_date
  INTO v_project FROM public.projects WHERE id = v_assignment.project_id;

  RETURN jsonb_build_object(
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
      'crew_code', v_crew.crew_code,
      'bank_name', v_crew.bank_name,
      'bank_account_number', v_crew.bank_account_number,
      'bank_account_holder', v_crew.bank_account_holder
    ),
    'project', jsonb_build_object(
      'name', v_project.name,
      'slug', v_project.slug,
      'service_pillar', v_project.service_pillar,
      'shoot_date', v_project.shoot_date
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_crew_hub_payload(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_crew_hub_payload(text) TO anon, authenticated, service_role;

-- ── 17.9 ZERO-LEAKAGE client invoice DTO (the ONLY client billing path) ────
CREATE OR REPLACE FUNCTION public.get_client_invoice_dto(p_invoice_number text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_inv  RECORD;
  v_pos  RECORD;
  v_proj RECORD;
  v_cust RECORD;
  v_receipts jsonb;
BEGIN
  SELECT * INTO v_inv FROM public.project_invoices WHERE invoice_number = p_invoice_number;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND', 'message', 'Invoice tidak ditemukan.');
  END IF;

  SELECT * INTO v_pos FROM public.v_invoice_financial_position WHERE invoice_id = v_inv.id;

  SELECT id, name, service_pillar, photography_type, shoot_date, customer_id
  INTO v_proj FROM public.projects WHERE id = v_inv.project_id;

  SELECT name, email, phone INTO v_cust FROM public.customers WHERE id = v_proj.customer_id;

  -- Payment history: date, method, amount, verified. NEVER a cost category.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'receipt_number', r.receipt_number,
           'amount', r.amount,
           'payment_method', r.payment_method,
           'bank_name', r.bank_name,
           'received_at', r.received_at,
           'applied_to', r.applied_to,
           'verified', r.verified_at IS NOT NULL
         ) ORDER BY r.received_at), '[]'::jsonb)
  INTO v_receipts
  FROM public.invoice_payment_receipts r
  WHERE r.invoice_id = v_inv.id AND r.verified_at IS NOT NULL;

  RETURN jsonb_build_object(
    'invoice_number', v_inv.invoice_number,
    'issue_date', v_inv.issue_date,
    'due_date', v_inv.due_date,
    'line_items', v_inv.line_items,
    'client_notes', v_inv.client_notes,
    'contract_value', v_pos.contract_value,
    'paid_amount', v_pos.paid_amount,
    'balance_due', v_pos.balance_due,
    'overpayment_amount', v_pos.overpayment_amount,
    'payment_status', v_pos.derived_status,
    'dp_floor_satisfied', v_pos.dp_floor_satisfied,
    'payments', v_receipts,
    'project', jsonb_build_object(
      'id', v_proj.id, 'name', v_proj.name,
      'service_pillar', v_proj.service_pillar, 'shoot_date', v_proj.shoot_date
    ),
    'customer', jsonb_build_object(
      'name', v_cust.name, 'phone', v_cust.phone, 'email', v_cust.email
    ),
    'studio_bank_details', jsonb_build_array(
      jsonb_build_object('bank','BCA','account_number','3581216520',
                         'account_holder','Emri Luthfan A.'),
      jsonb_build_object('bank','Mandiri','account_number','1560023148218',
                         'account_holder','Muhammad Rayyan Nufail')
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_client_invoice_dto(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_client_invoice_dto(text) TO anon, authenticated, service_role;

-- ── 17.10 Dual-founder waterfall approval ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_money_split(p_split_id uuid, p_founder text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_split public.money_splits%ROWTYPE;
  v_new_a boolean; v_new_b boolean; v_new_status text;
  v_now timestamptz := now();
  v_project_name text;
BEGIN
  IF p_founder NOT IN ('A','B') THEN
    RAISE EXCEPTION 'Invalid founder: %. Must be A or B', p_founder;
  END IF;

  SELECT * INTO v_split FROM public.money_splits WHERE id = p_split_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Money split % not found', p_split_id; END IF;

  IF v_split.status = 'APPROVED' THEN
    RETURN jsonb_build_object('success', true, 'message', 'Split already fully approved',
      'split_id', v_split.id, 'status', v_split.status,
      'approved_by_a', v_split.approved_by_a, 'approved_by_b', v_split.approved_by_b,
      'reserve_amount', v_split.reserve_amount);
  END IF;

  v_new_a := CASE WHEN p_founder = 'A' THEN true ELSE v_split.approved_by_a END;
  v_new_b := CASE WHEN p_founder = 'B' THEN true ELSE v_split.approved_by_b END;
  v_new_status := CASE WHEN v_new_a AND v_new_b THEN 'APPROVED' ELSE 'PENDING_APPROVAL' END;

  UPDATE public.money_splits
  SET approved_by_a = v_new_a, approved_by_b = v_new_b,
      status = v_new_status, updated_at = v_now
  WHERE id = p_split_id RETURNING * INTO v_split;

  IF v_new_status = 'APPROVED' AND v_split.reserve_amount > 0 THEN
    SELECT name INTO v_project_name FROM public.projects WHERE id = v_split.project_id;
    INSERT INTO public.cash_ledger (project_id, type, category, amount, description, created_at)
    VALUES (v_split.project_id, 'INFLOW', 'RESERVE_INFLOW', v_split.reserve_amount,
            '5% Studio Reserve from ' || coalesce(v_project_name, 'Project ' || v_split.project_id::text),
            v_now);
  END IF;

  RETURN jsonb_build_object('success', true, 'split_id', v_split.id, 'status', v_split.status,
    'approved_by_a', v_split.approved_by_a, 'approved_by_b', v_split.approved_by_b,
    'reserve_amount', v_split.reserve_amount);
END;
$$;
REVOKE ALL ON FUNCTION public.approve_money_split(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_money_split(uuid, text) TO authenticated, service_role;

-- ── 17.11 Asset conflict resolver ──────────────────────────────────────────
-- v1: exact-date, project_expenses only. Kept for backward compatibility.
CREATE OR REPLACE FUNCTION public.check_asset_scheduling_conflict(
  p_asset_id uuid, p_project_id uuid, p_event_date date
) RETURNS TABLE (conflict_found boolean, conflicting_project_id uuid, conflicting_project_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT true, pr.id, pr.name
  FROM public.project_expenses pe
  JOIN public.projects pr ON pr.id = pe.project_id
  WHERE pe.asset_id = p_asset_id
    AND pe.project_id <> p_project_id
    AND pr.shoot_date = p_event_date
    AND pr.status IN ('draft','editing','ready')
  LIMIT 1;
END;
$$;

-- v2: buffer-aware, range-based, multi-design.
--   * numeric buffer in DAYS on both sides of the window
--   * checks BOTH demand sources: internal projects AND outgoing rentals
--   * returns conflict_kind so the UI can render
--     "🔴 DISEWA KELUAR: <renter>" vs "🔴 DIPAKAI PROYEK: <project>"
CREATE OR REPLACE FUNCTION public.check_asset_scheduling_conflict_v2(
  p_asset_id    uuid,
  p_project_id  uuid,
  p_target_date date,
  p_prep_days_before  integer DEFAULT 1,
  p_return_days_after integer DEFAULT 1,
  p_exclude_rental_id uuid    DEFAULT NULL
) RETURNS TABLE (
  conflict_found          boolean,
  conflict_kind           text,
  conflicting_project_id  uuid,
  conflicting_project_name text,
  conflicting_date        date,
  conflicting_rental_id   uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_start date := p_target_date - p_prep_days_before;
  v_end   date := p_target_date + p_return_days_after;
BEGIN
  -- Demand source 1: another internal project holding this asset
  RETURN QUERY
  SELECT true, 'INTERNAL_PROJECT'::text, pr.id, pr.name, pr.shoot_date, NULL::uuid
  FROM public.project_expenses pe
  JOIN public.projects pr ON pr.id = pe.project_id
  WHERE pe.asset_id = p_asset_id
    AND pe.project_id <> p_project_id
    AND pr.status IN ('draft','editing','ready')
    AND pr.shoot_date BETWEEN v_start AND v_end
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  -- Demand source 2: an outgoing rental blocking this asset
  RETURN QUERY
  SELECT true, 'OUTGOING_RENTAL'::text, NULL::uuid, oro.renter_name,
         oro.pickup_at::date, oro.id
  FROM public.outgoing_rental_items ori
  JOIN public.outgoing_rental_orders oro ON oro.id = ori.order_id
  WHERE ori.asset_id = p_asset_id
    AND (p_exclude_rental_id IS NULL OR oro.id <> p_exclude_rental_id)
    AND oro.status IN ('BOOKED','PICKED_UP','IN_USE','OVERDUE')
    AND (oro.pickup_at::date, oro.return_due_at::date) OVERLAPS (v_start, v_end)
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_asset_scheduling_conflict(uuid, uuid, date)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_asset_scheduling_conflict_v2(uuid, uuid, date, integer, integer, uuid)
  TO authenticated, service_role;

-- ── 17.12 Asset utilization calendar (now includes outgoing rentals) ───────
CREATE OR REPLACE FUNCTION public.get_asset_utilization_calendar(p_asset_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_asset RECORD;
  v_projects jsonb;
  v_rentals jsonb;
BEGIN
  SELECT id, asset_code, name, category, source_type, owner_name, vendor_name,
         daily_rental_rate, condition_status, is_available_for_outgoing_rental
  INTO v_asset FROM public.inventory_assets WHERE id = p_asset_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'project_id', pr.id, 'project_name', pr.name, 'service_pillar', pr.service_pillar,
    'shoot_date', pr.shoot_date, 'status', pr.status,
    'quantity', pe.quantity, 'total_cost', pe.total_cost,
    'pack_status', pe.pack_status, 'return_status', pe.return_status
  ) ORDER BY pr.shoot_date ASC), '[]'::jsonb)
  INTO v_projects
  FROM public.project_expenses pe
  JOIN public.projects pr ON pr.id = pe.project_id
  WHERE pe.asset_id = p_asset_id AND pr.shoot_date IS NOT NULL;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'rental_id', oro.id, 'order_number', oro.order_number,
    'renter_name', oro.renter_name, 'renter_phone', oro.renter_phone,
    'pickup_at', oro.pickup_at, 'return_due_at', oro.return_due_at,
    'buffer_hours', oro.buffer_hours, 'status', oro.status,
    'deposit_amount', oro.deposit_amount
  ) ORDER BY oro.pickup_at ASC), '[]'::jsonb)
  INTO v_rentals
  FROM public.outgoing_rental_items ori
  JOIN public.outgoing_rental_orders oro ON oro.id = ori.order_id
  WHERE ori.asset_id = p_asset_id
    AND oro.status IN ('BOOKED','PICKED_UP','IN_USE','OVERDUE');

  RETURN jsonb_build_object(
    'asset', row_to_json(v_asset),
    'bookings', v_projects,
    'outgoing_rentals', v_rentals
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_asset_utilization_calendar(uuid) TO authenticated, service_role;

-- ── 17.13 Vendor rental manifest (Stream B source) ─────────────────────────
-- STRICT: returns ONLY source_type = 'VENDOR_RENTAL' rows.
CREATE OR REPLACE FUNCTION public.get_vendor_rental_manifest(p_project_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_vendors jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(v ORDER BY v->>'vendor_name'), '[]'::jsonb)
  INTO v_vendors
  FROM (
    SELECT jsonb_build_object(
      'vendor_name', coalesce(pe.vendor_name, 'Vendor Tidak Diketahui'),
      'vendor_phone', max(pe.vendor_phone),
      'items', jsonb_agg(jsonb_build_object(
        'expense_id', pe.id, 'name', pe.name,
        'quantity', pe.quantity, 'unit_cost', pe.unit_cost,
        'rental_duration_days', pe.rental_duration_days,
        'total_cost', pe.total_cost, 'return_date', pe.return_date,
        'return_status', pe.return_status, 'asset_id', pe.asset_id
      ) ORDER BY pe.name),
      'subtotal', sum(pe.total_cost)
    ) AS v
    FROM public.project_expenses pe
    WHERE pe.project_id = p_project_id
      AND pe.source_type = 'VENDOR_RENTAL'
    GROUP BY coalesce(pe.vendor_name, 'Vendor Tidak Diketahui')
  ) grouped;
  RETURN jsonb_build_object('vendors', v_vendors);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_vendor_rental_manifest(uuid) TO authenticated, service_role;

-- ============================================================================
-- 18. ROW LEVEL SECURITY
-- ============================================================================
-- Policy naming convention: <table>_admin_all for admin-only tables.
-- Every policy is dropped before creation so re-running is safe.
DO $$
DECLARE
  t text;
  admin_only text[] := ARRAY[
    'admins','customers','projects','media','favorites','crew_members',
    'project_crew_assignments','equipment_presets','inventory_assets',
    'project_expenses','project_invoices','invoice_payment_receipts',
    'vendor_purchase_orders','vendor_purchase_order_items',
    'outgoing_rental_orders','outgoing_rental_items',
    'money_splits','cash_ledger','editor_tasks','document_sequences'
  ];
BEGIN
  FOREACH t IN ARRAY admin_only LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- Drop any prior policy of the same name so re-runs do not collide.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_all', t);
  END LOOP;
END $$;

-- ── Admin-only tables: authenticated admins get full access ────────────────
DO $$
DECLARE
  t text;
  admin_only text[] := ARRAY[
    'customers','projects','media','favorites','crew_members',
    'project_crew_assignments','equipment_presets','inventory_assets',
    'project_expenses','project_invoices','invoice_payment_receipts',
    'vendor_purchase_orders','vendor_purchase_order_items',
    'outgoing_rental_orders','outgoing_rental_items',
    'money_splits','cash_ledger','editor_tasks','document_sequences'
  ];
BEGIN
  FOREACH t IN ARRAY admin_only LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
         USING ((SELECT private.is_admin()))
         WITH CHECK ((SELECT private.is_admin()))',
      t || '_admin_all', t);
  END LOOP;
END $$;

-- admins: a user may always read their own row (bootstrap before is_admin()).
DROP POLICY IF EXISTS admins_read_self ON public.admins;
CREATE POLICY admins_read_self ON public.admins
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- ── Moodboard: publicly readable/writable per project gallery ──────────────
ALTER TABLE public.moodboard_cards    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moodboard_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS moodboard_cards_admin_all      ON public.moodboard_cards;
DROP POLICY IF EXISTS moodboard_cards_public_read    ON public.moodboard_cards;
DROP POLICY IF EXISTS moodboard_cards_public_insert  ON public.moodboard_cards;
DROP POLICY IF EXISTS moodboard_cards_public_update  ON public.moodboard_cards;
DROP POLICY IF EXISTS moodboard_comments_admin_all   ON public.moodboard_comments;
DROP POLICY IF EXISTS moodboard_comments_public_read ON public.moodboard_comments;
DROP POLICY IF EXISTS moodboard_comments_public_insert ON public.moodboard_comments;

CREATE POLICY moodboard_cards_admin_all ON public.moodboard_cards
  FOR ALL TO authenticated
  USING ((SELECT private.is_admin())) WITH CHECK ((SELECT private.is_admin()));
CREATE POLICY moodboard_cards_public_read ON public.moodboard_cards
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY moodboard_cards_public_insert ON public.moodboard_cards
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY moodboard_cards_public_update ON public.moodboard_cards
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY moodboard_comments_admin_all ON public.moodboard_comments
  FOR ALL TO authenticated
  USING ((SELECT private.is_admin())) WITH CHECK ((SELECT private.is_admin()));
CREATE POLICY moodboard_comments_public_read ON public.moodboard_comments
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY moodboard_comments_public_insert ON public.moodboard_comments
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- ── Studio events: public slot checking + self-serve booking ───────────────
ALTER TABLE public.studio_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS studio_events_admin_all      ON public.studio_events;
DROP POLICY IF EXISTS studio_events_public_select  ON public.studio_events;
DROP POLICY IF EXISTS studio_events_public_insert  ON public.studio_events;
CREATE POLICY studio_events_admin_all ON public.studio_events
  FOR ALL TO authenticated
  USING ((SELECT private.is_admin())) WITH CHECK ((SELECT private.is_admin()));
CREATE POLICY studio_events_public_select ON public.studio_events
  FOR SELECT TO anon, authenticated USING (status <> 'CANCELLED');
CREATE POLICY studio_events_public_insert ON public.studio_events
  FOR INSERT TO anon, authenticated WITH CHECK (status = 'SCHEDULED');

-- ── Portfolio showcase: public reads published content ONLY ────────────────
ALTER TABLE public.portfolio_showcases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_read_showcase ON public.portfolio_showcases;
DROP POLICY IF EXISTS admin_all_showcase   ON public.portfolio_showcases;
CREATE POLICY public_read_showcase ON public.portfolio_showcases
  FOR SELECT TO anon, authenticated USING (is_published = true);
CREATE POLICY admin_all_showcase ON public.portfolio_showcases
  FOR ALL TO authenticated
  USING ((SELECT private.is_admin())) WITH CHECK ((SELECT private.is_admin()));

-- ── Inquiries: anonymous insert (contact form), admin read/manage ──────────
ALTER TABLE public.inquiries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inquiries_public_insert ON public.inquiries;
DROP POLICY IF EXISTS inquiries_admin_all     ON public.inquiries;
CREATE POLICY inquiries_public_insert ON public.inquiries
  FOR INSERT TO anon, authenticated WITH CHECK (status = 'NEW');
CREATE POLICY inquiries_admin_all ON public.inquiries
  FOR ALL TO authenticated
  USING ((SELECT private.is_admin())) WITH CHECK ((SELECT private.is_admin()));

-- ── Grants ─────────────────────────────────────────────────────────────────
REVOKE ALL ON public.admins, public.customers, public.projects, public.media, public.favorites
  FROM anon, authenticated;
REVOKE ALL ON private.gallery_sessions, private.gallery_rate_limits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.crew_members, public.project_crew_assignments,
  public.equipment_presets, public.project_expenses, public.inventory_assets,
  public.project_invoices, public.invoice_payment_receipts,
  public.vendor_purchase_orders, public.vendor_purchase_order_items,
  public.outgoing_rental_orders, public.outgoing_rental_items,
  public.money_splits, public.cash_ledger, public.editor_tasks,
  public.document_sequences, public.moodboard_cards, public.moodboard_comments,
  public.studio_events, public.portfolio_showcases, public.inquiries
  FROM anon, authenticated;

GRANT SELECT ON public.admins TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.customers, public.projects, public.media, public.favorites,
  public.crew_members, public.project_crew_assignments, public.equipment_presets,
  public.inventory_assets, public.project_expenses, public.project_invoices,
  public.invoice_payment_receipts, public.vendor_purchase_orders,
  public.vendor_purchase_order_items, public.outgoing_rental_orders,
  public.outgoing_rental_items, public.money_splits, public.cash_ledger,
  public.editor_tasks, public.document_sequences, public.moodboard_cards,
  public.moodboard_comments, public.studio_events, public.portfolio_showcases,
  public.inquiries
  TO authenticated;

-- Public read surface for the marketing site.
GRANT SELECT ON public.portfolio_showcases TO anon;
GRANT SELECT, INSERT ON public.studio_events TO anon;
GRANT INSERT ON public.inquiries TO anon;
GRANT INSERT ON public.moodboard_cards, public.moodboard_comments TO anon;
GRANT SELECT ON public.moodboard_cards, public.moodboard_comments TO anon;

GRANT ALL ON
  public.admins, public.customers, public.projects, public.media, public.favorites,
  public.crew_members, public.project_crew_assignments, public.equipment_presets,
  public.inventory_assets, public.project_expenses, public.project_invoices,
  public.invoice_payment_receipts, public.vendor_purchase_orders,
  public.vendor_purchase_order_items, public.outgoing_rental_orders,
  public.outgoing_rental_items, public.money_splits, public.cash_ledger,
  public.editor_tasks, public.document_sequences, public.moodboard_cards,
  public.moodboard_comments, public.studio_events, public.portfolio_showcases,
  public.inquiries, private.gallery_sessions, private.gallery_rate_limits
  TO service_role;

GRANT SELECT ON public.v_invoice_financial_position TO authenticated, service_role;

-- ============================================================================
-- 19. PRIVATE STORAGE BUCKETS
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('gallery-originals', 'gallery-originals', false, 1073741824,
   ARRAY['image/jpeg','image/png','image/webp','video/mp4','video/quicktime']),
  ('gallery-previews', 'gallery-previews', false, 10485760,
   ARRAY['image/jpeg','image/webp','image/avif'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS elts_admin_storage_select ON storage.objects;
DROP POLICY IF EXISTS elts_admin_storage_insert ON storage.objects;
DROP POLICY IF EXISTS elts_admin_storage_update ON storage.objects;
DROP POLICY IF EXISTS elts_admin_storage_delete ON storage.objects;

CREATE POLICY elts_admin_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('gallery-originals','gallery-previews') AND (SELECT private.is_admin()));
CREATE POLICY elts_admin_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('gallery-originals','gallery-previews') AND (SELECT private.is_admin()));
CREATE POLICY elts_admin_storage_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id IN ('gallery-originals','gallery-previews') AND (SELECT private.is_admin()))
  WITH CHECK (bucket_id IN ('gallery-originals','gallery-previews') AND (SELECT private.is_admin()));
CREATE POLICY elts_admin_storage_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('gallery-originals','gallery-previews') AND (SELECT private.is_admin()));

-- ============================================================================
-- 20. SEED DATA  (idempotent — ON CONFLICT DO NOTHING / DO UPDATE)
-- ============================================================================

-- ── 20.1 Crew: 3 core team + 2 freelance ───────────────────────────────────
INSERT INTO public.crew_members (
  id, crew_code, full_name, phone, email, member_type,
  primary_skills, jobdesk_specialties, bank_name, bank_account_number,
  bank_account_holder, standard_day_rate, rating, is_active
) VALUES
  ('f0000000-0000-0000-0000-000000000001','CRW-RAY','Rayyan Nufail (Ray)','081234567890','ray@elts.id','CORE_TEAM',
   ARRAY['Technical Director','Switcher Operator','UI/UX Engineer','Lead Editor'],
   ARRAY['FOH_SWITCHER','TECHNICAL_DIRECTOR','LEAD_EDITOR'],
   'BCA','0000000000','Muhammad Rayyan Nufail',500000,5.0,true),
  ('f0000000-0000-0000-0000-000000000002','CRW-EL','El (Partner / Creative Lead)','081234567891','el@elts.id','CORE_TEAM',
   ARRAY['Director of Photography','Creative Director','Camera Operator'],
   ARRAY['CAM_MASTER','CAM_ROVING','CREATIVE_DIRECTOR'],
   'BCA','0000000000','El Partner Studio',450000,5.0,true),
  ('f0000000-0000-0000-0000-000000000003','CRW-CYO','Cahyo (Partner / Operations)','081234567892','cahyo@elts.id','CORE_TEAM',
   ARRAY['Operations Manager','Audio Engineer','Camera Operator'],
   ARRAY['AUDIO_ENGINEER','CAM_STEADY','FIELD_OPERATIONS'],
   'Mandiri','0000000000000','Cahyo Operations',400000,5.0,true),
  ('f0000000-0000-0000-0000-000000000004','CRW-AZR','Azrian (Production Crew)','081399887766','azrian.crew@gmail.com','FREELANCE',
   ARRAY['Camera Operator','Lighting Technician','Gaffer'],
   ARRAY['CAM_ROVING','GAFFER','GRIP'],
   'BCA','0000000000','Azrian',350000,4.9,true),
  ('f0000000-0000-0000-0000-000000000005','CRW-FAT','Fatteh (Field Support)','081399887755','fatteh.tech@gmail.com','FREELANCE',
   ARRAY['Audio Assistant','Broadcast Cable Routing','Stream Runner'],
   ARRAY['AUDIO_ASSISTANT','RUNNER','CABLE_TECH'],
   'BRI','000000000000000','Fatteh',300000,4.8,true)
ON CONFLICT (crew_code) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  member_type = EXCLUDED.member_type,
  primary_skills = EXCLUDED.primary_skills,
  jobdesk_specialties = EXCLUDED.jobdesk_specialties,
  standard_day_rate = EXCLUDED.standard_day_rate;

-- ── 20.2 Equipment presets (13) ────────────────────────────────────────────
INSERT INTO public.equipment_presets (name, category, default_rental_rate, ownership_type)
VALUES
  ('Sony FX3 Full-Frame Cinema Body','CAMERA',450000,'IN_HOUSE'),
  ('Sony A7IV Full-Frame Hybrid Body','CAMERA',350000,'IN_HOUSE'),
  ('Sony FE 24-70mm f/2.8 GM II','LENS',250000,'IN_HOUSE'),
  ('Sony FE 70-200mm f/2.8 GM OSS II','LENS',300000,'IN_HOUSE'),
  ('Hollyland Cosmo C1 Wireless HDMI/SDI Kit','WIRELESS_VIDEO',350000,'IN_HOUSE'),
  ('Hollyland Mars 4K Wireless Transmitter','WIRELESS_VIDEO',200000,'IN_HOUSE'),
  ('vMix Broadcast Rig (Core i9 + RTX 4080 + DeckLink 4K)','BROADCAST_SWITCHER',750000,'IN_HOUSE'),
  ('ATEM Mini Pro HDMI Switcher','BROADCAST_SWITCHER',200000,'IN_HOUSE'),
  ('Behringer X32 Producer Digital Mixer','AUDIO',400000,'EXTERNAL_RENTAL'),
  ('Saramonic Blink 500 Pro Wireless Mic (Pair)','AUDIO',100000,'IN_HOUSE'),
  ('Hollyland Solidcom C1 Pro (4-Station Intercom)','INTERCOM',350000,'IN_HOUSE'),
  ('Aputure Amaran 200d LED Continuous Light','LIGHTING',150000,'IN_HOUSE'),
  ('Heavy-Duty Broadcast Tripod w/ Fluid Head','SUPPORT_RIG',100000,'IN_HOUSE')
ON CONFLICT (name) DO NOTHING;

-- ── 20.3 Inventory assets (24) — 3-tier ownership ──────────────────────────
INSERT INTO public.inventory_assets (
  asset_code, name, category, source_type, owner_name, vendor_name, vendor_phone,
  daily_rental_rate, is_available_for_outgoing_rental, power_draw_watts, requires_ups
) VALUES
  -- Studio in-house
  ('AST-CAM-01','Sony FX3 Cinema Line Body','CAMERA','IN_HOUSE','Studio',NULL,NULL,450000,true,12,false),
  ('AST-CAM-02','Sony A7IV Full-Frame Body','CAMERA','IN_HOUSE','Studio',NULL,NULL,350000,true,10,false),
  ('AST-CAM-06','Sony FX6 Cinema Line Body','CAMERA','IN_HOUSE','Studio',NULL,NULL,500000,true,14,false),
  ('AST-LNS-01','Sony FE 24-70mm f/2.8 GM II','LENS','IN_HOUSE','Studio',NULL,NULL,250000,true,0,false),
  ('AST-LNS-02','Sony FE 70-200mm f/2.8 GM OSS II','LENS','IN_HOUSE','Studio',NULL,NULL,300000,true,0,false),
  ('AST-LNS-03','Sony FE 16-35mm f/2.8 GM','LENS','IN_HOUSE','Studio',NULL,NULL,250000,true,0,false),
  ('AST-WRL-01','Hollyland Cosmo C1 Wireless HDMI/SDI','WIRELESS_VIDEO','IN_HOUSE','Studio',NULL,NULL,350000,true,8,false),
  ('AST-WRL-02','Hollyland Mars 4K Transmitter','WIRELESS_VIDEO','IN_HOUSE','Studio',NULL,NULL,200000,true,7,false),
  ('AST-SWT-01','vMix 4K Broadcast Rig (i9 + RTX 4080)','BROADCAST_SWITCHER','IN_HOUSE','Studio',NULL,NULL,750000,false,850,true),
  ('AST-SWT-02','ATEM Mini Pro HDMI Switcher','BROADCAST_SWITCHER','IN_HOUSE','Studio',NULL,NULL,200000,true,20,true),
  ('AST-ITM-01','Hollyland Solidcom C1 Pro 4-Station Intercom','INTERCOM','IN_HOUSE','Studio',NULL,NULL,350000,true,15,false),
  ('AST-LGT-01','Aputure Amaran 200d LED','LIGHTING','IN_HOUSE','Studio',NULL,NULL,150000,true,200,false),
  ('AST-LGT-02','Aputure Amaran 100d LED','LIGHTING','IN_HOUSE','Studio',NULL,NULL,100000,true,130,false),
  ('AST-SUP-01','Manfrotto Heavy-Duty Broadcast Tripod','SUPPORT_RIG','IN_HOUSE','Studio',NULL,NULL,100000,true,0,false),
  ('AST-SUP-02','Benro S8 Video Tripod','SUPPORT_RIG','IN_HOUSE','Studio',NULL,NULL,75000,true,0,false),
  ('AST-CBL-02','Kabel SDI Belden 30m w/ Reel','CABLE_ACCESSORY','IN_HOUSE','Studio',NULL,NULL,40000,true,0,false),
  ('AST-CBL-03','Kabel HDMI 15m','CABLE_ACCESSORY','IN_HOUSE','Studio',NULL,NULL,25000,true,0,false),
  ('AST-AUD-02','Saramonic Blink 500 Pro Wireless Mic','AUDIO','IN_HOUSE','Studio',NULL,NULL,100000,true,5,false),
  ('AST-LGT-03','Flash Godox TT600 Universal Speedlite','LIGHTING','IN_HOUSE','Studio',NULL,NULL,45000,true,10,false),
  ('AST-BAT-01','Baterai Kamera Sony (NP-FZ100 / NP-FW50)','CABLE_ACCESSORY','IN_HOUSE','Studio',NULL,NULL,25000,true,0,false),
  ('AST-BAT-02','Baterai Flash AA Rechargeable (Set 4x Eneloop + Charger)','CABLE_ACCESSORY','IN_HOUSE','Studio',NULL,NULL,20000,true,0,false),
  -- Partner-owned (co-founders' personal gear)
  ('AST-CAM-03','Sony ZV-E10 Body','CAMERA','PARTNER_OWNED','El',NULL,NULL,150000,false,8,false),
  ('AST-CAM-04','Sony A6000 Body (Backup Cam)','CAMERA','PARTNER_OWNED','Cahyo',NULL,NULL,100000,false,7,false),
  ('AST-LNS-04','Sony FE 50mm f/1.8','LENS','PARTNER_OWNED','El',NULL,NULL,80000,false,0,false),
  -- Vendor rental (Koi Rental Purwokerto)
  ('AST-CAM-05','Sony HXR-NX200 Camcorder 4K','CAMERA','VENDOR_RENTAL','Koi Rental','Koi Rental Purwokerto','081327889900',400000,false,18,false),
  ('AST-AUD-01','Behringer X32 Producer Digital Mixer','AUDIO','VENDOR_RENTAL','Koi Rental','Koi Rental Purwokerto','081327889900',400000,false,120,true),
  ('AST-CBL-01','Kabel HDMI Fiber Optic 20m (4K 60Hz)','CABLE_ACCESSORY','VENDOR_RENTAL','Koi Rental','Koi Rental Purwokerto','081327889900',50000,false,0,false)
ON CONFLICT (asset_code) DO NOTHING;

-- ── 20.4 Backfill sector_specs for existing projects ───────────────────────
UPDATE public.projects
SET sector_specs = jsonb_build_object(
  'proofingQuotaMin', COALESCE(selection_quota_min, 15),
  'proofingQuotaMax', COALESCE(selection_quota_max, 20),
  'shotList', jsonb_build_array(
    'Prosesi Utama & Pemindahan Kuncir Toga',
    'Foto Bersama Rektorat & Dekanat',
    'Sesi Foto Keluarga & Kerabat di Backdrop',
    'Candid Wisudawan Terbaik & Reaksi Orang Tua'
  )
)
WHERE service_pillar = 'EVENT_GRADUATION_PHOTO'
  AND (sector_specs = '{}'::jsonb OR sector_specs IS NULL);

UPDATE public.projects
SET sector_specs = jsonb_build_object(
  'signalFlow', jsonb_build_object(
    'switcher','vMix 4K Broadcast Console',
    'audio','Behringer X32 Producer Digital Mixer',
    'transmission','YouTube Live 1080p60 + Relay Videotron'
  ),
  'runOfShow', jsonb_build_array(
    jsonb_build_object('time','06:30','cue','Staging, Pairing & Audio Line Check','source','All Cameras'),
    jsonb_build_object('time','07:15','cue','Opening Bumper & Standby Master Wide','source','Cam 1'),
    jsonb_build_object('time','07:30','cue','Prosesi Masuk Senat & Indonesia Raya','source','Cam 2 + Cam 1'),
    jsonb_build_object('time','09:00','cue','Pemberian Ijazah per Fakultas','source','Cam 3 Podium'),
    jsonb_build_object('time','12:00','cue','Closing Bumper & Highlight Roll','source','Media Player')
  ),
  'rehearsalDate', rehearsal_date
)
WHERE service_pillar = 'BROADCAST_LIVE_STREAMING'
  AND (sector_specs = '{}'::jsonb OR sector_specs IS NULL);

UPDATE public.projects
SET sector_specs = jsonb_build_object(
  'targetDeliverables', jsonb_build_array(
    'Master Commercial Cut 16:9 (ProRes 422 / 4K UHD)',
    'Social Cutdown 9:16 (Reels / TikTok / Shorts)',
    'Clean Feed Master (Tanpa Lower-Third)'
  ),
  'maxRevisionRounds', 2
)
WHERE service_pillar = 'COMMERCIAL_VIDEO'
  AND (sector_specs = '{}'::jsonb OR sector_specs IS NULL);

-- ============================================================================
-- 21. COMMENTS
-- ============================================================================
COMMENT ON TABLE  public.media IS
  'Private storage keys only. Never return keys or original URLs in public DTOs.';
COMMENT ON TABLE  private.gallery_sessions IS
  'Server-only opaque sessions. Keep expired/revoked rows while favorites reference them.';
COMMENT ON COLUMN public.projects.access_token IS
  'Random URL locator, never an authorization credential.';
COMMENT ON COLUMN public.projects.service_pillar IS
  'Discriminator for the Sector Engine: BROADCAST_LIVE_STREAMING | COMMERCIAL_VIDEO | EVENT_GRADUATION_PHOTO.';
COMMENT ON TABLE  public.project_invoices IS
  'LEDGER SPINE: gross_contract_value is immutable. Payments live in invoice_payment_receipts. Balance/status are DERIVED via v_invoice_financial_position.';
COMMENT ON TABLE  public.invoice_payment_receipts IS
  'Immutable payment ledger. Negative amount = refund/credit note. Only verified_at IS NOT NULL counts toward the balance.';
COMMENT ON TABLE  public.outgoing_rental_orders IS
  'Studio gear rented OUT. A first-class demand source: blocks the asset window for internal dispatch.';
COMMENT ON FUNCTION public.check_asset_scheduling_conflict_v2(uuid,uuid,date,integer,integer,uuid) IS
  'Buffer-aware conflict resolver across BOTH internal projects and outgoing rentals.';
COMMENT ON FUNCTION public.get_client_invoice_dto(text) IS
  'THE ONLY client-facing billing path. Physically cannot read project_expenses.';

-- ============================================================================
-- 22. SELF-VERIFICATION
-- ============================================================================
DO $$
DECLARE
  v_tables integer;
  v_functions integer;
  v_crew integer;
  v_assets integer;
  v_presets integer;
  v_missing text[] := ARRAY[]::text[];
  t text;
BEGIN
  SELECT count(*) INTO v_tables FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

  SELECT count(*) INTO v_functions FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public';

  SELECT count(*) INTO v_crew    FROM public.crew_members;
  SELECT count(*) INTO v_assets  FROM public.inventory_assets;
  SELECT count(*) INTO v_presets FROM public.equipment_presets;

  -- Assert every table the application depends on actually exists.
  FOREACH t IN ARRAY ARRAY[
    'admins','customers','projects','media','favorites',
    'crew_members','project_crew_assignments','equipment_presets',
    'inventory_assets','project_expenses','project_invoices',
    'invoice_payment_receipts','vendor_purchase_orders',
    'vendor_purchase_order_items','outgoing_rental_orders',
    'outgoing_rental_items','portfolio_showcases','document_sequences',
    'moodboard_cards','moodboard_comments','studio_events',
    'money_splits','cash_ledger','editor_tasks','inquiries'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      v_missing := array_append(v_missing, t);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'CONSOLIDATION FAILED — missing tables: %', array_to_string(v_missing, ', ');
  END IF;

  IF v_crew < 5 THEN
    RAISE EXCEPTION 'SEED FAILED — expected 5 crew members, found %', v_crew;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '================================================================';
  RAISE NOTICE ' ELTS STUDIO OS — CONSOLIDATED SCHEMA APPLIED SUCCESSFULLY';
  RAISE NOTICE '================================================================';
  RAISE NOTICE '  public tables .............. %', v_tables;
  RAISE NOTICE '  public functions ........... %', v_functions;
  RAISE NOTICE '  crew members seeded ........ %', v_crew;
  RAISE NOTICE '  inventory assets seeded .... %', v_assets;
  RAISE NOTICE '  equipment presets seeded ... %', v_presets;
  RAISE NOTICE '----------------------------------------------------------------';
  RAISE NOTICE '  Key RPCs:';
  RAISE NOTICE '    get_crew_hub_payload / get_client_invoice_dto';
  RAISE NOTICE '    check_asset_scheduling_conflict_v2 / get_vendor_rental_manifest';
  RAISE NOTICE '    approve_money_split / submit_photo_selection';
  RAISE NOTICE '================================================================';
  RAISE NOTICE '';
END $$;

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename   text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.schema_migrations (filename)
VALUES ('0001_consolidated_studio_os.sql')
ON CONFLICT (filename) DO UPDATE SET applied_at = now();

COMMIT;

NOTIFY pgrst, 'reload schema';
