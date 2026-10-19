# Pre-existing test failures — findings and disposition

**Recorded:** 2026-10-17
**Context:** raised while executing the Phase 1 security patches.

## Summary

The database test suite had been failing or silently aborting. Two independent
defects were found; neither was caused by the security patches.

| # | Defect | Status |
|---|---|---|
| 1 | Duplicate `create type public.project_status` across two migrations aborted the whole run | **FIXED** (migrations retired, see `migrations-legacy/README.md`) |
| 2 | Test fixtures assume columns that `0001` deliberately derives | **OPEN — needs decision** |

Suite before: 15 tests, 7 pass / 8 fail (aborting early).
Suite after fix #1: **50 tests, 43 pass / 7 fail** (35 previously-masked tests now run).

## Defect 2 — detail

`tests/invoices-and-crud.test.ts` fails with:

```
error: column "dp_amount" of relation "project_invoices" does not exist
```

### Why the column is absent (intentional)

`migrations/0001_consolidated_studio_os.sql:508` documents the design:

> Balance and status are DERIVED (see `v_invoice_financial_position`).

`project_invoices` intentionally stores only `minimum_dp_pct`. The derived view
computes `paid_amount`, `balance_due`, and `derived_status` from
`invoice_payment_receipts`. `get_client_invoice_dto` correctly reads
`v_pos.derived_status`, not a stored `payment_status`.

So the **schema and RPC are coherent**; the **test fixtures are stale**, written
against the pre-consolidation schema (`202609280001_client_invoices_and_crud_extensions`).

### Evidence this is not a production bug

- No production code writes `dp_amount` / `final_balance_amount` to
  `project_invoices` (verified by grep across `src/`).
- The RPC's `payment_status` maps from `derived_status`, which resolves correctly.

### Affected tests (7)

- `Invoice Trigger: PARTIALLY_PAID_DP flips projects.is_dp_paid` — inserts `dp_amount`
- `Invoice Trigger: PAID_IN_FULL flips projects.is_fully_paid` — same
- `Zero-Leakage Invariant: get_client_invoice_dto` — expects `PAID_IN_FULL`; view yields `PARTIALLY_PAID`
- `Full User Journey` (3 subtests) — same fixture chain
- `reapplying the delivery migration preserves existing records` — references a retired migration

### Options

1. **Rewrite the fixtures** to the derived model: insert
   `invoice_payment_receipts` rows instead of `dp_amount`, and assert against
   `derived_status`. Correct, but touches 7 tests.
2. **Add compatibility columns** to `project_invoices` as generated/derived
   mirrors. Not recommended — re-denormalizes what the design deliberately
   normalized, and risks drift between stored and derived truth.
3. **Defer.** The affected feature (client invoicing) is currently exercised in
   production through the RPC, which behaves correctly.

**Recommendation:** option 1, as a separate task. It is test-only work and
should not be bundled with the security patches.
