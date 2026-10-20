# Payroll & Financial Architecture Blueprint

**Status:** proposal for review — **no implementation code written**
**Supersedes:** waterfall split (`money_splits`), `approve_money_split`
**Date:** 2026-10-20 · based on schema at `8f29452`

---

## 0. Findings that change the plan before it is approved

I audited the live schema against the brief. Six premises do not hold. Each one
changes the design, so they come first.

| # | Brief assumes | Reality | Consequence |
|---|---|---|---|
| P1 | A "Partner account" exists | **No partner entity.** Only `FOUNDER` (rank 100) and `SUPER_ADMIN`. | "95% to core Partner" must resolve to explicit **persons or equity shares**, not a role. Needs a decision (§0.1). |
| P2 | Crew fees are payable from `project_crew_assignments` | `fee_agreed` **and** mirrored `project_expenses(CREW_FEE)` rows both exist — 4 expenses mirror 4 assignments exactly (450k/500k/450k/350k). | Summing both **double-pays Rp 1,750,000**. Needs a single source of truth (§0.2). |
| P3 | Workers/editors have rates | `editor_tasks` has **no rate, no pay, no FK**; `assigned_editor_id` is bare `text`. Table is currently empty. | Internal payroll has **no data source at all**. Must be built, not migrated. |
| P4 | Freelancers can be scoped to `auth.uid()` | `crew_members.auth_user_id` exists but **all 6 rows are NULL**. | Row-scoped earnings queries return **nothing** until linked. Hard prerequisite. |
| P5 | Admin fee = `fee_agreed` | `fee_agreed` is per **assignment**, and one person can hold several across projects. | Payslip must aggregate lines, not read one column. |
| P6 | Verified revenue is available per project | Verified payments exist on 1 of 8 invoices (Rp 190,000 of Rp 20.4M contracted). | The 5% formula is mostly **theoretical** on today's data; needs a dry-run mode. |

### 0.1 Decision required: who receives the 95%?

"Core Partner account" is not representable today. Three options:

| Option | Model | Pros | Cons |
|---|---|---|---|
| **A — Explicit persons** | `partner_accounts(id, user_id, display_name, equity_bp)` with shares summing to 10000 bps | Simple, auditable, matches a 2-person studio | Fixed at company level, cannot vary per project |
| **B — Single studio account** | 95% → one `STUDIO_OPERATING` account | Simplest; no per-partner split at all | Partners draw from one pot; personal tax unclear |
| **C — Role-based** | 95% → the `FOUNDER` role | No new table | Breaks the moment there are two founders with unequal equity |

**Recommendation: A**, with `equity_bp` integers (basis points) so 50/50 is
`5000/5000` and a 60/40 is explicit — eliminating the float percentages the
current waterfall uses. Note the existing split already disagrees with itself:
`founder_a_share 6,885,125` vs `founder_b_share 3,707,375` on an 11,150,000 net
(≈65/35), not the documented 50:50.

### 0.2 Decision required: crew fee source of truth

Two candidates:

- `project_crew_assignments.fee_agreed` — the **contract with the person**
  (what was agreed, per project, per role).
- `project_expenses(category='CREW_FEE')` — the **cost ledger entry**.

They are currently mirrored by application code, with no constraint enforcing
equality. **Recommendation:** treat `fee_agreed` as the payable amount
(authoritative for payroll), treat the expense row as the *cost* view only, and
add a trigger keeping the expense row in sync. Payroll **must never** read
`project_expenses` for CREW_FEE.

---

## 1. Mathematical specification

### 1.1 The formula

```
GROSS REVENUE     R = Σ verified payment receipts on the project's invoices
DIRECT COSTS      D = Σ project_expenses  (excluding category CREW_FEE)
                    + Σ crew_assignments.fee_agreed (accepted, non-cancelled)
                    (equipment depreciation EXCLUDED — accrual, not cash)

NET PROFIT        P = R − D                       (may be negative; see §1.4)

RESERVE           V = round(P × 500 / 10000, 2)   if P > 0 else 0
DISTRIBUTABLE     X = P − V
PARTNER i         Pi = round(X × equity_bp_i / 10000, 2)
REMAINDER SHARE   P_last = X − Σ P_1..P_(n-1)     (absorbs rounding)
```

