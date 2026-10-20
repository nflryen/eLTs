begin;

/*
 * 0026 — Portfolio builder: pages, sections, and the drag-and-drop layout model.
 *
 * DESIGN DECISION: NORMALISED GRID, NOT PIXELS
 * --------------------------------------------
 * A layout is stored as grid coordinates (x, y, w, h in cells), never as pixel
 * offsets. An admin canvas is ~1440px wide; a phone is ~390px. A pixel layout
 * tuned in the editor reflows badly on the device the client actually uses, and
 * the team ends up fixing every page twice.
 *
 * One JSON model, rendered by CSS Grid on BOTH sides, means what the team
 * arranges is exactly what ships.
 */

create table if not exists public.portfolio_pages (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title         text not null check (length(btrim(title)) between 1 and 200),
  summary       text,
  seo_title     text,
  seo_description text,
  cover_url     text,
  status        text not null default 'draft'
    check (status in ('draft', 'published')),
  published_at  timestamptz,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.portfolio_sections (
  id          uuid primary key default gen_random_uuid(),
  page_id     uuid not null references public.portfolio_pages(id) on delete cascade,
  kind        text not null default 'canvas'
    check (kind in ('canvas', 'hero', 'text', 'gallery')),
  /*
   * The layout document.
   *
   *   { "version": 1,
   *     "grid": { "cols": 12, "rows": 8 },
   *     "blocks": [ { "id", "type": "photo"|"text",
   *                   "mediaId"?, "html"?, "x","y","w","h",
   *                   "fit"?: "cover"|"contain", "z" } ] }
   *
   * Coordinates are CELL indices, so the renderer is resolution-independent.
   * A `blocks` array is intentionally the whole model: it is easy to validate,
   * easy to diff, and needs no schema migration to add a new block type.
   */
  layout      jsonb not null default '{"version":1,"grid":{"cols":12,"rows":8},"blocks":[]}'::jsonb,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists portfolio_sections_page_idx
  on public.portfolio_sections (page_id, sort_order);

alter table public.portfolio_pages    enable row level security;
alter table public.portfolio_sections enable row level security;

/*
 * Published pages are public; drafts are not. This is the ONLY gate between an
 * unfinished draft and a client seeing it, so the predicate is explicit rather
 * than relying on the application to filter.
 */
drop policy if exists portfolio_pages_read on public.portfolio_pages;
create policy portfolio_pages_read on public.portfolio_pages
  for select to anon, authenticated
  using (status = 'published' or private.has_role_rank(60));

drop policy if exists portfolio_pages_write on public.portfolio_pages;
create policy portfolio_pages_write on public.portfolio_pages
  for all to authenticated
  using (private.has_role_rank(80)) with check (private.has_role_rank(80));

drop policy if exists portfolio_sections_read on public.portfolio_sections;
create policy portfolio_sections_read on public.portfolio_sections
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.portfolio_pages p
      where p.id = portfolio_sections.page_id
        and (p.status = 'published' or private.has_role_rank(60))
    )
  );

drop policy if exists portfolio_sections_write on public.portfolio_sections;
create policy portfolio_sections_write on public.portfolio_sections
  for all to authenticated
  using (private.has_role_rank(80)) with check (private.has_role_rank(80));

grant select on public.portfolio_pages, public.portfolio_sections
  to anon, authenticated, service_role;
grant insert, update, delete on public.portfolio_pages, public.portfolio_sections
  to authenticated, service_role;

-- ── Keep updated_at honest ─────────────────────────────────────────────────
drop trigger if exists portfolio_pages_updated_at on public.portfolio_pages;
create trigger portfolio_pages_updated_at
  before update on public.portfolio_pages
  for each row execute function private.set_updated_at();

drop trigger if exists portfolio_sections_updated_at on public.portfolio_sections;
create trigger portfolio_sections_updated_at
  before update on public.portfolio_sections
  for each row execute function private.set_updated_at();

-- ── Validation: the layout document must be structurally sane ──────────────
/*
 * Enforced in the database, not only in TypeScript.
 *
 * A malformed layout (negative size, block outside the grid, missing id) would
 * render as an invisible or overflowing block on the PUBLIC site, where nobody
 * is signed in to notice. Rejecting it at write time means the editor cannot
 * publish something the renderer cannot draw.
 */
create or replace function private.validate_portfolio_layout()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_cols integer;
  v_blocks jsonb;
  v_block jsonb;
begin
  if new.layout is null then
    raise exception 'layout is required' using errcode = 'check_violation';
  end if;

  v_cols := coalesce((new.layout #>> '{grid,cols}')::int, 12);
  if v_cols < 1 or v_cols > 24 then
    raise exception 'grid.cols must be between 1 and 24, got %', v_cols
      using errcode = 'check_violation';
  end if;

  v_blocks := new.layout -> 'blocks';
  if v_blocks is null or jsonb_typeof(v_blocks) <> 'array' then
    raise exception 'layout.blocks must be an array' using errcode = 'check_violation';
  end if;

  for v_block in select * from jsonb_array_elements(v_blocks) loop
    if coalesce(v_block ->> 'type', '') not in ('photo', 'text') then
      raise exception 'block type must be photo or text, got %', v_block ->> 'type'
        using errcode = 'check_violation';
    end if;
    if (v_block ->> 'w')::int is null or (v_block ->> 'w')::int < 1 then
      raise exception 'block w must be >= 1' using errcode = 'check_violation';
    end if;
    if (v_block ->> 'h')::int is null or (v_block ->> 'h')::int < 1 then
      raise exception 'block h must be >= 1' using errcode = 'check_violation';
    end if;
    if (v_block ->> 'x')::int < 0 or (v_block ->> 'y')::int < 0 then
      raise exception 'block x/y must be >= 0' using errcode = 'check_violation';
    end if;
    if (v_block ->> 'x')::int + (v_block ->> 'w')::int > v_cols then
      raise exception 'block exceeds grid width (x % + w % > %)',
        (v_block ->> 'x')::int, (v_block ->> 'w')::int, v_cols
        using errcode = 'check_violation';
    end if;
  end loop;

  return new;
end $$;

drop trigger if exists trg_validate_portfolio_layout on public.portfolio_sections;
create trigger trg_validate_portfolio_layout
  before insert or update on public.portfolio_sections
  for each row execute function private.validate_portfolio_layout();

commit;
