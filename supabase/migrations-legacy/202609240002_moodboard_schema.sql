-- Collaborative Moodboard Hub Migration
-- public.moodboard_cards and public.moodboard_comments
begin;

-- 1. Create moodboard_cards table
create table if not exists public.moodboard_cards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  card_type text not null check (card_type in ('IMAGE_REF', 'COLOR_SWATCH', 'SHOT_LIST', 'TECH_NOTE')),
  title text not null,
  payload jsonb not null default '{}'::jsonb,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- 2. Create moodboard_comments table
create table if not exists public.moodboard_comments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.moodboard_cards(id) on delete cascade,
  author_role text not null check (author_role in ('CLIENT', 'STUDIO')),
  author_name text not null,
  content text not null check (length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);

-- 3. Indexes for rapid lookups and ordered rendering
create index if not exists moodboard_cards_project_id_idx on public.moodboard_cards(project_id);
create index if not exists moodboard_cards_project_sort_idx on public.moodboard_cards(project_id, sort_order, created_at);
create index if not exists moodboard_comments_card_id_idx on public.moodboard_comments(card_id, created_at asc);

-- 4. Row Level Security policies
alter table public.moodboard_cards enable row level security;
alter table public.moodboard_comments enable row level security;

revoke all on public.moodboard_cards, public.moodboard_comments from anon, authenticated;
grant select, insert, update, delete on public.moodboard_cards, public.moodboard_comments to authenticated;
grant select, insert, update on public.moodboard_cards, public.moodboard_comments to anon;
grant all on public.moodboard_cards, public.moodboard_comments to service_role;

-- Admin policies (full access for verified studio admins)
create policy moodboard_cards_admin_all on public.moodboard_cards
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy moodboard_comments_admin_all on public.moodboard_comments
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- Public/Client policies (authenticated or anon gallery sessions)
create policy moodboard_cards_public_read on public.moodboard_cards
  for select to anon, authenticated
  using (true);

create policy moodboard_cards_public_insert on public.moodboard_cards
  for insert to anon, authenticated
  with check (true);

create policy moodboard_cards_public_update on public.moodboard_cards
  for update to anon, authenticated
  using (true)
  with check (true);

create policy moodboard_comments_public_read on public.moodboard_comments
  for select to anon, authenticated
  using (true);

create policy moodboard_comments_public_insert on public.moodboard_comments
  for insert to anon, authenticated
  with check (true);

comment on table public.moodboard_cards is 'Visual brief cards for creative direction (IMAGE_REF, COLOR_SWATCH, SHOT_LIST, TECH_NOTE).';
comment on table public.moodboard_comments is 'Threaded comments and discussion per visual brief card.';

notify pgrst, 'reload schema';
commit;
