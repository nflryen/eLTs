# Master Orchestration & Execution Blueprint

**Status:** Plan for approval — no code changes made
**Prepared:** 2026-10-20
**Scope:** Pillar A (production crash), Pillar B (data audit + workflows), Pillar C (portfolio CMS + pricelist)
**Grounding:** 3 read-only audits run in parallel against the live database and codebase; every claim below is evidence-backed and cited.

---

## 0. Executive summary — read this first

**One item is blocking everything and only you can do it.**

Production `/admin` returns HTTP 500 with the body:

```
Supabase is misconfigured (invalid project URL).
```

That string is `src/middleware.ts:95` — my own guard, added two commits ago. It fires when `normaliseSupabaseUrl()` rejects the value. Meanwhile `/admin/login` returns **200**, because the middleware short-circuits that path at line 72, *before* the env check at line 93.

**Conclusion: the code is fine. The production environment variable `NEXT_PUBLIC_SUPABASE_URL` is structurally invalid.** Nothing I commit can fix it.

I could not verify or repair it because **the Vercel CLI is not authenticated** on this machine (`vercel whoami` → device-login prompt, no `VERCEL_TOKEN`, no `.vercel/` link). That is the one blocker.

| | |
|---|---|
| **You must set** | `NEXT_PUBLIC_SUPABASE_URL` = `https://<ref>.supabase.co` — bare origin, **no `/rest/v1`, no `/auth/v1`, no trailing slash** |
| Most likely current value | `https://<ref>.supabase.co/rest/v1/` — the REST endpoint is what the Supabase dashboard puts on the clipboard |
| Then | Redeploy (env changes need a new build) |
| Verify | `curl -s https://elts-plum.vercel.app/admin` must stop returning that string |

Everything else in this blueprint proceeds independently of that.

**Three findings that change the priority order:**

1. **Payroll pays to the wrong account.** Payslips read bank details from `crew_members.bank_*` (`src/lib/pdf/load-payslip.ts:61-64`), but self-service writes `user_profiles.bank_*` (`src/app/actions/profile.ts:176-182`). A member who updates their own bank account changes nothing about where their salary is sent, and nothing tells them. This is the single most damaging defect found.
2. **Payroll cannot generate at all.** `compensation_line_items` has **no write path** in application code — every reference is a `SELECT`. 1 row exists locally (my test seed). The payroll cycle RPC aggregates rows that nothing creates.
3. **Portfolio CMS is greenfield, not a rebuild.** `portfolio_showcases` exists with 24 columns and an **already-correct anon read policy**, but has 0 rows and zero write paths. `media` has 0 rows. The public site is 100% static from `src/content/photography.ts` (269 lines).

---

## 1. Parallel agent topology

### 1.1 Why naive parallelism fails here

Four agents editing this repo concurrently would collide in three predictable ways:

| Collision | Evidence | Mitigation |
|---|---|---|
| Duplicate migration numbers | Next free number is `0024`; B and C both need schema | **Reserve numbers up front** (§1.3) |
| `src/types/database.ts` concurrent edits | Single 900-line file, touched by every feature | **One owner** (Agent B), others submit patches |
| Nav/shell edits | `src/components/admin/studio-shell.tsx` is shared | **One owner** (Agent C), sequenced after B's schema lands |

The topology below is therefore **not** four independent streams. It is one serial foundation wave, then genuinely parallel feature waves with disjoint file ownership.

### 1.2 Topology

```
                    ┌──────────────────────────────────────┐
                    │  HEAD ORCHESTRATOR (Lead Evaluator)  │
                    │  owns: schema decisions, merge order,│
                    │  file-ownership map, quality gates,  │
                    │  conflict arbitration, final commit  │
                    └───────────────┬──────────────────────┘
                                    │
        ┌───────────────┬───────────┴───────────┬────────────────┐
        │               │                       │                │
   ┌────▼────┐    ┌─────▼─────┐          ┌──────▼──────┐   ┌─────▼──────┐
   │ AGENT A │    │  AGENT B  │          │  AGENT C    │   │  AGENT D   │
   │Reliability│   │Data Arch  │          │Workflow/    │   │Public + CMS│
   │  & Auth  │    │ & Auditor │          │Product      │   │ + Pricelist│
   └─────────┘    └───────────┘          └─────────────┘   └────────────┘
     Wave 1         Wave 1-2               Wave 2             Wave 2-3
```

### 1.3 Wave plan (dependency-ordered, not sequential-by-choice)

