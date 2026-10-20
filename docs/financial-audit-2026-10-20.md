# Financial Architecture & Audit Report

**Scope:** money movement, record keeping, and control weaknesses across invoices,
receipts, project costs, waterfall splits, treasury ledger and crew payouts.
**Version audited:** `main` @ `8f29452` (v2.2.1 + grid/inventory fixes)
**Method:** schema inspection, live-database probes, code tracing. Read-only —
no code was modified.

---

## 0. Executive summary

The **client-billing half of the system is genuinely well designed.** Invoices
are immutable contracts, payments are rows (never columns), balances are derived
from a view, and the client-facing DTO is curated to exclude cost data. Whoever
built `project_invoices` → `invoice_payment_receipts` →
`v_invoice_financial_position` understood double-entry thinking.

The **internal settlement half is where the money is uncontrolled.** The profit
split accepts `directCosts` as a number from the browser, the approval function
accepts `p_founder` as a string from the caller, and neither the database nor
the service layer recomputes anything. Combined with the fact that **every
server action uses a service-role client that bypasses RLS**, the carefully
written RLS policies never run.

Severity distribution: **3 High, 6 Medium, 5 Low.**

---

## 1. Financial data flow

### 1.1 Real tables vs. the brief

Four tables named in the audit brief **do not exist**:

| Brief name | Reality |
|---|---|
| `rab_items` | absent — RAB is `project_expenses` + `money_splits` |
| `client_payments` | absent — `invoice_payment_receipts` |
| `treasury_transactions` | absent — `cash_ledger` |
| `crew_fee_settlements` | absent — `project_crew_assignments.fee_agreed` + `payment_status` |

### 1.2 Flow diagram

```
                        ┌──────────────────────────────────────────┐
   CLIENT DEAL          │  customers                               │
                        │  projects.contract_value  ◄── DUPLICATE  │
                        └───────────────┬──────────────────────────┘
                                        │  (diverges from invoice — see M1)
                                        ▼
   INVOICE ISSUED       ┌──────────────────────────────────────────┐
                        │  project_invoices                        │
                        │  gross_contract_value  (immutable)       │
                        │  minimum_dp_pct 30%   line_items jsonb   │
                        │  is_cancelled                        │
                        └───────────────┬──────────────────────────┘
                                        │ 1:N
                                        ▼
   PAYMENT RECEIVED     ┌──────────────────────────────────────────┐
                        │  invoice_payment_receipts                │
                        │  amount, method, reference_number        │
                        │  applied_to DP|FINAL|ADDON|…             │
                        │  verified_at  ◄── the balance gate       │
                        └───────────────┬──────────────────────────┘
                                        │ trigger
                                        ▼
   DERIVED POSITION     ┌──────────────────────────────────────────┐
                        │  v_invoice_financial_position            │
                        │  paid / unverified / balance_due /       │
                        │  overpayment / derived_status            │
                        └───────────────┬──────────────────────────┘
                                        │ sync trigger
                                        ▼
                        projects.is_dp_paid / is_fully_paid

   ────────────────────── INTERNAL SETTLEMENT ──────────────────────

   COSTS                ┌───────────────┐   ┌─────────────────────┐
                        │project_expenses│   │project_crew_assign. │
                        │ CREW_FEE      │   │ fee_agreed          │
                        │ EQUIP_RENTAL  │   │ payment_status      │
                        │ DEPRECIATION  │   │ paid_at             │
                        └───────┬───────┘   └─────────────────────┘
                                │  aggregated in the BROWSER
                                ▼
   WATERFALL            ┌──────────────────────────────────────────┐
                        │  money_splits                            │
                        │  gross_revenue  ◄── caller-supplied      │
                        │  direct_costs   ◄── caller-supplied (H2) │
                        │  net_profit = max(0, gross - direct)     │
                        │  5% reserve → closer % → 50:50 founders  │
                        │  approved_by_a / approved_by_b           │
                        └───────────────┬──────────────────────────┘
                                        │ approve_money_split (H1)
                                        ▼
   TREASURY             ┌──────────────────────────────────────────┐
                        │  cash_ledger                             │
                        │  INFLOW / OUTFLOW / FOUNDER_ADVANCE      │
                        │  single-entry, mutable, no linkage       │
                        └──────────────────────────────────────────┘
```

