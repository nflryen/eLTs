# RBAC migration — operator guide

**Added:** 2026-10-17 · Migrations `0002_rbac_core.sql`, `0003_rbac_policies.sql`

## Order of application

```
0001_consolidated_studio_os.sql   (existing)
0002_rbac_core.sql                (roles, permissions, assignments, helpers)
0003_rbac_policies.sql            (replaces the blanket admin policies)
```

Apply in order. Both are idempotent and wrapped in a single transaction.

## What changed

| Before | After |
|---|---|
| `public.admins` boolean membership | 6 ranked roles in `public.roles` |
| `private.is_admin()` only | `current_role()`, `current_role_rank()`, `has_role_rank()`, `has_permission()` |
| One `{table}_admin_all` policy per table | `{table}_rbac_read` / `{table}_rbac_write` per table |
| Any admin sees everything | Finance tables restricted to FOUNDER (100) |

## Rank model

| Role | Rank | Notes |
|---|---|---|
| SUPER_ADMIN | 120 | Only role with `system.*` permissions |
| FOUNDER | 100 | Business governance; no `system.*` |
| ADMIN | 80 | Operations + invoice issuance; **cannot** settle payments |
| WORKER | 60 | Assigned work only |
| FREELANCER | 30 | Token/magic-link; no PostgREST grants |
| CLIENT | 10 | Gallery session; no PostgREST grants |

## Backward compatibility — IMPORTANT

`private.legacy_admin_rank()` returns **80 (ADMIN)** for any user present in
`public.admins` but absent from `public.role_assignments`.

This exists so deploying 0002/0003 cannot lock out existing members. 0002 also
back-fills every current `public.admins` row to **SUPER_ADMIN**, so in practice
existing operators are 120, not 80.

**Consequence to be aware of:** a member who is *only* in `public.admins` (no
`role_assignments` row) can read operations tables but **cannot** read
`project_invoices`, `project_expenses`, `money_splits` or `cash_ledger`, because
those require rank ≥ 100.

## Decommissioning the fallback

Once every operator has an explicit `role_assignments` row:

1. Verify: `select count(*) from public.admins a left join public.role_assignments r on r.user_id = a.user_id where r.user_id is null;` → must be `0`.
2. Then drop the fallback in a follow-up migration:
   `create or replace function private.legacy_admin_rank() returns smallint language sql immutable as $$ select 0::smallint $$;`

## Rollback

```bash
psql "$DATABASE_URL" -f supabase/migrations/rollback/0003_down.sql
```

Restores `{table}_admin_all` from `private.is_admin()`. Verified to return ADMIN
access to financial tables and to leave WORKER denied.

`0002` is **additive** — tables and back-filled assignments may be left in place.

## Verification performed

Applied to an in-memory Postgres (PGlite) with the real Supabase role fixtures.
Isolation confirmed by impersonating each role:

| Table | SUPER_ADMIN | FOUNDER | ADMIN | WORKER |
|---|---|---|---|---|
| `projects` | 1 | 1 | 1 | 1 |
| `customers` | 1 | 1 | 1 | **0** |
| `project_invoices` | 1 | 1 | **0** | **0** |
| `role_assignments` | all | self | self | self |

Additional invariants asserted: ADMIN has `invoice.issue` but not
`invoice.settle`; FOUNDER holds zero `system.*` permissions; SUPER_ADMIN holds
all 33; CLIENT and FREELANCER hold none. The `application` test suite was
unchanged by these migrations (43 pass / 7 pre-existing failures — see
`test-failure-analysis-2026-10-17.md`).

## Not yet done

- `requireRole()` guards in application code (step 7).
- Route-level visibility per role in `admin-shell.tsx`.