**Wave 0 — Foundation (serial, blocking, ~1 agent-hour)**

| Task | Owner | Why serial |
|---|---|---|
| Reserve migrations `0024` (B), `0025` (B), `0026` (C) | Head | Prevents number collision |
| `src/types/database.ts` schema additions for all 3 pillars, in one edit | Head | Avoids 3-way merge conflict in one file |
| Verify prod env fix landed (`curl` check) | Head | Gate for Pillar A closure |

**Wave 1 — Parallel (3 agents, disjoint files)**

| Agent | Files owned exclusively | Deliverable |
|---|---|---|
| **A — Reliability** | `src/middleware.ts`, `src/lib/env.ts`, `src/app/error.tsx`, new `src/app/api/health/route.ts`, `tests/env-*.test.ts` | Config-error page instead of bare 500; `/api/health` diagnostic; env contract tests |
| **B — Data Arch** | `supabase/migrations/0024_*.sql`, `0025_*.sql`, `src/app/actions/profile.ts` | Single-source-of-truth for identity + payout (§2) |
| **C — Workflow** | `src/lib/pdf/load-payslip.ts`, `src/app/actions/payroll.ts`, `src/app/actions/admin-expenses.ts` | Payout correctness + payroll write path (§3) |

**Wave 2 — Parallel (files unlocked after Wave 1 merges)**

| Agent | Files owned exclusively | Deliverable |
|---|---|---|
| **B** | `src/app/actions/inquiry.ts`, `booking.ts`, `admin-projects.ts` | Booking → project bridge (§3.4) |
| **C** | `supabase/migrations/0026_portfolio.sql`, `src/app/actions/portfolio.ts`, `src/components/admin/portfolio/**` | Portfolio CMS back end (§4) |
| **D** | `src/content/pricelist.ts`, `src/app/(public)/**`, `src/components/public/**` | Pricelist engine + public surface |

**Wave 3 — Integration (Head only, 2 agents)**

- Merge CMS admin UI into `studio-shell.tsx` nav (C, then D)
- Full gate suite
- Single release commit + tag

### 1.4 Merge & gate protocol (the Head's actual job)

Every agent output passes these gates **before** merge. Failing any gate returns the work, not the commit.

| Gate | Check | Blocking |
|---|---|---|
| **G1 Type** | `npm run typecheck` = 0 | Yes |
| **G2 Lint** | `npm run lint` = 0 warnings | Yes |
| **G3 Test** | `npm test` all pass | Yes |
| **G4 Schema** | `npm run verify:sql` PASS | Yes (if migrations) |
| **G5 Build** | `npm run build` exit 0 | Yes |
| **G6 No-client-auth** | No `startsWith('/admin')`-style check in a `"use client"` file | Yes |
| **G7 No-new-dep** | Any new dependency justified in the PR body | Yes |
| **G8 Evidence** | Claim backed by command output, not assertion | Yes |

**Conflict arbitration rule:** when two agents need the same file, the owner is whichever agent's pillar the file *semantically* belongs to, and the other submits a patch. Never "whoever commits first".

---

## 2. Pillar A — production login crash

### 2.1 Diagnosis (complete)

| Evidence | Finding |
|---|---|
| `curl /admin` → `500` body `Supabase is misconfigured (invalid project URL).` | Exact string from `src/middleware.ts:95` |
| `curl /admin/login` → `200` | Middleware line 72 short-circuits before line 93's env check |
| `normaliseSupabaseUrl` rejects `/rest/v1`, `/auth/v1`, bare host, empty | Verified by unit test |
| No `.vercel/` link, no `VERCEL_TOKEN`, `vercel whoami` → device login | Cannot inspect or fix prod env from here |

So: **login works, destination 500s** because the destination is the first route to reach the env guard. The error message the user saw ("couldn't load this page") is the generic error boundary, which is a *symptom*.

### 2.2 Fix plan

**A-1 — User action (blocking, cannot be automated here)**
Set the Vercel Production env var to the bare origin and redeploy. Cannot proceed without this.

**A-2 — Code: degrade gracefully instead of a bare 500** (Agent A)

Today a misconfigured env var yields `text/plain` "Supabase is misconfigured" on *every* admin route — no navigation, no explanation, no way to reach login. Replace with:
- A dedicated `/admin/config-error` page: what is wrong, which variable, how to fix.
- Redirect there from middleware instead of returning 500, so the operator sees a styled page.
- Keep the plain-text body **only** for `/api/admin/*` (machine consumers).