### 1.3 Where money is computed

| Figure | Computed in | Authoritative? |
|---|---|---|
| `balance_due`, `overpayment`, status | Postgres view | **Yes** |
| `minimum_dp_required` | Postgres view (`ROUND(…,2)`) | Yes |
| `reserve_amount`, founder shares | **JS floats** (`waterfall.ts`) | Written to DB as trusted values |
| `direct_costs` | **Browser** (`rab-panel.tsx` → action) | No — never verified |
| `net_profit` | JS, clamped at 0 | No — losses erased |

---

## 2. Capabilities vs. real agency needs

| Capability | Status | Assessment |
|---|---|---|
| Immutable contract amount | ✅ | `gross_contract_value` never updated in place |
| Payment ledger as rows | ✅ | Correct — allows arbitrary DP without corrupting contract |
| Derived balance / status | ✅ | Single source of truth, verified-only |
| DP floor enforcement | ✅ | `dp_floor_satisfied`, 30% configurable |
| Receipt numbering | ✅ | Atomic, gap-free, per-period |
| Overpayment *detection* | ✅ | `overpayment_amount` computed |
| Overpayment *prevention* | ❌ | Accepted silently (M4) |
| Refunds | ❌ | No table, no action. Negative `amount` is CHECK-blocked, with no refund path |
| Partial payments | ✅ | Multiple receipts sum correctly |
| Invoice cancellation | ⚠️ | Column exists, **no action to set it** (M5) |
| DRAFT→SENT→PAID workflow | ⚠️ | No `SENT` state; status is payment-derived only |
| Vendor disbursement | ⚠️ | `vendor_purchase_orders` has face value but no payment record |
| Crew payout | ⚠️ | Status flag only, no ledger entry (M3) |
| Bank balance / petty cash | ❌ | No account table. `cash_ledger` is a single pool |
| Reconciliation | ❌ | Nothing matches bank statements to receipts |
| Founder advance repayment | ⚠️ | `FOUNDER_ADVANCE` type exists, no repayment tracking |
| Tax / PPN | ❌ | No tax lines |
| Period close / lock | ❌ | No fiscal period immutability |
| Audit trail on finance | ⚠️ | `created_by`/`verified_by` on receipts; **nothing** on `cash_ledger` or `money_splits` |

---

## 3. Findings

### 🔴 HIGH

---

**H1 — `approve_money_split` trusts a caller-supplied founder identity**

`public.approve_money_split(p_split_id uuid, p_founder text)` is `SECURITY
DEFINER`, granted to `authenticated`, and **never checks who is calling.**
`p_founder` is a free string the client chooses.

```plpgsql
IF p_founder NOT IN ('A','B') THEN RAISE EXCEPTION ...
v_new_a := CASE WHEN p_founder = 'A' THEN true ELSE v_split.approved_by_a END;
v_new_b := CASE WHEN p_founder = 'B' THEN true ELSE v_split.approved_by_b END;
```

The application layer calls `requireFounder()` first, but PostgREST exposes the
RPC directly. **Verified exploit** (inside a rolled-back transaction): a session
identifying as ADMIN, given a `PENDING_APPROVAL` split, called the RPC twice —
`'A'` then `'B'` — and the split reached `APPROVED`, which then triggers a
`RESERVE_INFLOW` row in `cash_ledger`.

The dual-signature control, which is the entire point of the waterfall, can be
satisfied by one person. Confirmed grant state:
`approve_money_split` → `auth_exec: true`, `checks caller identity? NO`.