All arithmetic in Postgres `numeric(14,2)` — **never** JS floats. The existing
`waterfall.ts` rounds inputs (`999999.999 → 1,000,000`), which is unacceptable
for money.

### 1.2 Why verified receipts, not contract value

Revenue must be **cash received and verified**, not invoiced. The existing view
already gives this:

```sql
SELECT SUM(paid_amount) FROM v_invoice_financial_position WHERE project_id = p;
```

`paid_amount` filters `verified_at IS NOT NULL`, so an unverified transfer cannot
inflate a profit distribution. This closes audit finding H3/M4 from the prior
report at the source.

### 1.3 Rounding invariant

The split must satisfy, exactly:

```
V + Σ Pi = P          (or X, if V = 0)
```

Achieved by computing n−1 shares with `ROUND(...,2)` and giving the **last
partner the remainder**. Never compute all shares by rounding independently —
that produces a ±0.01 drift that will not reconcile.

### 1.4 Loss handling — flagged, never erased

Current code clamps `net_profit = max(0, …)`, hiding losses. New rule:

- `P < 0` → `status = 'LOSS'`, `reserve = 0`, no partner distribution.
- The loss is **recorded and carried**, visible on the project card.
- A loss blocks projection into the monthly payroll run.
- Optional `loss_carryforward` table to offset future profit (§6 phase 4).

### 1.5 Data flow

```
invoice_payment_receipts (verified_at NOT NULL)
        │
        ▼
v_invoice_financial_position.paid_amount
        │
        ├──────────────► R  (gross revenue, per project)
        │
project_expenses (excl CREW_FEE)  ─┐
crew_assignments.fee_agreed       ─┴──► D (direct costs, server-side only)
        │
        ▼
project_profit_snapshots   ← immutable, one row per project per settlement run
        │   gross, direct, net, reserve, distributable, status, computed_at
        ▼
compensation_line_items    ← one row per person per project
        │   kind: CREW_FEE | EDITOR_RATE | SALARY | DIVIDEND | RESERVE
        ▼
payroll_cycles → payroll_cycle_lines → payslip_records
```

---

## 2. Database schema changes

### 2.1 New tables