**A-3 — Code: `/api/health` diagnostic** (Agent A)

A no-auth endpoint returning *shape only, never values*:
```json
{ "supabaseUrl": { "present": true, "valid": false, "reason": "path_suffix" },
  "anonKey": { "present": true, "length": 208 },
  "serviceKey": { "present": false } }
```
This makes the next misconfiguration a 5-second diagnosis instead of a 30-minute one. Must never echo a value or a prefix of a secret.

**A-4 — Tests** (Agent A)

Env contract tests: for each of `{missing, empty, bare, trailing-slash, /rest/v1, /auth/v1, whitespace}`, assert the exact diagnostic reason. Pins the behaviour that just cost us an outage.

**A-5 — Migration drift guard** (Agent A)

`/admin` calls `get_my_role_context` (`src/app/actions/role-switch.ts:59`), added in migration `0020`. If production's database lags the repo, `/admin` breaks *after* the env fix with an RPC-not-found error. Add a startup assertion that reports missing RPCs by name. Cheap insurance against the next version of this same outage.

---

## 3. Pillar B — data audit, normalisation, workflow

### 3.1 Audit scope (measured, not estimated)

45 public tables · 77 foreign keys · 81 RLS policies · 27 triggers · 31 server-action files.

### 3.2 Findings — 16 duplicate fact pairs in 4 clusters

**Cluster 1 — Person identity (HIGHEST RISK)**

| Fact | Copy A | Copy B | Copy C | Authoritative today |
|---|---|---|---|---|
| Name | `user_profiles.full_name` | `crew_members.full_name` | `admins.display_name` + `auth.users.user_metadata` | **none — all writable** |
| Phone | `user_profiles.phone` | `crew_members.phone` | — | **B (crew) — but A is what users edit** |
| Bank | `user_profiles.bank_*` | `crew_members.bank_*` | — | **B — payslip pays from here** |

Confirmed live divergence: Wardah `profile_phone = NULL` vs `crew_phone = '+62 812 0000 0000'`. Writers: `profile.ts:93-101` (profiles only) and `admin-users.ts:462-476` (crew only). Neither touches the other.

**Cluster 2 — Project revenue (4 copies, 2 of them caller-supplied)**

`projects.contract_value` · `project_invoices.gross_contract_value` · `money_splits.gross_revenue` · plus `projects.dp_amount` vs `project_invoices.minimum_dp_pct`. `treasury-splits.ts:159-160` and `admin-finance.ts:131-132` accept `gross_revenue` **from the caller** rather than deriving it — a finance integrity hole, not just duplication.

**Cluster 3 — Crew fee double-count (financial misstatement)**

`trg_sync_crew_fee` mirrors `project_crew_assignments.fee_agreed` into `project_expenses` as `CREW_FEE`. `rab-panel.tsx:142-148` then counts *both* the fee and the mirror, and posts the inflated total to `money_splits`. The SQL profit engine explicitly excludes mirror rows — so JS and SQL disagree on studio profit.

**Cluster 4 — Dead columns**

`avatar_url` (×2), `projects.dp_amount` — written by nothing, read by nothing (or read then discarded at `admin-projects.ts:211-212`).

### 3.3 Normalisation plan (Agent B)

**Principle: one authoritative writer per fact, enforced by the database, not by convention.**

| Step | Action | Migration |
|---|---|---|
| B-1 | `user_profiles` becomes canonical for person identity + payout. Add `source_of_truth` comment. | `0024` |
| B-2 | `crew_members.phone/email/bank_*` → **generated read-only views** of `user_profiles`, or dropped after backfill. `crew_members` keeps only assignment facts (`crew_code`, `member_type`, `standard_day_rate`, `role_category`). | `0024` |
| B-3 | Backfill: reconcile every divergence, `user_profiles` wins for personal facts, log every conflict to an audit table before overwriting. | `0024` |
| B-4 | Payslip loader reads `user_profiles` — **fixes the payout bug** (§3.2 cluster 1). | code (Agent C) |
| B-5 | Kill the CREW_FEE double count: either drop the mirror rows or make every consumer filter `source_type = 'CREW_FEE'`. Prefer dropping the mirror and having the RAB read `project_crew_assignments` directly. | `0025` |
| B-6 | Revenue single source: `project_invoices.gross_contract_value` is the contract. `projects.contract_value` becomes a generated column or is dropped. `money_splits.gross_revenue` must be **derived**, never caller-supplied. | `0025` |
| B-7 | Drop dead columns after confirming zero readers. | `0025` |