*Fix:* resolve the founder from `auth.uid()` against
`role_assignments`/`admins`, and reject when the caller's identity does not match
the requested side. Never accept the role as a parameter.

---

**H2 — `direct_costs` is accepted from the browser and never recomputed**

`createOrUpdateSplit` reads `directCosts: Number(...)` straight off the action
input and stores `net_profit = gross - direct`. Nothing recomputes it from
`project_expenses` + accepted crew fees.

```ts
directCosts = Number(projectIdOrInput.directCosts || 0);   // admin-finance.ts
const netProfit = roundCurrency(Math.max(0, grossRevenue - directCosts));
```

`rab-panel.tsx` computes the number client-side and posts it. A modified request
that sends `directCosts: 1` on a 10,000,000 project yields a 9,999,999 net profit
and correspondingly inflated founder shares — with a valid, `APPROVED` split and
a clean audit trail.

*Fix:* recompute `direct_cost` server-side from the same aggregation the panel
displays, and ignore any client-supplied figure.

---

**H3 — Service-role client bypasses every RLS financial policy**

RLS on the finance tables is correctly written — writes require
`private.has_role_rank(100)`:

| table | write policy |
|---|---|
| `cash_ledger` | `has_role_rank(100)` |
| `invoice_payment_receipts` | `has_role_rank(100)` |
| `money_splits` | `has_role_rank(100)` |

But `requireStaff()`/`requireOps()`/`requireFounder()` all return a
`ServiceSupabaseClient`, which bypasses RLS. **The policies therefore never
execute for application traffic.** Isolation rests entirely on each action
remembering to call the right guard — and H1/M3 show two places that do not.

Direct proof: `authenticated` holds blanket `DELETE` on
`invoice_payment_receipts` (table privilege), and only the unused RLS policy
stops it.

*Fix:* keep service-role for privileged writes, but route *reads* through the
user-scoped client, and add a startup assertion that financial tables are never
reachable by a service client from a client-reachable code path.

---

### 🟠 MEDIUM

---

**M1 — Contract value exists twice and has already diverged**

`projects.contract_value` and `project_invoices.gross_contract_value` are
independent columns with no constraint linking them. Live data:

| project | `projects.contract_value` | invoice gross |
|---|---:|---:|
| Wisuda - UHB | 1,200,000 | 900,000 |
| Diskusi Publik | 0 | 150,000 |
| Diskusi Publik | 0 | 1,000 |

The waterfall uses the *project* value; the client is billed the *invoice*
value. Both can be "correct" from their own screen. 6 of 9 projects disagree.

*Fix:* make the invoice authoritative, or add a trigger asserting equality at
issue time.

**M2 — Losses are silently erased (`net_profit` clamped at 0)**

`Math.max(0, grossRevenue - directCosts)`. A 5,000,000 project costing 8,000,000
records `net_profit: 0` — the 3,000,000 loss disappears. No loss carry-forward,
no negative-margin record, and `money_splits_net_profit_check` (`>= 0`) would
reject one anyway. The studio cannot tell a break-even project from a
catastrophic one.

**M3 — Crew payouts are ADMIN-writable, unledgered**

`updateCrewPaymentStatus` is gated at `requireOps()` (rank 80), takes
`status` + `receiptUrl` from the caller, and writes `paid_at` with:
- no `cash_ledger` entry
- no approval
- no link to the `project_expenses` CREW_FEE row
- `receiptUrl` unvalidated (any string)

An ADMIN can mark a crew member PAID and then UNPAID, repeatedly, with zero
financial trace. The crew member's own portal (`payment_status`) is the only
record.

**M4 — Overpayments accepted; no refund path**

`recordPayment` checks invoice existence and `is_cancelled`, but never compares
`amount` against `balance_due`. The view *detects* overpayment
(`overpayment_amount`, `OVERPAID`), nothing *prevents* it. There is no refund
table and `amount <> 0` blocks negative entries, so an overpayment is
permanently stranded.

**M5 — `is_cancelled` cannot be set by any code path**

