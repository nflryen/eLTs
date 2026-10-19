# v2.2.0 — Zero-leakage RBAC & capability tokens

**Released:** 2026-10-20 · Branch `feature/mobile-and-folder-views` → `main`

This release closes a class of authorization defect in which the *UI* hid a
surface while the *route* and the *data layer* still served it. Every fix below
is enforced at two independent layers — the route guard and the database — so a
regression in one does not become a leak through the other.

---

## 1. Database: RLS was over-denying, not under-denying

The headline finding of the audit was counter-intuitive: row-level security had
never actually run.

`0001` granted `usage on schema private to authenticated`. `0005_gallery_session_rpcs`
then ran:

```sql
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;
```

That second statement **revoked** the grant `0001` had just made. Every RLS
policy calls `private.has_role_rank()`, so every policy evaluation raised
`permission denied for schema private` and Postgres denied the row.

Nobody noticed because 13 server actions read through the service-role client,
which bypasses RLS. The policies were decorative.

### `0007_rbac_access_repair.sql`

- Restores `USAGE` on `private` for `authenticated`, and `EXECUTE` **only** on
  the five helpers policies actually call. The write helpers
  (`set_updated_at`, `prevent_self_role_grant`,
  `enforce_project_status_transition`) remain trigger-only, so a client cannot
  rewrite an audit timestamp.
- Re-asserts the boundary for `project_invoices` (read ≥ 80, write ≥ 100),
  `inventory_assets` (read ≥ 60, manage ≥ 80, condition ≥ 60) and
  `editor_tasks` (self-scoped for WORKER via `assigned_user_id = auth.uid()`).
- Closes the "ADMIN may read an invoice but must not rewrite its money" gap with
  **column privileges**, which RLS cannot express: blanket `UPDATE` is revoked
  and only `invoice_number`, dates, notes and `is_cancelled` are re-granted.
- Ends with a `DO` block that raises if `USAGE` or `EXECUTE` is missing, so a
  future migration cannot silently reintroduce the defect.

**Verified live** (rank resolution through `SET LOCAL ROLE authenticated`):

| Rank | invoices | money_splits | cash_ledger | customers | assets | projects |
|---|---|---|---|---|---|---|
| WORKER (60) | 0 | 0 | 0 | 0 | 28 | 9 |
| ADMIN (80) | 8 | **0** | **0** | 7 | 28 | 9 |
| FOUNDER (120) | 8 | 1 | 1 | 7 | 28 | 9 |

---

## 2. Route guards: a refusal is a redirect, not a crash

Three separate defects produced a 500 where a clean refusal was intended.

**B1 — route-level.** `middleware.ts` asked only "is anyone signed in?". It never
asked "may *this* person open *this* route", so an ADMIN could load
`/admin/finance` and `/admin/users` by typing the URL and receive Treasury
buttons and a 15-row user directory with emails and Suspend controls. The
middleware now resolves rank through `public.get_caller_role()` — the same
function `src/lib/auth/roles.ts` uses, so guard and page cannot disagree — and
redirects (307) below the threshold.

**B3a — swallowed denials.** `getCalendarEvents` and `getExecutiveCockpitData`
both did `try { await requireOps() } catch {}` and then continued with the
service-role client. A guard whose denial is discarded is not a guard.

**Page-level 500s.** `requireRole()` throws, which is correct for Server Actions
but wrong for pages: a rank refusal is a routine navigation outcome, and
throwing surfaced the error boundary as HTTP 500. New `requirePageRole()` /
`requirePageOps()` / `requirePageStaff()` families call `redirect()` instead,
yielding a real **307** to `/admin?denied=unauthorized`. `requireRole()` is
deliberately unchanged so actions keep their `{ success, error }` contract.

| Persona | `/admin/finance` | `/admin/users` | `/admin/invoices` | `/admin/projects` |
|---|---|---|---|---|
| FOUNDER | 200 | 200 | 200 | 200 |
| ADMIN | **307** | **307** | 200 | 200 |
| WORKER | **307** | **307** | **307** | 200 |

---

## 3. Dynamic, duty-specific navigation

The shell had always declared `minRank` per destination, but nothing enforced it
against the payload — and two pages gated *above* their own nav entry, turning a
worker's own menu link into a 500.

| Role | Nav | Money surfaces in payload |
|---|---|---|
| FOUNDER / SUPER_ADMIN | All 11 routes | Full |
| ADMIN | 9 routes (no Treasury, no Users) | Invoices + clients; **no** ledger, splits, receivables |
| WORKER | `Hari Ini`, `Kalender`, `Proyek`, `Post-Produksi`, `Gear` | **None** — columns omitted server-side |
| FREELANCER | Crew portal only | Own agreed fee only |

