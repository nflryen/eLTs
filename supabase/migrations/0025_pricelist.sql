begin;

/*
 * 0025 — Pricelist as data, not a JSON file.
 *
 * WHY A TABLE RATHER THAN src/content/pricelist.ts
 * -----------------------------------------------
 * The price a client is quoted and the price on their invoice must be the same
 * number. If the public site reads a hardcoded module while the invoice builder
 * reads a form, they drift the moment the team changes a price in one place.
 * One table, two consumers — the same single-source principle 0024 applied to
 * identity.
 *
 * Effective October 2026. Seeded from the official eLTs Visual Pricelist.
 */

create table if not exists public.pricelist_categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name        text not null,
  description text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.pricelist_packages (
  id            uuid primary key default gen_random_uuid(),
  category_id   uuid not null references public.pricelist_categories(id) on delete cascade,
  slug          text not null,
  name          text not null,
  price_idr     bigint not null check (price_idr >= 0),
  duration      text,
  max_persons   integer check (max_persons is null or max_persons > 0),
  /*
   * Structured crew composition. Stored as an array rather than a paragraph so
   * the comparison view can diff packages on crew count without parsing prose.
   */
  crew          text[] not null default '{}',
  includes      text[] not null default '{}',
  badge         text,
  notes         text,
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (category_id, slug)
);

