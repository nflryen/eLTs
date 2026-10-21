begin;

/*
 * 0030 — Anonymous visitors could not read published portfolio pages at all.
 *
 * THE BUG
 * -------
 * 0026 created ONE select policy for `portfolio_pages` covering both roles:
 *
 *   for select to anon, authenticated
 *   using (status = 'published' or private.has_role_rank(60));
 *
 * The `or` does not save an anonymous caller, because Postgres evaluates the
 * FUNCTION PRIVILEGE before it evaluates the row. `anon` has no EXECUTE on
 * `private.has_role_rank(integer)` (0007 grants it to `authenticated` only) and
 * no USAGE on the `private` schema, so the whole query aborts with:
 *
 *   permission denied for function has_role_rank
 *
 * That is not an empty result — it is a 401 from PostgREST. Every anonymous
 * read of `/portfolio` therefore threw, `listPublishedPortfolioPages()` caught
 * it and returned `[]`, and the public index rendered its "nothing published
 * yet" empty state no matter what the studio published. The category filter had
 * nothing to filter because it never saw a row.
 *
 * WHY SPLIT THE POLICY INSTEAD OF GRANTING EXECUTE TO anon
 * -------------------------------------------------------
 * Granting `anon` EXECUTE on `has_role_rank` would make the rank helper callable
 * by the public internet and would put a `role_assignments` lookup on the
 * critical path of every public portfolio request. The predicate an anonymous
 * visitor needs is exactly one term long — `status = 'published'` — and needs no
 * helper at all. Splitting the policy keeps the wider draft-visible predicate
 * on `authenticated`, where the helper is already granted, and gives `anon` the
 * narrow one.
 *
 * This is the same posture 0026's comment describes ("drafts are not public")
 * expressed in a form Postgres can actually execute.
 */

-- ── 1. Anonymous: published only, no helper call ────────────────────────────
drop policy if exists portfolio_pages_read_anon on public.portfolio_pages;
create policy portfolio_pages_read_anon on public.portfolio_pages
  for select to anon
  using (status = 'published');

-- ── 2. Authenticated: unchanged semantics ───────────────────────────────────
/*
 * The `to anon, authenticated` form is replaced rather than duplicated: leaving
 * it in place would keep the anon branch broken, and permissive policies OR
 * together, so the broken branch would still be planned for anon queries.
 */
drop policy if exists portfolio_pages_read on public.portfolio_pages;
create policy portfolio_pages_read on public.portfolio_pages
  for select to authenticated
  using (status = 'published' or private.has_role_rank(60));

-- ── 3. The same defect on portfolio_sections ────────────────────────────────
/*
 * The section policy has the identical shape, so the public DETAIL route
 * (`/portfolio/[slug]`) was failing the same way for anonymous visitors: the
 * page row could not be read, and had it been readable, the sections query
 * would have died on the same helper. Both halves are fixed together because a
 * public portfolio that loads its title but not its canvas is still broken.
 */
drop policy if exists portfolio_sections_read_anon on public.portfolio_sections;
create policy portfolio_sections_read_anon on public.portfolio_sections
  for select to anon
  using (
    exists (
      select 1 from public.portfolio_pages p
      where p.id = portfolio_sections.page_id
        and p.status = 'published'
    )
  );

drop policy if exists portfolio_sections_read on public.portfolio_sections;
create policy portfolio_sections_read on public.portfolio_sections
  for select to authenticated
  using (
    exists (
      select 1 from public.portfolio_pages p
      where p.id = portfolio_sections.page_id
        and (p.status = 'published' or private.has_role_rank(60))
    )
  );

commit;
