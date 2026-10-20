# Production Deployment Checklist — v2.4.0

**Release:** `v2.4.0` · tag `ea33f64`
**Scope:** multi-role session context, password-challenged role switcher, clean production seed
**Audience:** whoever runs the deploy, and whoever owns the accounts afterwards

Work top to bottom. Sections 1–3 are blocking; nothing is "done" until section 6 passes.

---

## 1. Environment variables

Set these in **Vercel → Project → Settings → Environment Variables** for the
**Production** scope. Vercel applies them at build *and* runtime; a missing
server-only variable fails the request that needs it, not the build, so a
missing value can look like a working deploy until someone opens a specific page.

### 1.1 Required — the app will not function without these

| Variable | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + Server | Project URL, e.g. `https://<ref>.supabase.co`. Read by `src/lib/env.ts`; the app throws "Supabase is not configured" if absent. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + Server | The **anon/publishable** key. Safe to expose to the browser — it is constrained by RLS. Never put the service-role key here. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | **Bypasses RLS entirely.** Never prefix with `NEXT_PUBLIC_`, never reference it from a Client Component. Leaking this is a total database compromise. |
| `INVOICE_PDF_SECRET` | **Server only** | Signs invoice and payslip PDFs (`src/app/actions/payroll.ts`, `src/app/api/invoices/[id]/pdf/route.ts`, `src/app/actions/project-dispatch.ts`). |
| `NEXT_PUBLIC_APP_URL` | Client + Server | Canonical origin, e.g. `https://elts.id`. Used by `src/app/sitemap.ts`; a wrong value silently produces sitemap URLs pointing at a placeholder domain. |

> ### ⚠️ `INVOICE_PDF_SECRET` must remain CONSTANT across restarts and redeploys
>
> This value signs every invoice and payslip PDF. If it changes, **every
> previously issued document fails verification** — the signature no longer
> matches, and a client or auditor holding a printed or downloaded slip cannot
> prove it is genuine. Rotating it silently invalidates financial records.
>
> - Generate once with `openssl rand -base64 48`.
> - Store it in Vercel **and** in the team password manager. If it exists in
>   only one place, a project deletion or an accidental env wipe destroys it.
> - **Never** generate it per-deploy, per-preview, or from a CI secret that
>   rotates.
> - Preview/Development environments should use a *different* value so a
>   preview deploy cannot mint documents that look production-signed.

### 1.2 Required for features beyond core CRUD

| Variable | Scope | Needed by |
|---|---|---|
| `GALLERY_PIN_PEPPER` | **Server only** | Gallery PIN hashing (`src/lib/security/credentials.ts`). Must be ≥32 random bytes base64url (≥43 chars); the app throws otherwise. **Must be constant** — changing it invalidates every existing gallery PIN. |
| `CLOUDINARY_CLOUD_NAME` | Server | Media upload (`src/app/actions/admin-media.ts`). |
| `CLOUDINARY_API_KEY` | Server | Media upload. |
| `CLOUDINARY_API_SECRET` | **Server only** | Media upload signing. |

Without the Cloudinary trio, uploads fail; the rest of the app still runs.

### 1.3 Required only for one-off operations (do NOT set in Vercel)

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | Local shell / CI only | Direct Postgres connection used by `npm run migrate` and `scripts/production-reset-seed.mjs`. Prefer the **Session pooler** URI. |
| `INITIAL_SEED_PASSWORD` | Local shell, single run | Optional. If set, every seeded account gets this password. If unset, the seed script generates a random password **per account** and prints them once. |

### 1.4 Optional

| Variable | Default | Notes |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | — | Public site origin for metadata/links. |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | — | Contact CTA. |
| `NEXT_PUBLIC_INSTAGRAM_URL` | — | Social link. |
| `GOOGLE_CALENDAR_ID` / `GOOGLE_CALENDAR_CLIENT_EMAIL` / `GOOGLE_CALENDAR_PRIVATE_KEY` | — | Calendar sync. Feature is inert without them. |

### 1.5 Never set in production

| Variable | Why |
|---|---|
| `TEST_SEED_TOKEN` | Enables `/api/test/seed`. The route already refuses to run unless `NODE_ENV` is `development` or `test`, so it is inert in production — but do not create the temptation. |
| `SEED_CREW_PASSWORD` | Development helper for `scripts/link-crew-identities.mjs`. |

---

## 2. Pre-deploy verification

Run from a clean checkout of `v2.4.0`, with `DATABASE_URL` pointed at the
production database:

```bash
git describe --exact-match HEAD     # must print v2.4.0
npm ci
npm run verify:sql                  # migrations, triggers, FKs, idempotency
npm test                            # 119/119
npm run typecheck                   # 0 errors
npm run lint                        # 0 warnings
npm run build                       # must compile
```

All six must pass. `verify:sql` applies the full migration chain in filename
order and re-applies `0019`–`0022` to prove idempotency; it is the gate that
catches schema drift between the repo and a hosted database.

---

## 3. Database state

Confirm the production database is in the intended post-seed state:

```sql
-- Five accounts, exactly the intended hybrid mappings.
select u.email, array_agg(ra.role_key order by r.rank desc) roles,
       (array_agg(ra.role_key) filter (where ra.is_default))[1] base
from auth.users u
join public.role_assignments ra on ra.user_id = u.id
join public.roles r on r.key = ra.role_key
group by u.email order by max(r.rank) desc;
```

Expected:

