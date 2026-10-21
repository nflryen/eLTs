begin;

/*
 * 0028 — Portfolio categories belong to the CMS, not to a hardcoded array.
 *
 * THE SPLIT THIS REPAIRS
 * ----------------------
 * The public /portfolio page filters by category, but those categories came
 * from `src/content/photography.ts` — a hardcoded array compiled into the
 * bundle. Meanwhile /admin/portfolio manages `portfolio_pages`, which had no
 * category column at all. So:
 *
 *   - an operator publishing a showcase could not say what it was,
 *   - the public filter could not see published showcases,
 *   - `portfolio_showcases` (which DOES have a category) was read by nothing.
 *
 * Three surfaces, three truths. This adds the field the CMS was missing so the
 * public filter can be driven by data.
 *
 * WHY A TEXT COLUMN AND NOT A LOOKUP TABLE
 * ----------------------------------------
 * The filter vocabulary is small, editorial, and changes with the studio's
 * service mix rather than with any business rule. A CHECK constraint keeps the
 * values honest without a join on every portfolio query, and the CMS selector
 * is generated from the same list so the two cannot drift. `tags` is free-form
 * because tags are for browsing, not for routing.
 */

-- ── 1. The category the public filter keys on ───────────────────────────────
alter table public.portfolio_pages
  add column if not exists category text;

/*
 * Constrained to the vocabulary the public filter renders. Deliberately NOT a
 * foreign key: a category is a label on a page, and retiring a label must not
 * cascade into deleting or blocking the pages that use it.
 */
alter table public.portfolio_pages drop constraint if exists portfolio_pages_category_check;
alter table public.portfolio_pages
  add constraint portfolio_pages_category_check
  check (
    category is null
    or category in ('wedding', 'prewedding', 'graduation', 'couple', 'event')
  );

/*
 * Free-form tags for secondary browsing ("outdoor", "intimate", "golden hour").
 * Defaults to an empty array so the CMS can append without a null check.
 */
alter table public.portfolio_pages
  add column if not exists tags text[] not null default '{}'::text[];

-- ── 2. Index the filter ─────────────────────────────────────────────────────
/*
 * The public index runs `where status='published' order by sort_order`, and the
 * filter narrows by category. A partial index keeps that cheap as the archive
 * grows, and matches the query shape exactly.
 */
create index if not exists portfolio_pages_published_category_idx
  on public.portfolio_pages (category, sort_order)
  where status = 'published';

-- ── 3. Keep the legacy showcase table honest ────────────────────────────────
/*
 * `portfolio_showcases` is currently read by nothing, but it is not dropped:
 * it may hold rows from an earlier import, and silently deleting an operator's
 * work is not a migration's call. Instead its category vocabulary is aligned so
 * that if it is ever revived or migrated into `portfolio_pages`, the values
 * already match the filter.
 */
alter table public.portfolio_showcases drop constraint if exists portfolio_showcases_category_check;
alter table public.portfolio_showcases
  add constraint portfolio_showcases_category_check
  check (category in ('wedding', 'prewedding', 'graduation', 'couple', 'event'));

commit;