**Non-negotiable ordering:** backfill **before** drop, and every destructive step behind a feature flag for one release. This is a live database with real invoices.

**Guard against recurrence:** a test that asserts no table except `user_profiles` has a `phone` column, and no table except `user_profiles` has `bank_account_number`. That is what stops the desync from silently returning.

### 3.4 Workflow breakthroughs (Agent C, then B)

The WorkflowAudit found the operational chain is **broken at both ends**:

| Gap | Evidence | Proposed fix |
|---|---|---|
| Public contact form never creates an inquiry | `contact-form.tsx:60-67` opens `wa.me`, never calls `submitInquiryAction`. The action exists with **zero callers**. | Wire the form to persist, then WhatsApp as a follow-up. Every inquiry becomes a trackable record. |
| Inquiries never become projects | No code path from `inquiries`/`studio_events` → `projects` | One-click "Convert to Project" on the inquiry, prefilled from the form. Removes the biggest re-typing step. |
| Invoices cannot be created from the project console | Creation UI only mounted on `/admin/invoices` | Mount `create-rental-invoice-modal` inside the project workspace, prefilled from `contract_value`. |
| Crew magic token never surfaced | `crew-manager.tsx` assigns but never shows the link | "Copy call-sheet link" + "Send via WhatsApp" button per assignment. Turns a 4-step manual task into one click. |
| Payroll cannot generate | `compensation_line_items` has no writer | Auto-derive line items from `project_crew_assignments` (fee_agreed) + `editor_tasks` (payable_amount) on cycle open. |
| Instrumentation | — | Surface "waiting on you" counts in the sidebar: unfilled call sheets, unverified receipts, draft cycles. |

Each is independently shippable and independently revertable.

---

## 4. Pillar C — public showcase, portfolio CMS, pricelist

### 4.1 Current state (verified)

- 6 public routes, **all static**, driven by `src/content/photography.ts` (269 lines of hardcoded strings and `/images/*.webp` paths).
- `portfolio_showcases`: 24 columns, FKs to `projects` + `media`, **anon SELECT policy already correct**, 0 rows, **no write path anywhere**.
- `media`: 0 rows. Needed before a portfolio builder can reference photos.

So Pillar C is **not a rewrite** — it is wiring an already-correct schema to a new admin surface.

### 4.2 Drag-and-drop canvas: the key design decision

**Recommendation: normalized-coordinate JSONB, rendered identically by CSS on both sides. No canvas library, no new dependency.**

The tempting-but-wrong option is a canvas/absolute-pixel editor. It breaks because the admin canvas width ≠ public viewport width, so a layout tuned at 1440px reflows badly at 390px and the team has to fix it twice.

Design:

```jsonc
// portfolio_sections.layout  (jsonb)
{
  "version": 1,
  "grid": { "cols": 12, "rows": 8 },          // normalized coordinate space
  "blocks": [
    { "id": "b1", "type": "photo",
      "mediaId": "…", "x": 0, "y": 0, "w": 6, "h": 4,
      "fit": "cover", "caption": null, "z": 1 },
    { "id": "b2", "type": "text",
      "html": "<h2>…</h2>", "x": 6, "y": 0, "w": 6, "h": 2, "z": 2 }
  ]
}
```

- **Editor**: `x/y/w/h` in grid cells, manipulated by pointer events with a drag/resize reducer. Snaps to the grid. Keyboard-nudge supported.
- **Public render**: same JSON → CSS Grid `grid-column: {x+1} / span {w}`. One renderer, two consumers, so what the team arranges is exactly what ships.
- **Responsive**: blocks stack in `z` order below `md`. Photos never distort (`fit` is explicit).
- **Templates**: photo-grid, editorial-split, case-study, full-bleed-hero — each is a preset `blocks[]` array, so "template" is data, not code.
- **Dependency**: `@dnd-kit/core` is the one candidate. It is accessible (keyboard + screen reader) which a hand-rolled pointer implementation is not. **Decision deferred to Head at Gate G7** — recommendation is to hand-roll pointer events first (≈120 lines, zero deps) and add dnd-kit only if accessibility testing fails.

### 4.3 Schema (Agent C, migration `0026`)