The column and its `CANCELLED` branch in the derived status exist; grep finds
**no action** that writes `is_cancelled = true`. Cancellation currently requires
a manual database edit — the exact kind of out-of-band change that breaks
auditability.

**M6 — Duplicate reserve inflow paths**

Two independent writers create `RESERVE_INFLOW` rows:
- `approve_money_split` (SQL, when both approvals land)
- `admin-finance.ts:224` (app fallback, when the RPC errors)

The app path is guarded by `if (rpcError)`, so a *transient* RPC failure can
produce a second reserve row alongside the SQL one. No uniqueness constraint on
`(project_id, category)` prevents it.

**M7 — Receipt verification can be self-served**

`recordPayment` writes `verified_at: verified ? nowIso : null` where `verified`
is caller-supplied, and `verified_by: admin.user_id`. The same FOUNDER records
and verifies in one call. That is acceptable for a two-person studio, but there
is no separation-of-duties option and no evidence the proof image was inspected.

---

### 🟡 LOW

**L1 — Float arithmetic for currency.** `waterfall.ts` computes in JS doubles and
rounds half-up (`Math.round((v+EPSILON)*100)/100`). Recomposition checks passed
across 5 cases, so the founder-share split is internally consistent — but
*inputs* are rounded: `999999.999` silently became `1,000,000`. Postgres
`numeric` is exact; the JS layer is not.

**L2 — `commission_pct` unvalidated at the DB.** `money_splits` has CHECKs
`>= 0` on every *amount*, but none on the *percentages*. **Verified:** the DB
accepted `commission_pct = 120` with `commission_amount = 12,000,000` on
`net_profit = 10,000,000` — distributions totalling 12.5M from 10M. The action
layer clamps 0–100; the database does not.

**L3 — `cash_ledger` is single-entry and mutable.** Columns are
`(type, category, amount, description)` — no `debit_account`/`credit_account`,
no counterparty, no running balance, no `created_by`, and **no triggers** prevent
UPDATE/DELETE. Only one row exists in production (one reserve inflow).

**L4 — No duplicate-transfer guard on receipts.** No unique index on
`reference_number`; nothing stops the same bank transfer being booked twice.
(Live data currently has 0 duplicates.)

**L5 — Studio bank accounts hardcoded in SQL.** `get_client_invoice_dto`
embeds BCA/Mandiri account numbers and holder names in the function body. A
rotation requires a migration.

---

## 4. Answers to the specific questions asked

**"Can ADMIN tamper with settlement amounts?"** — Yes, two ways. H1: ADMIN
identity can call `approve_money_split` twice to self-approve. M3: ADMIN can
mark crew fees paid/unpaid at will with no ledger entry.

**"Can ADMIN view founder-exclusive margins?"** — Not through the UI
(`/admin/finance` redirects at rank 100, verified `307`), and RLS would block
`money_splits` reads. But H3 means RLS does not run; the block is purely the
route guard.

**"Are WORKER/FREELANCER isolated from contract values?"** — Yes, and this is
the strongest part of the system. Verified: mobile navigation omits finance
routes, `/admin/projects` omits `contract_value`/`dp_amount` from the SELECT for
rank < 80, inventory valuation resolves to `NULL` below 80, and the crew portal
renders only the freelancer's own agreed fee. `anon` gets
`permission denied` on the inventory view and a `400`/`401` on invoice PDFs.

**"Latent leaks in actions/RPCs?"** — One real one: `approve_money_split`
(H1). Otherwise the curated DTOs hold up — `get_client_invoice_dto` explicitly
excludes cost categories, and the print route gates on `verified_at`.

**"Could a manual DB edit compromise auditability?"** — Yes, and it is currently
the *only* way to cancel an invoice (M5). `cash_ledger` has no immutability
triggers (L3), so any row can be silently edited.

---

## 5. Recommendations, priority-ordered

**Immediate (before the next invoice is issued)**