```sql
-- Partner equity, integer basis points (no float percentages anywhere)
CREATE TABLE partner_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL UNIQUE REFERENCES auth.users(id),
  display_name  text NOT NULL,
  equity_bp     integer NOT NULL CHECK (equity_bp BETWEEN 0 AND 10000),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Invariant: active equity must total exactly 10000 bp.
-- Enforced by deferred constraint trigger (see §2.3).

-- Immutable snapshot of one project's economics at settlement time
CREATE TABLE project_profit_snapshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  gross_revenue     numeric(14,2) NOT NULL CHECK (gross_revenue >= 0),
  direct_costs      numeric(14,2) NOT NULL CHECK (direct_costs >= 0),
  net_profit        numeric(14,2) NOT NULL,          -- may be < 0
  reserve_amount    numeric(14,2) NOT NULL DEFAULT 0 CHECK (reserve_amount >= 0),
  distributable     numeric(14,2) NOT NULL DEFAULT 0,
  status            text NOT NULL CHECK (status IN
                      ('DRAFT','FINALIZED','LOSS','SUPERSEDED')),
  computed_at       timestamptz NOT NULL DEFAULT now(),
  computed_by       uuid REFERENCES auth.users(id),
  superseded_by     uuid REFERENCES project_profit_snapshots(id),
  -- the invariant the old model lacked:
  CONSTRAINT profit_balances
    CHECK (reserve_amount + distributable = GREATEST(net_profit, 0))
);

-- Only one live snapshot per project
CREATE UNIQUE INDEX one_final_snapshot_per_project
  ON project_profit_snapshots(project_id)
  WHERE status = 'FINALIZED';

-- Every payable line item, across every stream
CREATE TABLE compensation_line_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payee_user_id    uuid REFERENCES auth.users(id),      -- internal staff
  payee_crew_id    uuid REFERENCES crew_members(id),    -- freelancer
  kind             text NOT NULL CHECK (kind IN
                     ('CREW_FEE','EDITOR_RATE','SALARY','DIVIDEND','RESERVE')),
  project_id       uuid REFERENCES projects(id),
  source_table     text NOT NULL,
  source_id        uuid NOT NULL,
  role_label       text,
  gross_amount     numeric(14,2) NOT NULL CHECK (gross_amount >= 0),
  deduction_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (deduction_amount >= 0),
  net_amount       numeric(14,2) GENERATED ALWAYS AS
                     (gross_amount - deduction_amount) STORED,
  earned_on        date NOT NULL,
  state            text NOT NULL DEFAULT 'PENDING_VERIFICATION'
                     CHECK (state IN ('PENDING_VERIFICATION','APPROVED',
                                      'READY_FOR_DISBURSEMENT','PAID','VOID')),
  payroll_cycle_id uuid REFERENCES payroll_cycles(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- exactly one payee
  CONSTRAINT one_payee CHECK (
    (payee_user_id IS NOT NULL)::int + (payee_crew_id IS NOT NULL)::int = 1
  ),
  -- idempotency: one line per (source row, kind)
  CONSTRAINT uniq_source_line UNIQUE (kind, source_id)
);

CREATE TABLE payroll_cycles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_key    text NOT NULL UNIQUE CHECK (period_key ~ '^\d{4}-\d{2}$'),
  status        text NOT NULL DEFAULT 'OPEN'
                  CHECK (status IN ('OPEN','LOCKED','DISBURSED','CLOSED')),
  opened_at     timestamptz NOT NULL DEFAULT now(),
  locked_at     timestamptz,
  disbursed_at  timestamptz,
  closed_at     timestamptz
);

CREATE TABLE payslip_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slip_number     text NOT NULL UNIQUE
                    CHECK (slip_number ~ '^PAY/\d{4}/\d{2}/[A-Z]{3}-\d{4}$'),
  payroll_cycle_id uuid NOT NULL REFERENCES payroll_cycles(id),
  payee_user_id   uuid REFERENCES auth.users(id),
  payee_crew_id   uuid REFERENCES crew_members(id),
  total_gross     numeric(14,2) NOT NULL,
  total_deduction numeric(14,2) NOT NULL DEFAULT 0,
  total_net       numeric(14,2) NOT NULL,
  verification_hash text NOT NULL,       -- HMAC over the slip JSON
  issued_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT one_payee_slip CHECK (
    (payee_user_id IS NOT NULL)::int + (payee_crew_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT uniq_slip_payee UNIQUE (payroll_cycle_id, payee_user_id, payee_crew_id)
);
```

### 2.2 Retirement of the waterfall

```sql
-- Order matters: revoke first, then drop the RPC, then archive data.
REVOKE ALL ON FUNCTION public.approve_money_split(uuid, text) FROM authenticated;
DROP FUNCTION public.approve_money_split(uuid, text);

-- Archive, do not delete: audit finding H1 showed this table was
-- self-approvable, so its rows are evidence.
ALTER TABLE public.money_splits RENAME TO money_splits_archived;
ALTER TABLE public.money_splits_archived
  ADD COLUMN archived_reason text NOT NULL DEFAULT 'v3 payroll pivot';
```

`cash_ledger` is **kept** but demoted to a bank-transaction log. Dividends are no
longer written to it directly; they become `compensation_line_items(kind='DIVIDEND')`.

### 2.3 Invariants as triggers

