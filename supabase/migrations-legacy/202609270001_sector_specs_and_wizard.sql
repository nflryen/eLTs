-- Migration: 202609270001_sector_specs_and_wizard.sql
BEGIN;

-- ============================================================================
-- 1. ADD SECTOR SPECS JSONB & REHEARSAL DATE TO PROJECTS
-- ============================================================================
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS sector_specs JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS rehearsal_date DATE;

CREATE INDEX IF NOT EXISTS idx_projects_pillar ON public.projects (service_pillar);
CREATE INDEX IF NOT EXISTS idx_projects_rehearsal ON public.projects (rehearsal_date);

-- ============================================================================
-- 2. BACKFILL EXISTING PROJECTS WITH DEFAULT SECTOR SPEC SCHEMAS
-- ============================================================================
-- Photo / Graduation Projects
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
WHERE (service_pillar ILIKE '%photo%' OR service_pillar ILIKE '%grad%' OR photography_type IN ('wedding', 'graduation', 'prewedding', 'couple', 'event'))
  AND (sector_specs = '{}'::jsonb OR sector_specs IS NULL);

-- Broadcast / Live Streaming Projects
UPDATE public.projects
SET sector_specs = jsonb_build_object(
  'signalFlow', jsonb_build_object(
    'switcher', 'vMix 4K Broadcast Console',
    'audio', 'Behringer X32 Producer Digital Mixer',
    'transmission', 'YouTube Live Stream 1080p60 + Relay Videotron Graha Widyatama'
  ),
  'runOfShow', jsonb_build_array(
    jsonb_build_object('time', '06:30', 'cue', 'Staging, Pairing Hollyland C1 & Audio Line Check', 'source', 'All Cameras'),
    jsonb_build_object('time', '07:15', 'cue', 'Opening Graphic Bumper & Standby Master Wide', 'source', 'Cam 1 Master'),
    jsonb_build_object('time', '07:30', 'cue', 'Prosesi Masuk Senat & Lagu Indonesia Raya', 'source', 'Cam 2 Roving + Cam 1'),
    jsonb_build_object('time', '09:00', 'cue', 'Pemberian Ijazah per Fakultas (Close-up Panggung)', 'source', 'Cam 3 Podium'),
    jsonb_build_object('time', '12:00', 'cue', 'Closing Bumper & Highlight Montage Roll', 'source', 'Media Player / Master')
  ),
  'rehearsalDate', rehearsal_date
)
WHERE (service_pillar ILIKE '%broadcast%' OR service_pillar ILIKE '%stream%' OR service_pillar = 'TECH_SOLUTION')
  AND (sector_specs = '{}'::jsonb OR sector_specs IS NULL);

-- Commercial Video Projects
UPDATE public.projects
SET sector_specs = jsonb_build_object(
  'targetDeliverables', jsonb_build_array(
    'Master Commercial Cut 16:9 (ProRes 422 / 4K UHD)',
    'Social Cutdown 9:16 (Instagram Reels / TikTok / YouTube Shorts)',
    'Clean Feed Master (Tanpa Lower-Third Grafis)'
  ),
  'maxRevisionRounds', 2,
  'storyboardUrl', NULL
)
WHERE (service_pillar ILIKE '%video%' OR service_pillar ILIKE '%aftermovie%')
  AND (sector_specs = '{}'::jsonb OR sector_specs IS NULL);

COMMIT;
