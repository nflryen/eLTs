-- ── 0034 Notification Engine Logs & Spreadsheet Backup Sync Ledger ─────────────
begin;

/*
 * 0034 — Notification Engine Logs & Master Spreadsheet Sync Ledger
 *
 * 1. public.notification_logs
 *    Tracks all outbound multi-channel notifications (WhatsApp & Email),
 *    recording target recipient, delivery status, external provider IDs,
 *    and retry attempts.
 *
 * 2. public.spreadsheet_sync_logs
 *    Tracks asynchronous, out-of-band data replication events to the Google
 *    Sheets Master Operational Ledger. Guarantees that spreadsheet syncing
 *    never blocks or compromises PostgreSQL transaction integrity.
 */

-- 1. Unified Notification Logs
create table if not exists public.notification_logs (
  id                  uuid primary key default gen_random_uuid(),
  channel             text not null check (channel in ('WHATSAPP', 'EMAIL')),
  trigger_type        text not null,
  recipient           text not null,
  subject_or_preview  text not null,
  provider            text not null,
  status              text not null default 'PENDING' check (status in ('PENDING', 'SENT', 'FAILED', 'DELIVERED')),
  project_id          uuid references public.projects(id) on delete set null,
  invoice_id          uuid references public.project_invoices(id) on delete set null,
  payload_json        jsonb not null default '{}'::jsonb,
  external_id         text,
  error_message       text,
  retry_count         integer not null default 0,
  next_retry_at       timestamptz,
  created_at          timestamptz not null default now(),
  dispatched_at       timestamptz
);

create index if not exists idx_notification_logs_status on public.notification_logs (status, next_retry_at);
create index if not exists idx_notification_logs_project on public.notification_logs (project_id);
create index if not exists idx_notification_logs_invoice on public.notification_logs (invoice_id);

-- 2. Spreadsheet Synchronization Ledger
create table if not exists public.spreadsheet_sync_logs (
  id                  uuid primary key default gen_random_uuid(),
  entity_type         text not null check (entity_type in ('PROJECT', 'INVOICE', 'PAYMENT_RECEIPT', 'PROOFING_SELECTION')),
  entity_id           uuid not null,
  action              text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  sync_target         text not null default 'GOOGLE_SHEETS',
  status              text not null default 'PENDING' check (status in ('PENDING', 'SYNCED', 'FAILED')),
  payload_snapshot    jsonb not null,
  attempts            integer not null default 0,
  last_error          text,
  synced_at           timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists idx_sync_logs_pending on public.spreadsheet_sync_logs (status, created_at) where status = 'PENDING';
create index if not exists idx_sync_logs_entity on public.spreadsheet_sync_logs (entity_type, entity_id);

-- 3. RBAC Policies
alter table public.notification_logs enable row level security;
alter table public.spreadsheet_sync_logs enable row level security;

-- Only studio operations staff (rank >= 80) can inspect logs
drop policy if exists notification_logs_ops_read on public.notification_logs;
create policy notification_logs_ops_read on public.notification_logs
  for select to authenticated
  using (private.has_role_rank(80));

drop policy if exists notification_logs_ops_write on public.notification_logs;
create policy notification_logs_ops_write on public.notification_logs
  for all to authenticated
  using (private.has_role_rank(80))
  with check (private.has_role_rank(80));

drop policy if exists spreadsheet_sync_logs_ops_read on public.spreadsheet_sync_logs;
create policy spreadsheet_sync_logs_ops_read on public.spreadsheet_sync_logs
  for select to authenticated
  using (private.has_role_rank(80));

drop policy if exists spreadsheet_sync_logs_ops_write on public.spreadsheet_sync_logs;
create policy spreadsheet_sync_logs_ops_write on public.spreadsheet_sync_logs
  for all to authenticated
  using (private.has_role_rank(80))
  with check (private.has_role_rank(80));

commit;