```sql
-- (a) Profit identity — server-computed only, client cannot supply D or R
CREATE OR REPLACE FUNCTION private.enforce_profit_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r numeric(14,2); d numeric(14,2);
BEGIN
  SELECT COALESCE(SUM(paid_amount),0) INTO r
    FROM public.v_invoice_financial_position WHERE project_id = NEW.project_id;

  SELECT COALESCE(SUM(total_cost),0) INTO d
    FROM public.project_expenses
   WHERE project_id = NEW.project_id AND category <> 'CREW_FEE';

  SELECT d + COALESCE(SUM(fee_agreed),0) INTO d
    FROM public.project_crew_assignments
   WHERE project_id = NEW.project_id AND acceptance_status = 'ACCEPTED';

  -- The caller's numbers are OVERWRITTEN, never trusted (closes audit H2)
  NEW.gross_revenue := r;
  NEW.direct_costs  := d;
  NEW.net_profit    := r - d;
  NEW.reserve_amount := CASE WHEN r - d > 0
                        THEN ROUND((r - d) * 0.05, 2) ELSE 0 END;
  NEW.distributable := (r - d) - NEW.reserve_amount;
  NEW.status        := CASE WHEN r - d < 0 THEN 'LOSS' ELSE 'FINALIZED' END;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_enforce_profit_snapshot
  BEFORE INSERT ON public.project_profit_snapshots
  FOR EACH ROW EXECUTE FUNCTION private.enforce_profit_snapshot();

-- (b) Equity sums to 10000 bp
CREATE CONSTRAINT TRIGGER trg_equity_total
  AFTER INSERT OR UPDATE ON public.partner_accounts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.assert_equity_total();

-- (c) A payslip may only exist for a LOCKED or later cycle
-- (d) line_items may not move backwards in state:
--     PENDING_VERIFICATION → APPROVED → READY → PAID, with VOID from any
CREATE TRIGGER trg_line_state_forward
  BEFORE UPDATE ON public.compensation_line_items
  FOR EACH ROW EXECUTE FUNCTION private.assert_state_forward();
```

### 2.4 The reconciliation view (master payroll hub)

```sql
CREATE VIEW v_compensation_reconciliation AS
SELECT
  c.id, c.kind, c.state, c.earned_on,
  c.gross_amount, c.deduction_amount, c.net_amount,
  COALESCE(u.email, m.email)        AS payee_email,
  COALESCE(a.display_name, m.full_name) AS payee_name,
  -- What kind of payee this is drives redaction downstream
  CASE WHEN c.kind = 'DIVIDEND' THEN 'EQUITY'
       WHEN c.payee_user_id IS NOT NULL THEN 'INTERNAL'
       ELSE 'FREELANCE' END         AS payee_type,
  p.name AS project_name, p.id AS project_id,
  c.role_label
FROM compensation_line_items c
LEFT JOIN auth.users u            ON u.id = c.payee_user_id
LEFT JOIN public.admins a         ON a.user_id = c.payee_user_id
LEFT JOIN public.crew_members m   ON m.id = c.payee_crew_id
LEFT JOIN public.projects p       ON p.id = c.project_id;

-- Column-level redaction is NOT done here. The view is granted only to
-- service_role; every consumer goes through a SECURITY DEFINER RPC that
-- decides which columns the caller may see (see §4).
```

---

## 3. UI structure