Leaking is prevented by **projection, not hiding**:

- `/admin/projects` builds its `SELECT` from rank. A WORKER's payload never
  contains `contract_value`, `dp_amount`, `is_dp_paid` or `is_fully_paid`, and
  the Finansial column is not rendered. Hiding the cell alone would still have
  shipped the values in the RSC payload.
- `folder-card.tsx` previously rendered "Belum DP" as a *default* when the flags
  were absent — stating a payment fact the payload never contained. It now
  renders no finance chip at all.
- The console prunes `Tagihan Klien` and `RAB Internal` below rank 80, so a
  deep link (`?module=rab`) resolves away rather than opening an empty pane.
- `QuickActions` no longer offers "Buat Invoice" → `/admin/finance` to an ADMIN;
  it points at `/admin/invoices`.

### `0009_inventory_worker_projection.sql`

Opening Gear to WORKER would have exposed `replacement_value` and
`daily_rental_rate`. Postgres column grants are per *role*, and every staffer is
`authenticated`, so the split had to live in the query:
`v_inventory_assets_for_caller` resolves valuation columns to `NULL` below rank
80. Verified: WORKER inventory payload contains no currency at all; ADMIN sees
`Rp 190.000`.

---

## 4. Crew token lifecycle

### `0008_crew_token_lifecycle.sql`

**B5 — the fallback that bypassed the DTO.** `/crew/[token]` carried a raw
`from("project_crew_assignments")` fallback that rebuilt the payload by hand,
plus a fixture returning a hardcoded bank name and account number for any token
starting `crw-token-`. Both are deleted. The page now fails closed into the
invalid-token screen. The seeded `crw-token-…` value also violated the column's
own CHECK constraint — it had only ever "worked" because of the fixture.

**B6 — check-in had no credential.** `checkInCrewMember(assignmentId)` took a
bare UUID and wrote via service role. UUIDs appear in admin URLs, so anyone who
had seen one could mark a crew member present. The write is now
`public.crew_check_in(p_magic_token)`; the token is the only secret a freelancer
holds.

Behaviour, verified against the live database:

| Step | Result |
|---|---|
| Accept offer | `ACCEPTED` |
| Replay decline on accepted | `ALREADY_RESPONDED`, status unchanged |
| Accept after `offer_expires_at` | `OFFER_EXPIRED` |
| Check-in | timestamp recorded |
| Second check-in | returns the **first** timestamp (`already_checked_in: true`) |

Single-use is enforced with `SELECT … FOR UPDATE`, so two taps racing from one
link cannot flip ACCEPTED to DECLINED. Check-in is idempotent because field
crews lose signal and re-tap; an overwrite would corrupt the arrival record the
call sheet is reconciled against.

---

## 5. Design

- **Neumorphic folder cards** for the project index — tab-and-pocket silhouette,
  stretched-link click target, hover/focus reveal.
- **Mobile-first responsive calendar** with an agenda view below `lg`.
- **Collapsible sidebar** with persisted state, plus a bottom navigation shell
  for one-handed field use.
- Pillar-aware console: `pillar-config` decides which modules a broadcast or a
  graduation session needs, so no panel is added by scattered `if` statements.

---

## Upgrade notes

1. Apply migrations in order:
   ```
   0007_rbac_access_repair.sql
   0008_crew_token_lifecycle.sql
   0009_inventory_worker_projection.sql
   ```
   All three are transactional and idempotent. `0007` is additive on purpose —
   `0005` is already recorded in `schema_migrations` on the hosted database, and
   rewriting applied history would make the ledger disagree with reality.

2. **RLS now actually runs.** Any query that previously relied on the
   service-role client to bypass a broken policy will now be evaluated against a
   working one. Audit server actions that still use `createServiceSupabase()` —
   they are trusted by design, but they no longer have a broken policy behind
   them as a second line.

3. `offer_expires_at` must be set by dispatch for an offer to expire. Offers
   with no deadline remain open, matching previous behaviour.

4. `checkInCrewMember()` signature changed from `(assignmentId)` to
   `(magicToken)`. Only the crew portal calls it.

---

## Verification

```
npm test        111/111 pass
npm run typecheck  clean
npm run lint       0 errors, 0 warnings
npm run build      compiled successfully
```

Persona matrix exercised against a live dev server with real sessions and raw
HTTP status checks (`curl`, no redirect following) for FOUNDER, ADMIN, WORKER
and FREELANCER.
