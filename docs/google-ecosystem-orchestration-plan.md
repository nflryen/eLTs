# Google Ecosystem Multi-Agent Orchestration Plan: Sheets, Drive, & Calendar

> **Project:** eLTs Visual Studio OS (`elts-photography@2.2.0`)  
> **Architecture Pattern:** Sub-Agent Orchestra Pattern  
> **Master Orchestrator:** Principal Systems Orchestrator & Lead AI Architect  
> **Target Execution Window:** Production Deployment — Q4 2026 / Fiscal 2027  
> **Database Invariants:** Remote Supabase PostgreSQL (59 base tables, Migration 0034)  

---

## Executive Orchestration Topology

```mermaid
graph TD
    Master[Sub-Agent Orchestra Master Controller] --> Agent1[Sub-Agent 1: Google Sheets & Ledger Sync]
    Master --> Agent2[Sub-Agent 2: Google Drive & Shared Drives]
    Master --> Agent3[Sub-Agent 3: Google Calendar & Meet API]

    subgraph "Subsystem 1: Sheets Ledger"
        Agent1 -->|Batch Aggregation| BatchSync[Batch Sync Engine]
        Agent1 -->|Cron Reconciliation| CronRoute[/api/cron/sync-ledger]
        Agent1 -->|HMAC & Replay Protection| SecVerifier[HMAC-SHA256 Signer]
    end

    subgraph "Subsystem 2: Drive Vault"
        Agent2 -->|Hierarchy Provisioner| FolderTree[YYYY / Pillar / Slug Scaffolding]
        Agent2 -->|Isolated Subfolders| Subfolders[01_RAW / 02_Proofs / 03_Deliverables]
        Agent2 -->|Financial Gate| GateEngine[Payment Gated URL & Permission Unlock]
    end

    subgraph "Subsystem 3: Calendar & Meet"
        Agent3 -->|Shoot Day Events| CalEvents[Google Calendar Connector]
        Agent3 -->|Meet Generation| MeetEngine[Google Meet Hangouts Video API]
        Agent3 -->|Notification Feed| HybridNotify[WhatsApp & Email Dispatcher]
    end

    subgraph "Master Quality Gates"
        Master --> TestSuite[Integration Tests: 200+ Assertions]
        Master --> Typecheck[TypeScript 6.0: 0 Errors]
        Master --> Linter[ESLint 9: 0 Warnings]
        Master --> MultiTenancy[Subdomain Smoke Suite: 12/12 Checks]
    end
```

---

## Multi-Agent Phased Execution Schedule

### Phase 1: Sub-Agent 1 — Google Sheets & Sync Ledger Subsystem
- **Core Focus:** Throughput scaling, rate limit mitigation, replay protection, and resilient retry reconciliation.
- **Milestones:**
  1. **Batch Aggregation Engine (`src/lib/sync/sheets-client.ts`):**
     - Implement `dispatchSpreadsheetSyncBatch(items)` to merge multiple mutation events into a single HTTP payload (`entityType: "BATCH"`).
     - Protect Google Sheets API rate ceiling ($300\text{ req/min}$).
  2. **GAS Webhook Batch Handler (`docs/google-apps-script-sync-template.js`):**
     - Add `case "BATCH"` in Apps Script `doPost` to execute atomic batch insertions inside a single script lock.
     - Enforce `X-ELTS-TIMESTAMP` $300$-second replay window protection.
  3. **Automated Cron Reconciliation Route (`src/app/api/cron/sync-ledger/route.ts`):**
     - Vercel/Supabase cron job endpoint protected by `CRON_SECRET`.
     - Scans `public.spreadsheet_sync_logs` for `PENDING` or `FAILED` attempts ($< 3$ retries).
     - Retries with exponential backoff and random jitter.

### Phase 2: Sub-Agent 2 — Google Drive API & Workspace Shared Drive Subsystem
- **Core Focus:** Automated project directory scaffolding and payment-gated deliverable access.
- **Milestones:**
  1. **Drive Vault Provisioner (`src/lib/sync/drive-client.ts`):**
     - Automated folder tree builder: `eLTs Shared Drive / YYYY / <Service_Pillar> / <Client_Project_Slug>`.
     - Scaffolds three isolated subdirectories:
       - `01_RAW_Capture` (Photographer write-only).
       - `02_Selection_Proofs` (Watermarked proofing assets).
       - `03_Final_Deliverables` (Master color graded exports & album layouts).
  2. **Payment-Gated Permission Delegation:**
     - The `03_Final_Deliverables` link is stored in `projects.sector_specs.googleDriveUrl`.
     - Pre-payment: access restricted to studio staff.
     - Post-payment (`is_fully_paid = true` via `verifyReceipt`): permission granted or public view link activated, instantly unlocking the download button in the client portal.

### Phase 3: Sub-Agent 3 — Google Calendar & Meet API Subsystem
- **Core Focus:** Studio scheduling, conflict elimination, and consultation Meet link generation.
- **Milestones:**
  1. **Calendar Event Connector (`src/services/calendar/google.ts`):**
     - Auto-creates calendar events when shoot dates are confirmed or client discovery calls are booked.
     - Injects rich metadata into event descriptions: Client Name, Contact Phone, Venue Maps link, and direct Workspace link (`https://ops.elts.co.id/admin/projects/<id>`).
  2. **Automated Google Meet Provisioning:**
     - Requests `conferenceData.createRequest` with `hangoutsMeet` solution key.
     - Stores generated `meet_link` in `public.studio_events`.
     - Dispatches meeting link via WhatsApp and Email using our Hybrid Notification Engine.

### Phase 4: Sub-Agent Orchestra Master Controller & Quality Gates
- **Core Focus:** Cross-subsystem verification, state machine invariants, zero regression.
- **Milestones:**
  1. Comprehensive test suites covering all sync, drive, and calendar touchpoints.
  2. Strict static analysis: `npm run typecheck` (0 errors), `npm run lint` (0 warnings).
  3. Subdomain smoke tests (12/12 passing).
  4. Final deployment verification.