### 3.1 Master Payroll Hub — `/admin/payroll`

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Payroll · Oktober 2026                    [ Cycle: OPEN ▾ ]  [Lock]     │
├──────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐ │
│  │ Pending     │ │ Approved    │ │ Ready       │ │ Paid this month     │ │
│  │ Rp 2.575.000│ │ Rp 1.750.000│ │ Rp 0        │ │ Rp 450.000          │ │
│  │ 6 items     │ │ 4 items     │ │             │ │ 1 item              │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────┘ │
├──────────────────────────────────────────────────────────────────────────┤
│  Payee            Type       Project          Kind      Net      State   │
│  ─────────────────────────────────────────────────────────────────────── │
│  Fajar Sidik      Freelance  Wisuda 152       Crew      450.000  PAID    │
│  Rayyan Nufail    Internal   Wisuda 152       Crew      500.000  APPROVED│
│  El (Partner)     Internal   Wisuda 152       Crew      450.000  APPROVED│
│  Azrian           Freelance  tes bae          Crew      350.000  APPROVED│
│  …                                                                       │
├──────────────────────────────────────────────────────────────────────────┤
│  [✓ Select all approved]  [Mark READY]   [Generate payslips]   [Export]  │
│  ⚠ Dividends (Rp 10.592.500) hidden — FOUNDER only                       │
└──────────────────────────────────────────────────────────────────────────┘
```

**Field structure**

| Column | Source | ADMIN | FOUNDER / SUPER_ADMIN |
|---|---|---|---|
| Payee | `payee_name` | ✅ | ✅ |
| Type | `payee_type` | ✅ | ✅ |
| Project | `project_name` | ✅ | ✅ |
| Kind | `kind` | ✅ crew/editor/salary only | ✅ incl. DIVIDEND |
| Gross / Net | `net_amount` | ✅ for crew/editor | ✅ all |
| State | `state` | ✅ | ✅ |
| Dividend rows | `kind='DIVIDEND'` | ❌ **omitted, not masked** | ✅ |
| Equity % | `partner_accounts` | ❌ | ✅ |

Design rule from the earlier audit: **omit rows at the query level**, never
render-then-blur. A blurred cell still ships its value in the RSC payload.

### 3.2 Digital Payslip — `/my-earnings` (staff) and `/crew/portal` (freelancer)

```
┌───────────────────────────────────────────────────────────────┐
│  ELTS.  ·  SLIP GAJI DIGITAL                                  │
│  PAY/2026/10/CRW-0042                        [ Download PDF ] │
├───────────────────────────────────────────────────────────────┤
│  Penerima : Fajar Sidik (CRW-01)                              │
│  Periode  : 1 – 31 Oktober 2026                               │
│  Status   : PAID                                              │
├───────────────────────────────────────────────────────────────┤
│  Tanggal   Project / Kode        Peran            Jumlah       │
│  ──────────────────────────────────────────────────────────── │
│  28/09     Wisuda 152 / INV-001  Lead Switcher    450.000      │
│  12/10     Diskusi Publik        Camera Op        425.000      │
│  ──────────────────────────────────────────────────────────── │
│  Bruto                                      875.000           │
│  Potongan                                        0             │
│  ──────────────────────────────────────────────────────────── │
│  TOTAL NETO                                 875.000           │
├───────────────────────────────────────────────────────────────┤
│  Rekening : BCA 0000000000 · Fajar Sidik                      │
│                                                               │
│  [ ▣ QR ]  Verifikasi: https://elts.id/verify/PAY-…          │
└───────────────────────────────────────────────────────────────┘
```

**Fields:** `slip_number`, period, payee name + `crew_code`, one row per
`compensation_line_item` (date, project, role, amount), gross, deductions, net,
bank destination, QR encoding `slip_number` + `verification_hash`.

**QR content** must be a verification *URL*, not the amount — scanning should
open `/verify/[hash]` which resolves server-side, so the QR cannot be used to
extract financial data offline.

---

## 4. Security & RLS matrix

The load-bearing insight from the prior audit: **the app uses a service-role
client, so RLS never runs.** Therefore privacy here must be enforced by
`SECURITY DEFINER` RPCs that take **no identity parameter** — they read
`auth.uid()` themselves. Row-scoped RLS is the *second* line, not the first.

### 4.1 Who may see what

| Capability | SUPER_ADMIN | FOUNDER | ADMIN | WORKER | FREELANCER | anon |
|---|---|---|---|---|---|---|
| Own earnings (`my_earnings_summary`) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Own payslips | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Crew/editor line items (all people) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Dividend line items | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Partner equity roster | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Project profit snapshots | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Mark READY_FOR_DISBURSEMENT | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Mark PAID | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Run/lock payroll cycle | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Payslip PDF | own | own | own | own | own | ❌ |

### 4.2 The scoped RPC (the only path a worker's earnings take)

```sql
CREATE OR REPLACE FUNCTION public.my_earnings_summary()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_crew uuid;
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error','UNAUTHENTICATED');
  END IF;

  -- A person may be BOTH staff and crew; resolve both identities and union.
  SELECT id INTO v_crew FROM public.crew_members WHERE auth_user_id = v_uid;

  RETURN (
    WITH mine AS (
      SELECT c.net_amount, c.state, c.earned_on
        FROM public.compensation_line_items c
       WHERE c.payee_user_id = v_uid
          OR (v_crew IS NOT NULL AND c.payee_crew_id = v_crew)
    )
    SELECT jsonb_build_object(
      -- Awaiting disbursement: approved and ready, not yet paid
      'pending_payout', COALESCE(SUM(net_amount) FILTER (
          WHERE state IN ('APPROVED','READY_FOR_DISBURSEMENT')), 0),
      -- Settled this calendar month (Jakarta)
      'current_month_earnings', COALESCE(SUM(net_amount) FILTER (
          WHERE state = 'PAID'
            AND earned_on >= date_trunc('month', v_now AT TIME ZONE 'Asia/Jakarta')::date), 0),
      'lifetime_paid', COALESCE(SUM(net_amount) FILTER (WHERE state='PAID'), 0),
      'line_count', COUNT(*)
    )
    FROM mine
  );