| Email | Roles | Base |
|---|---|---|
| `gendeng@elts.id` | `SUPER_ADMIN` | `SUPER_ADMIN` |
| `el@elts.id` | `FOUNDER` | `FOUNDER` |
| `wardah@elts.id` | `ADMIN` | `ADMIN` |
| `cahyo@elts.id` | `FOUNDER`, `WORKER` | `WORKER` |
| `ray@elts.id` | `FOUNDER`, `WORKER`, `EDITOR` | `WORKER` |

```sql
-- Equity must total exactly 10000 bp across active partners.
select sum(equity_bp) from public.partner_accounts where is_active;   -- 10000

-- Document numbering must be preserved, not reset.
select doc_type, period_key, last_value from public.document_sequences order by 1,2;
```

If any of these disagree, **stop**. Do not deploy on top of an unexpected
schema or dataset.

---

## 4. Mandatory first-run step — password rotation

> **Every one of the five team members must log in and immediately rotate their
> password at `/settings/security`.**

The seeded credentials are **temporary by construction**. They were either a
single shared `INITIAL_SEED_PASSWORD` or randomly generated and printed once to
the operator's console. Neither is acceptable as a long-lived credential:

- They were distributed out-of-band, so they exist in chat logs, notes, or
  someone's memory.
- The seed script's own output is not a secure channel.
- Until rotation happens, anyone who saw the provisioning output holds a
  working login — including `SUPER_ADMIN` (rank 120, the only role with
  `system.*` permissions).

### Procedure

For each member, in this order — **`gendeng@elts.id` last**, so a compromised
admin credential cannot be used to observe or interfere with the others:

1. Sign in at `/admin/login`.
2. Navigate to **`/settings/security`**.
3. Enter the temporary password as **Kata Sandi Saat Ini**.
4. Set a new password of **at least 10 characters** (enforced server-side).
5. Submit. The action verifies the current password, then **revokes every other
   session** for that account.

### Verification that rotation happened

```sql
-- Every account should have a recent password update.
select email, updated_at
from auth.users
order by updated_at desc;
```

The `updated_at` timestamp must be later than the seed run for all five rows.

### Accounts that must not be reachable before rotation

If the deployment goes live before rotation is complete, restrict access:
enable Supabase **Auth → Providers → Email → Disable signups**, and consider
placing the whole app behind Vercel Deployment Protection until the five
rotations are confirmed.

### Do not skip this because "it's only an internal tool"

`SUPER_ADMIN` can read every financial record, alter role assignments, and
change system settings. A leaked seeded admin password is a full compromise,
not a nuisance.

---

## 5. Post-deploy smoke test

Run these against the deployed URL, signed in as a real account:

| # | Check | Expected |
|---|---|---|
| 1 | Sign in at `/admin/login` | Redirects to `/admin`, sidebar shows the **active** role |
| 2 | Sidebar role switcher lists only owned roles | Ray sees `Founder`, `Kreatif`, `Editor` — nothing else |
| 3 | Switch **down** (Founder → Kreatif) | Applies immediately, no modal |
| 4 | Switch **up** (Kreatif → Founder) | Password modal appears |
| 5 | Submit a **wrong** password | "Kata sandi salah", role unchanged |
| 6 | Submit the **correct** password | Role elevates, countdown badge appears |
| 7 | While elevated, open `/admin` finance views | Margins visible |
| 8 | Switch back to Editor | Margins **gone** (RLS denies; empty, not an error) |
| 9 | `/settings/profile` — save name and phone | Persists after refresh |
| 10 | `/settings/profile` — change bank details with a **wrong** password | Rejected, no write |
| 11 | `/settings/security` — revoke another session | That session is signed out |
| 12 | `/invoice/<known-number>` | Renders the correct document |

Checks 3–8 are the point of this release. If check 8 shows margins while in
Editor mode, **roll back immediately** — that is the exact failure the release
exists to prevent.

---

## 6. Sign-off

- [ ] All five env vars in §1.1 set for Production, `INVOICE_PDF_SECRET` stored
      in the password manager and confirmed constant
- [ ] §2 six gates green on `v2.4.0`
- [ ] §3 database state matches the expected table and equity totals 10000 bp
- [ ] §4 all five members rotated, verified via `auth.users.updated_at`
- [ ] §5 twelve smoke checks pass
- [ ] Rollback path understood: `git checkout v2.2.1` for code; database
      migrations `0019`–`0022` are additive and **do not** need reverting for a
      code rollback — but the junction PK means a rollback to a pre-`0019`
      build would read `role_assignments` with the old single-row assumption
      and mis-resolve hybrid accounts. Prefer roll-forward.

---

## Appendix — variable reference by file

| Variable | Read by |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `src/lib/env.ts` → `getSupabaseConfig()` |
| `SUPABASE_SERVICE_ROLE_KEY` | `src/lib/env.ts` → `getServiceRoleKey()` |
| `GALLERY_PIN_PEPPER` | `src/lib/env.ts` → `getPinPepper()` |
| `CLOUDINARY_*` | `src/lib/env.ts` → `getCloudinaryConfig()` |
| `INVOICE_PDF_SECRET` | `src/app/actions/payroll.ts`, `src/app/api/invoices/[id]/pdf/route.ts`, `src/app/actions/project-dispatch.ts` |
| `NEXT_PUBLIC_APP_URL` | `src/app/sitemap.ts` |
| `DATABASE_URL` | `scripts/migrate.mjs`, `scripts/production-reset-seed.mjs`, `scripts/verify-remote.mjs` |