create table if not exists public.pricelist_addons (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  price_idr   bigint not null check (price_idr >= 0),
  unit        text,
  description text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.pricelist_categories enable row level security;
alter table public.pricelist_packages   enable row level security;
alter table public.pricelist_addons     enable row level security;

/*
 * PRICES ARE PUBLIC. A prospective client must be able to read them without an
 * account — that is the entire point of publishing a pricelist. Writes are
 * restricted to ADMIN and above.
 */
drop policy if exists pricelist_categories_read on public.pricelist_categories;
create policy pricelist_categories_read on public.pricelist_categories
  for select to anon, authenticated using (is_active);

drop policy if exists pricelist_categories_write on public.pricelist_categories;
create policy pricelist_categories_write on public.pricelist_categories
  for all to authenticated
  using (private.has_role_rank(80)) with check (private.has_role_rank(80));

drop policy if exists pricelist_packages_read on public.pricelist_packages;
create policy pricelist_packages_read on public.pricelist_packages
  for select to anon, authenticated using (is_active);

drop policy if exists pricelist_packages_write on public.pricelist_packages;
create policy pricelist_packages_write on public.pricelist_packages
  for all to authenticated
  using (private.has_role_rank(80)) with check (private.has_role_rank(80));

drop policy if exists pricelist_addons_read on public.pricelist_addons;
create policy pricelist_addons_read on public.pricelist_addons
  for select to anon, authenticated using (is_active);

drop policy if exists pricelist_addons_write on public.pricelist_addons;
create policy pricelist_addons_write on public.pricelist_addons
  for all to authenticated
  using (private.has_role_rank(80)) with check (private.has_role_rank(80));

grant select on public.pricelist_categories, public.pricelist_packages,
  public.pricelist_addons to anon, authenticated, service_role;
grant insert, update, delete on public.pricelist_categories, public.pricelist_packages,
  public.pricelist_addons to authenticated, service_role;

-- ── Seed: official eLTs Visual Pricelist, October 2026 ──────────────────────
insert into public.pricelist_categories (slug, name, description, sort_order) values
  ('graduation-photo', 'Graduation Photo', 'Sesi foto wisuda dengan hasil edit siap unggah.', 1),
  ('graduation-video', 'Graduation Video', 'Video sinematik untuk momen kelulusan.', 2),
  ('event-documentation', 'Event Documentation', 'Dokumentasi acara, dari foto hingga aftermovie.', 3),
  ('broadcast-live-streaming', 'Broadcast & Live Streaming', 'Produksi siaran multi-kamera dengan operator.', 4),
  ('wedding-engagement', 'Wedding & Engagement', 'Paket pernikahan dan pertunangan.', 5)
on conflict (slug) do update
  set name = excluded.name, description = excluded.description, sort_order = excluded.sort_order;

-- Packages
with cat as (select id, slug from public.pricelist_categories)
insert into public.pricelist_packages
  (category_id, slug, name, price_idr, duration, max_persons, crew, includes, badge, notes, sort_order)
values
  -- Graduation Photo
  ((select id from cat where slug='graduation-photo'), 'personal', 'Personal', 350000, '1 Hour', null, '{}',
   array['Unlimited Photo','30 Edited Photos','Free Moodboard Reference','Digital Files via Google Drive'],
   null, null, 1),
  ((select id from cat where slug='graduation-photo'), 'group', 'Group', 400000, '2 Hours', 4, '{}',
   array['Unlimited Photo','40 Edited Photos','Max 4 Persons','Free Moodboard Reference','Digital Files via Google Drive'],
   null, 'Add-on: +Rp50.000/person (includes free +30 minutes)', 2),
  ((select id from cat where slug='graduation-photo'), 'full-day', 'Full Day', 800000, 'Flexible Duration', null, '{}',
   array['Unlimited Photo','50 Edited Photos','Free Moodboard Reference','Digital Files via Google Drive'],
   null, null, 3),
  -- Graduation Video
  ((select id from cat where slug='graduation-video'), 'personal', 'Personal', 350000, '1 Hour', null, '{}',
   array['1 Cinematic Highlight Video','1x Revision','Free Concept'],
   null, 'Output duration: 1 - 1.5 minutes', 1),
  ((select id from cat where slug='graduation-video'), 'group', 'Group', 450000, '2 Hours', null, '{}',
   array['1 Cinematic Highlight Video','1x Revision','Free Concept'],
   null, 'Output duration: 1 - 2 minutes', 2),
  -- Event Documentation
  ((select id from cat where slug='event-documentation'), 'paket-1', 'Paket 1', 650000, null, null, '{}',
   array['Full Event Photography','Full Edited Photos','Digital Files via Google Drive'],
   null, 'Can be customized according to event needs', 1),
  ((select id from cat where slug='event-documentation'), 'paket-2', 'Paket 2', 1350000, null, null, '{}',
   array['Full Event Photography','Full Event Videography','Full Edited Photos','1 Cinematic Aftermovie Highlight Video (2-3 minutes)','Digital Files via Google Drive'],
   null, 'Can be customized according to event needs', 2),
  ((select id from cat where slug='event-documentation'), 'paket-3', 'Paket 3', 1850000, null, null, '{}',
   array['Full Event Photography','Full Event Videography','Event Content Creator','Full Edited Photos','1 Cinematic Aftermovie Highlight Video (2-3 minutes)','1 Video Recap (30 seconds)','Digital Files via Google Drive'],
   null, 'Can be customized according to event needs', 3),
  ((select id from cat where slug='event-documentation'), 'full-package', 'Full Package', 2350000, '6 Hours', null, '{}',
   array['Full Event Photography (Candid & Group Photos)','Full Event Videography','Event Content Creator','Drone Aerial Footage','Full Edited Photos','1 Cinematic Aftermovie Highlight Video (2-3 minutes)','1 Video Recap (30 seconds)','Digital Files via Google Drive'],
   null, 'Can be customized according to event needs', 4),
  -- Broadcast & Live Streaming
  ((select id from cat where slug='broadcast-live-streaming'), 'basic', 'Basic', 2250000, 'Up to 8 Hours', null, '{}',
   array['1 Camera Full HD + Tripod & HDMI Capture','VJ / Operator (vMix, Resolume, OBS)','1 High-End Broadcast Laptop','Audio Line-In & Out Connection to Event Sound System','Direct Stream to 2 Platforms (YouTube / Zoom) + 1 Output Screen','Custom Screen (Overlay & Lower Third Name)'],
   null, 'Event duration up to 8 hours', 1),
  ((select id from cat where slug='broadcast-live-streaming'), 'favorite', 'Favorite', 2750000, 'Up to 8 Hours', null, '{}',
   array['2 Cameras Full HD + Tripod & HDMI Capture','VJ / Operator (vMix, Resolume, OBS)','1 High-End Broadcast Laptop','Audio Line-In & Out Connection to Event Sound System','Direct Stream to 2 Platforms (YouTube / Zoom) + 1 Output Screen','Custom Screen (Overlay & Lower Third Name)'],
   null, 'Event duration up to 8 hours', 2),
  ((select id from cat where slug='broadcast-live-streaming'), 'premium', 'Premium', 3800000, 'Up to 8 Hours', null, '{}',
   array['2 Cameras Full HD + Tripod & HDMI Capture + Mirrorless & Gimbal','VJ / Operator (vMix, Resolume, OBS)','2 High-End Broadcast Laptops','Audio Line-In & Out Connection to Event Sound System','Direct Stream to 2 Platforms (YouTube / Zoom) + 2 Output Screens','Custom Screen (Overlay & Lower Third Name)'],
   null, 'Event duration up to 8 hours', 3),
  -- Wedding & Engagement
  ((select id from cat where slug='wedding-engagement'), 'intimate', 'Intimate', 1650000, 'Up to 4 Hours', null,
   array['1 Main Photographer','1 Videographer'],
   array['40 Edited Photos (Color Correction & Retouching)','1 Cinematic Highlight Video (1-2 minutes)','Free Concept & Moodboard Reference','Unlimited Photos (Google Drive)'],
   null, null, 1),
  ((select id from cat where slug='wedding-engagement'), 'silver', 'Silver (Best Seller - Standard Wedding)', 3250000, 'Up to 6 Hours (Half Day)', null,
   array['2 Photographers (Main & Candid)','1 Cinematic Videographer','1 Content Creator (iPhone 14 Pro Max)'],
   array['80 Edited Photos','1 Cinematic Highlight Video (2-3 minutes)','1 Reel/TikTok Vertical Video Content','Drone Aerial Footage','Flashdisk 32GB + Custom Wooden Box','Free Concept & Moodboard Reference','Unlimited Photos (Google Drive)'],
   'Best Seller', null, 2),
  ((select id from cat where slug='wedding-engagement'), 'gold', 'Gold (Full Day Premium)', 5450000, 'Up to 10 Hours (Full Day)', null,
   array['2 Professional Photographers','2 Videographers (Cinematic Docu)','1 Content Creator (iPhone 14 Pro Max)','1 Drone Pilot'],
   array['120+ Edited Photos','1 Video Teaser (1 minute) & 1 Highlight (3-5 minutes)','1 Full Duration Documentation Video (Long Cut)','3 Reels/TikTok Vertical Content','Free Concept & Moodboard Reference','Flashdisk 32GB + Custom Wooden Box','Unlimited Photos (Google Drive)','BONUS: Premium Photobook Album 10R (20 Pages)'],
   null, null, 3),
  ((select id from cat where slug='wedding-engagement'), 'platinum', 'Platinum (Hybrid + Live Stream)', 7850000, 'Up to 10 Hours (Full Day)', null,
   array['Gold Package Team (6 Crew)','Live Streaming Team (2 Cam, VJ, 2 Laptops)'],
   array['All Gold Package Deliverables','2-Camera Live Streaming Broadcast (YouTube / Zoom)','Audio Line-In/Out Connection to Sound System','Custom Screen Overlay & Lower Third Name Tag'],
   'All-In', null, 4)
on conflict (category_id, slug) do update
  set name = excluded.name, price_idr = excluded.price_idr, duration = excluded.duration,
      max_persons = excluded.max_persons, crew = excluded.crew, includes = excluded.includes,
      badge = excluded.badge, notes = excluded.notes, sort_order = excluded.sort_order;

insert into public.pricelist_addons (slug, name, price_idr, unit, description, sort_order) values
  ('content-creator-only', 'Event Content Creator Only', 200000, null, 'iPhone 14 Pro Max Camera Coverage', 1),
  ('drone-aerial', 'Drone Aerial Footage Session', 450000, null, 'Drone Pilot + High Quality Raw Footage', 2),
  ('live-stream-multicam', 'Live Streaming Multi-Cam Add-On', 2250000, null, '2 Cameras Full HD + VJ Operator + Audio Connection', 3),
  ('photobook-premium', 'Cetak Album Photobook Premium', 500000, null, '10R Custom Hardcover (20 Pages)', 4),
  ('overtime-crew', 'Overtime Crew', 150000, 'per hour / per crew', 'Outside package duration', 5)
on conflict (slug) do update
  set name = excluded.name, price_idr = excluded.price_idr, unit = excluded.unit,
      description = excluded.description, sort_order = excluded.sort_order;

grant insert, update, delete on public.pricelist_addons to authenticated, service_role;

commit;