END $$;

REVOKE ALL ON FUNCTION public.my_earnings_summary() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_earnings_summary() TO authenticated;
```

**Property:** the function accepts **no arguments**, so there is no parameter to
tamper with. A WORKER calling it can only ever receive their own aggregate.
There is no row-level detail — an aggregate over one person's rows cannot be used
to infer anyone else's.

### 4.3 Why aggregation is safe but listing is not

`pending_payout` is a SUM over rows the caller owns. Safe.

A list endpoint (`my_earnings_lines()`) returns detail rows — also safe *if*
scoped identically, but it must **not** include `source_id` for other payees'
rows, and must exclude `DIVIDEND` for non-founders even on their own account
(a founder's dividend appears only on `/admin/payroll`, never in `/my-earnings`).

### 4.4 RLS (defence in depth)

```sql
ALTER TABLE compensation_line_items ENABLE ROW LEVEL SECURITY;

-- Own rows only, at the table level.
CREATE POLICY cli_own_read ON compensation_line_items
  FOR SELECT TO authenticated
  USING (
    payee_user_id = (SELECT auth.uid())
    OR payee_crew_id IN (
      SELECT id FROM crew_members WHERE auth_user_id = (SELECT auth.uid())
    )
  );

-- Full access for executives only.
CREATE POLICY cli_founder_all ON compensation_line_items
  FOR ALL TO authenticated
  USING (private.has_role_rank(100))
  WITH CHECK (private.has_role_rank(100));
```

Note: two permissive policies OR together, so FOUNDER gets everything and
everyone else gets only their own. Both are bypassed by service_role — hence
§4.2 is mandatory, not optional.

---

## 5. Migration strategy

### 5.1 Ordering and reversibility

| Phase | Migration | Reversible? |
|---|---|---|
| 0 | `0012_link_crew_auth_users` — backfill `auth_user_id` | ✅ data-only |
| 1 | `0013_partner_accounts` + equity invariant | ✅ new table |
| 2 | `0014_profit_snapshots` + enforcement trigger | ✅ new table |
| 3 | `0015_compensation_line_items` + backfill from crew fees | ✅ new table |
| 4 | `0016_payroll_cycles_payslips` | ✅ new table |
| 5 | `0017_retire_waterfall` — revoke, drop RPC, rename table | ⚠️ **forward-only** |
| 6 | `0018_earnings_rpcs` + RLS policies | ✅ drop function |

Phase 5 is the only irreversible step. It must ship **after** phases 0–4 are
verified against real data, and only once `project_profit_snapshots` reproduces
the archived split for the one project that has one
(`Wisuda 152`: gross 15,000,000 / direct 3,850,000 / net 11,150,000 — confirming
the new engine yields the same figures before the old one is removed).

### 5.2 Backfill of existing crew fees

```sql
INSERT INTO compensation_line_items
  (payee_crew_id, kind, project_id, source_table, source_id,
   role_label, gross_amount, earned_on, state)
