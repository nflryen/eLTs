# Guard migration — server-side authorization (step 7)

**Added:** 2026-10-17 · Companion to `docs/rbac-migration.md`

## What changed

Every server-side authorization call-site now resolves through the RBAC rank
model instead of a binary `is_admin()` membership check.

| Guard | Module | Meaning | Call-sites |
|---|---|---|---|
| `requireSuperAdmin()` | `@/lib/auth/roles` | rank ≥ 120 | 2 |
| `requireFounder()` | `@/lib/auth/roles` | rank ≥ 100 | 24 |
| `requireOps()` | `@/lib/auth/roles` | rank ≥ 80 | 86 |
| `requireStaff()` | `@/lib/auth/roles` | rank ≥ 60 | 5 |
| `requirePermission(k)` | `@/lib/auth/roles` | explicit grant | 7 |
| `requireAdmin()` | `@/lib/auth/admin` | rank ≥ 80 (legacy, RBAC-aware) | 11 |

## Domain → guard mapping

| Domain | Guard | Rationale |
|---|---|---|
| `treasury-splits`, `admin-finance`, `admin-expenses`, `invoice-receipts` | `requireFounder` | Money movement and settlement |
| `invoice-actions` reads | `requirePermission("invoice.read")` | ADMIN may view invoices |
| `invoice-actions` create | `requirePermission("invoice.issue")` | ADMIN may raise, not settle |
| `admin-projects`, `admin-media`, `admin-customers`, `admin-inventory`, `admin-calendar`, `crew`, `gear-*`, `attention`, `admin-cockpit` | `requireOps` | Operations lead |
| `admin/(dashboard)/layout.tsx`, `lib/workspace.ts` | `requireStaff` | Any staff may open the shell |
| `/api/admin/**` (5 routes via `withAdmin`) | `requireAdmin` | Rank ≥ 80 preserved |

## Two design decisions worth knowing

### 1. `requireAdmin()` was made RBAC-aware rather than deleted

Five `/api/admin/**` handlers use the `withAdmin()` wrapper, which is a good
abstraction. Rewriting all five risked introducing new bugs for no benefit, so
`requireAdmin()` now resolves rank through `get_caller_role()` and requires ≥ 80.

Behaviour is unchanged for existing accounts (they are ADMIN or above) and
WORKER is now correctly rejected.

### 2. Guards are MINIMUM rank, never equality

`requireRole("ADMIN")` would exclude FOUNDER and SUPER_ADMIN, who outrank it.
`ROLE_RANK` comparison is used instead, resolved against the same database
function the RLS policies call — so the application and the database cannot
disagree about who someone is.

## New-install note

`src/lib/auth/roles.ts` calls two RPCs added in migration `0002`:

- `public.get_caller_role()` → `{ role_key, role_rank, display_name }`
- `public.has_permission_for_caller(text)` → `boolean`

Both are `SECURITY DEFINER`, resolve the actor from `auth.uid()`, and are
revoked from `anon`. If they are missing, the guards fail **closed**
(`ForbiddenError`), not open.

## Verification

- `npx tsc --noEmit` → 0 errors
- `npm test` → 43 pass / 7 fail (identical to the pre-step-7 baseline; the 7 are
  the fixture drift documented in `test-failure-analysis-2026-10-17.md`)
- Live: `/`, `/client`, `/admin/login` → 200; `/admin`, `/admin/finance`,
  `/admin/inventory` → 307 to login; `/invoice/INV-TEST` → 404;
  `/api/test/seed` → 404
- Permission matrix confirmed against a real Postgres instance:

| Permission | SUPER_ADMIN | FOUNDER | ADMIN | WORKER |
|---|---|---|---|---|
| `invoice.read` | ✓ | ✓ | ✓ | — |
| `invoice.issue` | ✓ | ✓ | ✓ | — |
| `invoice.settle` | ✓ | ✓ | **—** | — |
| `ledger.read` | ✓ | ✓ | — | — |
| `system.rbac` | ✓ | — | — | — |

## Not yet done

- Nav/route visibility per role in `admin-shell.tsx`. Every destination currently
  renders for any staff member; the guard rejects on access, but the UI does not
  yet hide what a WORKER cannot use.
- `SUPER_ADMIN` dashboard (audit logs, telemetry, feature flags) — the role and
  permissions exist; no screens consume them yet.
- The `legacy_admin_rank()` fallback should be retired once every operator has an
  explicit assignment (see `rbac-migration.md`).
