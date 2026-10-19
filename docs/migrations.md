# Migrations & Hosted Schema Hydration

`supabase/migrations/*.sql` is the authoritative schema definition for ELTS.
The PGlite test-suite (`npm test`) runs those exact files in memory, which proves
the SQL is correct — but it never touches the hosted Supabase project. The hosted
database can therefore drift behind the repository without any test failing.

## Symptom of drift

When a migration has not been applied to the hosted project, PostgREST answers
every request for the missing relation with:

```
Could not find the table 'public.crew_members' in the schema cache
```

The admin console then silently degrades to its in-memory fallback seeds — the
personnel pool still renders, but nothing persists and invoices, expenses and
assignments are empty. This is a false-green: `npm test` passes while production
data access is broken.

## Tables and RPCs that must exist

| Object | Defined in |
| --- | --- |
| `public.projects`, `public.customers`, `public.gallery_media`, `public.invoice_access` | `202609180001_foundation.sql` |
| `public.crew_members`, `public.project_crew_assignments`, `public.project_expenses` | `202609240005_operations_dispatch_schema.sql` |
| `public.money_splits`, `public.studio_ledger` | `202609240003_finance_splits_schema.sql` |
| `public.calendar_events` | `202609240004_calendar_events_schema.sql` |
| `public.inventory_assets` | `202609240006_inventory_rab_users_schema.sql` |
| `public.project_invoices` | `202609280001_client_invoices_and_crud_extensions.sql` |
| `get_crew_hub_payload`, `get_client_invoice_dto` | `202609240005_…`, `202609280001_…` |

Triggers that must remain intact (all are verified by `npm test`):

- `trg_cascade_project_reschedule` — shifts crew consent and purges unconfirmed fees on date change.
- `trg_sync_crew_fee` — mirrors an accepted assignment's fee into `public.project_expenses` (only on `ACCEPTED`).
- `trg_sync_project_payment` — keeps invoice payment status and project paid-flags in sync.

## Applying migrations

### 1. Get the connection string

Supabase Dashboard → **Project Settings** → **Database** → **Connection string**.
Prefer the **Session pooler** URI (`...pooler.supabase.com:5432`) — it works on
IPv4-only networks where the direct `db.<ref>.supabase.co` host does not resolve.

```bash
export DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
```

### 2. Preview, then apply

```bash
npm run migrate -- --dry-run   # list what would run, write nothing
npm run migrate                # apply every migration not yet recorded
```

The runner records applied filenames in `public.schema_migrations`, so re-running
is a no-op. Every migration in this repo is written with `IF NOT EXISTS` /
`ADD COLUMN IF NOT EXISTS` guards, so `--force` (re-apply everything) is also safe.

After applying, the runner issues `NOTIFY pgrst, 'reload schema'`, which forces
PostgREST to drop its cached schema. Without that step the API keeps reporting
the pre-migration schema even though the tables exist.

### Options

| Flag | Effect |
| --- | --- |
| `--dry-run` | Report the plan and exit without writing. |
| `--only <name>` | Apply a single migration (substring match). |
| `--force` | Re-apply every migration, ignoring the ledger. |

### Manual fallback (psql)

If you would rather not use Node:

```bash
for f in supabase/migrations/*.sql; do
  echo "applying $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || exit 1
done
psql "$DATABASE_URL" -c "NOTIFY pgrst, 'reload schema';"
```

## Verify hydration

```bash
npm run migrate -- --dry-run
```

Then confirm in the admin console that **Tab 3 (Tim Kru)** lists all five seeded
personnel — Ray, El, Cahyo (core team) and Azrian, Fatteh (freelance) — and that
**Tab 5 (Keuangan)** shows real invoice rows instead of the
"Belum ada invoice terbit" placeholder.