SELECT a.crew_member_id, 'CREW_FEE', a.project_id,
       'project_crew_assignments', a.id,
       a.role_title, a.fee_agreed, a.call_time::date,
       CASE a.payment_status
         WHEN 'PAID' THEN 'PAID'
         WHEN 'PARTIAL' THEN 'READY_FOR_DISBURSEMENT'
         ELSE 'PENDING_VERIFICATION'
       END
FROM project_crew_assignments a
WHERE a.acceptance_status = 'ACCEPTED'
ON CONFLICT (kind, source_id) DO NOTHING;   -- the idempotency constraint
```

Expected: **6 rows, Rp 2,575,000** (matches live `fee_agreed` total). If the row
count differs, abort — it means the double-count source (§0.2) leaked in.

### 5.3 Pre-flight checklist

- [ ] Boss decision: §0.1 partner model (A / B / C)
- [ ] Boss decision: §0.2 crew fee authority (`fee_agreed`)
- [ ] Link all 6 `crew_members.auth_user_id` (currently 0 of 6)
- [ ] Agree internal rates for WORKER/editor — **no data exists yet**
- [ ] Confirm the 5% is of *net profit* (brief) not *gross* (many studios do gross)
- [ ] Confirm loss policy: flag-only vs carry-forward (§1.4)

---

## 6. Phased roadmap

| Phase | Deliverable | Gate |
|---|---|---|
| **1** | Identity + schema (0012–0013) | Every crew member has `auth_user_id`; equity totals 10000 bp |
| **2** | Profit snapshot engine (0014) | Recomputes `Wisuda 152` to 15,000,000 / 3,850,000 / 11,150,000 exactly |
| **3** | Compensation lines + backfill (0015) | 6 rows, Rp 2,575,000; zero duplicates with `project_expenses` |
| **4** | Payroll cycles + slips (0016) | A cycle can be opened, locked, disbursed; slip numbers gap-free |
| **5** | Retire waterfall (0017) | Old data archived, RPC dropped, no route references `money_splits` |
| **6** | Earnings RPCs + KPI cards + RLS (0018) | WORKER/FREELANCER see own figures; ADMIN cannot see dividends |
| **7** | Payslip PDF + QR | HMAC verify endpoint returns the same slip JSON |
| **8** | Loss carry-forward, tax lines | — |

---

## 7. Open risks

1. **`editor_tasks` has no rate column.** Internal payroll cannot be built until
   rates are defined. This is the single largest unknown (§P3).
2. **Only 1 of 8 invoices has a verified payment.** The 5% formula will mostly
   produce zeros until billing catches up. Ship with a **dry-run mode** that
   computes without writing.
3. **Demoting `cash_ledger`** removes the only existing treasury record. Run
   both in parallel for one cycle before switching reads.
4. **Aggregate-then-list leak.** If `/my-earnings` ever shows a "team total",
   it becomes an inference oracle. The RPC in §4.2 deliberately has none.

---

## 8. Summary

The pivot is sound: replacing a float-based, self-approvable, percentage-driven
waterfall with a fixed 5% reserve and integer-basis-point partner shares removes
audit findings H1, H2, M2 and L2 in a single stroke.

The three things that must be settled **before** code is written:

1. **§0.1** — who receives the 95%.
2. **§0.2** — one source of truth for crew fees (currently double-recorded).
3. **§P3/§P4** — no internal rates exist, and no freelancer is linked to a
   login, so both the payroll hub and the per-role KPI cards have **no data to
   display** today.