1. **Fix H1.** Derive the founder from `auth.uid()`; drop the `p_founder`
   parameter. Add a regression test asserting a non-founder identity cannot
   approve.
2. **Fix H2.** Recompute `direct_costs` server-side from
   `project_expenses` + accepted crew fees. Reject client-supplied values.
3. **Fix M1.** Make `project_invoices.gross_contract_value` authoritative for the
   waterfall, or add an equality trigger.

**Short term**

4. Add a DB CHECK: `reserve_amount + commission_amount + founder_a_share +
   founder_b_share <= net_profit` (closes L2 and M6 structurally).
5. Add `commission_pct BETWEEN 0 AND 100` and `reserve_pct BETWEEN 0 AND 100`.
6. Allow negative `net_profit`; record losses instead of erasing them (M2).
7. Implement invoice cancellation as an audited action with a reason and
   `cancelled_by` (M5).
8. Gate `updateCrewPaymentStatus` at FOUNDER and write a `cash_ledger` OUTFLOW on
   PAID (M3).
9. Add a soft overpayment guard with an explicit "accept overpayment" flag (M4).
10. Unique index on `(invoice_id, reference_number)` where reference is not null
    (L4).

**Structural (next iteration)**

11. **Real double-entry.** Two tables — `ledger_entries`
    `(id, entry_group, account, debit, credit, occurred_at, ref_type, ref_id)` —
    with a `SUM(debit) = SUM(credit)` per `entry_group` invariant enforced by a
    deferred constraint trigger. Single-entry `cash_ledger` cannot reconcile and
    cannot support a trial balance.
12. **Chart of accounts + account balances.** `accounts(code, name, type)`
    covering `1000 Studio Bank`, `1010 Petty Cash`, `1100 AR`, `2000 AP`,
    `2100 Founder Advance`, `4000 Revenue`, `5000 Direct Costs`, `5100 Reserve`.
13. **Auto-reconciliation.** Import bank/QRIS statements; match on
    `(amount, date ± window, reference)`; leave unmatched in a review queue.
    Today nothing checks that a receipt corresponds to a real credit.
14. **Payout slips.** Generate a signed PDF per crew/vendor payout, reusing the
    existing HMAC infrastructure, and require it before `payment_status = PAID`.
15. **Split-payment tracking.** `invoice_payment_allocations(receipt, line_item,
    amount)` so a single transfer can settle DP + addon and `applied_to`
    becomes derived rather than a single enum.
16. **Period close.** A `fiscal_periods` table with `locked_at`; write policies
    reject inserts into a closed period. This is what makes the ledger an audit
    trail rather than a mutable log.
17. **Founder advance sub-ledger.** `FOUNDER_ADVANCE` exists as a type but has
    no repayment tracking; advances currently have no way to reach zero.
18. **Tax lines.** No PPN/VAT modelling anywhere; add `tax_rate`/`tax_amount` to
    `project_invoices` if Indonesian PPN applies.

---

## 6. What is already good — do not regress it

- **Contract immutability.** `gross_contract_value` is never rewritten.
- **Payment ledger as rows.** The comment at migration line 505 is the right
  model and it is honoured in code.
- **Derived balance.** One view, verified-only filter, no shadow columns.
- **The DP-floor design.** `minimum_dp_pct` with `dp_floor_satisfied` handles a
  custom DP against a floor cleanly.
- **Curated client DTOs.** `get_client_invoice_dto` excludes cost categories;
  the crew portal shows only the worker's own fee.
- **Rank-driven payload projection.** Omitting money columns from the `SELECT`
  rather than hiding them in JSX is the correct instinct — it survives someone
  reading the RSC payload.
- **Atomic document numbering.** `next_document_number` is gap-free per period.

The upgrade path is therefore not a rewrite. The client-billing spine is sound;
what is missing is (a) server-side authority over the *inputs* to settlement,
(b) an approval function that knows who is calling, and (c) a ledger with two
sides.
