# Legacy migrations — archived, NOT executed

These 13 migrations are **superseded** by `migrations/0001_consolidated_studio_os.sql`
and must not be run.

## Why they were moved here

Both sets defined the same objects unguarded:

```sql
-- 0001_consolidated_studio_os.sql:11
create type public.project_status as enum (...);
-- 202609180001_foundation.sql:8
create type public.project_status as enum (...);
```

The test harness (`tests/*.test.ts`) loads every `*.sql` in `migrations/` in
filename order and applies them to an in-memory PGlite instance. Because `0001`
sorts before `202609180001`, the type was created twice and the suite failed with:

```
type "project_status" already exists   (typecmds.c:1213, routine: DefineEnum)
```

That failure aborted the whole migration run, so **8 of 15 database tests had been
failing for reasons unrelated to application code** — masking any real regression.

## Current state

`migrations/0001_consolidated_studio_os.sql` is the single source of truth. Its own
header states it "supersedes and replaces all 13 incremental migrations" and that it
is idempotent and additive.

## If you need one of these files

Do **not** copy it back into `migrations/`. Instead:

1. Confirm the statement is genuinely absent from `0001`.
2. Add it to `0001` guarded (`DROP ... IF EXISTS` + `CREATE`, or
   `CREATE TABLE IF NOT EXISTS`, or `CREATE OR REPLACE FUNCTION`).
3. Re-run `npm test` — the suite applies the real SQL, so a duplicate will fail loudly.