```sql
portfolio_pages      (id, slug, title, seo_*, status draft|published, published_at)
portfolio_sections   (id, page_id, kind, layout jsonb, sort_order)   -- one row per band
portfolio_items      (id, section_id|null, media_id, project_id,
                      title, summary, category, tags text[], sort_order)
pricelist_categories (id, slug, name, sort_order, is_active)
pricelist_packages   (id, category_id, name, price_idr, duration,
                      max_persons, badge, includes text[], crew text[],
                      notes, sort_order, is_active)
pricelist_addons     (id, name, price_idr, unit, description, is_active)
```

Why a table rather than the JSON file: the team must be able to change a price without a deploy, and the invoice builder needs to read the same rows the public site shows. **One source of truth for price** — the exact class of bug Pillar B is fixing elsewhere.

### 4.4 Pricelist engine

Ingest the supplied October 2026 data into `src/content/pricelist.ts` as a **typed seed**, then migrate into the tables above. Structure preserved exactly: 5 categories, 16 packages, 5 add-ons.

**UX upgrades (creative latitude, to be judged at G8):**
- **Comparison view** — the 4 wedding tiers side-by-side on the axis that actually differs (hours, crew, edited count).
- **Configurator** — pick category → package → add-ons → live total → "Book this" prefills the booking wizard and, internally, the invoice line items. This is where pricelist meets Pillar B: the same rows drive public display *and* invoice creation, so a quoted price can never drift from an invoiced price.
- **Add-on logic** — the Group package's "±Rp50.000/person includes +30 min" is currently a text note. Model it as a real quantity field so the total is computed, not estimated.

---

## 5. Execution sequence & gates

| Wave | Work | Blocked by | Est. |
|---|---|---|---|
| **0** | **User sets Vercel env var + redeploy** | *you* | 5 min |
| 0 | Reserve migration numbers; single `types/database.ts` edit | — | 1 h |
| 1 | A: graceful config page, `/api/health`, env tests | Wave 0 | 4 h |
| 1 | B: identity/payout single source (`0024`) | Wave 0 | 1 d |
| 1 | C: payslip reads `user_profiles`; payroll write path | Wave 0 | 1 d |
| 2 | B: revenue single source, CREW_FEE fix (`0025`) | Wave 1 B | 1 d |
| 2 | C: portfolio schema + CMS admin UI (`0026`) | Wave 1 | 2 d |
| 2 | D: pricelist tables + public pages + configurator | Wave 2 C | 2 d |
| 3 | Nav merge, full gates, release `v2.6.0` | All | 4 h |

**Definition of done per pillar:**

- **A** — `curl /admin` returns 200 (or a styled config page), `/api/health` reports `valid: true`, env tests pass, prod login reaches the dashboard.
- **B** — updating a phone number in `/settings/profile` is visible in Crew instantly; payslip PDF shows the account the user set; a test proves no second `phone`/`bank_account_number` column exists; JS and SQL profit engines agree on one project.
- **C** — a SUPER_ADMIN/FOUNDER can build a page by dragging, publish it, and see it at `/portfolio/<slug>` while logged out; all 16 packages render; "Book this" prefills the wizard and the invoice line items match the displayed price.

---

## 6. Risks and how they are handled

| Risk | Severity | Mitigation |
|---|---|---|
| Production env fix not done → nothing verifiable | **Blocking** | Flagged at top; cannot be automated (Vercel CLI unauthenticated) |
| Production DB migrations behind repo | High | A-5 startup assertion names missing RPCs |
| Backfill destroys financial history | High | Backfill-first, destructive steps behind a flag, conflicts logged to audit before overwrite |
| 4 agents conflict on shared files | High | File-ownership matrix (§1.3), single `types/database.ts` owner |
| Canvas editor ships layouts that break on mobile | Medium | Normalized grid + one renderer for both surfaces |
| Pricelist drifts between public and invoice | Medium | One table drives both (§4.3) |
| New dependency creep (`@dnd-kit`) | Medium | G7 gate; hand-roll first |

---

## 7. What I need from you

1. **Set the Vercel env var** (§0). Without it Pillar A cannot close and nothing can be verified in production.
2. **Confirm the normalisation is acceptable**: dropping `crew_members.phone/email/bank_*` in favour of `user_profiles` is a breaking schema change for one release. It is the correct fix for the payout bug, but it is destructive and I will not run it unapproved.
3. **Confirm scope order** — B before C, or C first for a visible public win? My recommendation is **B first**: paying someone to the wrong bank account outranks a portfolio builder.
4. **Canvas approach** — hand-rolled pointer events (0 deps) vs `@dnd-kit` (accessible, ~35 kB). Recommendation: hand-roll, escalate only if a11y fails.
