-- ============================================================================
-- ELTS STUDIO OS — CREW TOKEN LIFECYCLE
-- Migration: 0008_crew_token_lifecycle
-- ============================================================================
-- Resolves audit findings B5/B6 on the freelancer portal.
--
-- B5  The portal page held a raw service-role fallback query that rebuilt the
--     crew payload by hand, bypassing the audited `get_crew_hub_payload` DTO.
--     A second field added to the table would silently appear there with no
--     review. That fallback is deleted in application code; this migration
--     makes the RPC the only way to read the payload.
--
-- B6  `check_in_at` was written by a server action taking a bare assignment id
--     and the service-role client — no token, no session. Anyone holding an
--     assignment UUID could mark a crew member present. Check-in now goes
--     through this token-authenticated function.
--
-- Also: `offer_expires_at` existed as a column nothing ever read, so a crew
-- offer stayed actionable forever.

begin;

-- ── 1. Expiry is enforced at read time ──────────────────────────────────────
-- An offer past its deadline resolves as EXPIRED. The status column is the
-- record of what the crew member did; expiry is derived, so re-extending an
-- offer (moving the deadline forward) revives it without a status repair.
create or replace function private.crew_offer_state(
  p_status      text,
  p_expires_at  timestamptz
) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_status in ('ACCEPTED', 'DECLINED') then p_status
    when p_expires_at is not null and p_expires_at <= now() then 'EXPIRED'
    else 'PENDING_OFFER'
  end;
$$;

create or replace function public.get_crew_hub_payload(p_magic_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_assignment public.project_crew_assignments%rowtype;
  v_crew   record;
  v_project record;
  v_state  text;
begin
  select * into v_assignment
    from public.project_crew_assignments
   where magic_token = p_magic_token;

  if not found then
    return jsonb_build_object('error', 'INVALID_TOKEN',
      'message', 'Tautan kru tidak ditemukan atau telah kedaluwarsa.');
  end if;

  -- A revoked token is treated exactly like an unknown one: no hint that it
  -- once existed.
  if v_assignment.revoked_at is not null then
    return jsonb_build_object('error', 'INVALID_TOKEN',
      'message', 'Tautan kru tidak ditemukan atau telah kedaluwarsa.');
  end if;

  select full_name, crew_code, phone, bank_name, bank_account_number, bank_account_holder
    into v_crew from public.crew_members where id = v_assignment.crew_member_id;

  -- Strict zero-leakage: NO contract_value, NO expenses, NO margins.
  select id, name, slug, photography_type, service_pillar, shoot_date
    into v_project from public.projects where id = v_assignment.project_id;

  v_state := private.crew_offer_state(v_assignment.acceptance_status, v_assignment.offer_expires_at);

  return jsonb_build_object(
    'assignment_id', v_assignment.id,
    'project_id', v_assignment.project_id,
    'role_title', v_assignment.role_title,
    'call_time', v_assignment.call_time,
    'roll_time', v_assignment.roll_time,
    'venue_name', v_assignment.venue_name,
    'venue_address', v_assignment.venue_address,
    'venue_maps_url', v_assignment.venue_maps_url,
    'dress_code', v_assignment.dress_code,
    'technical_notes', v_assignment.technical_notes,
    'allocated_equipment', to_jsonb(coalesce(v_assignment.allocated_equipment, '{}'::text[])),
    'fee_agreed', v_assignment.fee_agreed,
    'payment_status', v_assignment.payment_status,
    'paid_at', v_assignment.paid_at,
    'payment_receipt_url', v_assignment.payment_receipt_url,
    'check_in_at', v_assignment.check_in_at,
    'acceptance_status', v_state,
    'offer_expires_at', v_assignment.offer_expires_at,
    'accepted_at', v_assignment.accepted_at,
    'declined_at', v_assignment.declined_at,
    'declined_reason', v_assignment.declined_reason,
    'crew_member', jsonb_build_object(
      'full_name', v_crew.full_name,
      'crew_code', v_crew.crew_code,
      'phone', v_crew.phone,
      'bank_name', v_crew.bank_name,
      'bank_account_number', v_crew.bank_account_number,
      'bank_account_holder', v_crew.bank_account_holder
    ),
    'project', jsonb_build_object(
      'name', v_project.name,
      'slug', v_project.slug,
      'photography_type', v_project.photography_type,
      'service_pillar', v_project.service_pillar,
      'shoot_date', v_project.shoot_date
    )
  );
end $$;

revoke all on function public.get_crew_hub_payload(text) from public;
grant execute on function public.get_crew_hub_payload(text) to anon, authenticated, service_role;

-- ── 2. Accept/decline is single-use and expiry-aware ────────────────────────
create or replace function public.respond_crew_assignment_offer(
  p_magic_token     text,
  p_accept          boolean,
  p_declined_reason text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row   public.project_crew_assignments%rowtype;
  v_state text;
  v_now   timestamptz := now();
begin
  select * into v_row
    from public.project_crew_assignments
   where magic_token = p_magic_token
     for update;                    -- serialise concurrent taps from one link

  if not found or v_row.revoked_at is not null then
    return jsonb_build_object('success', false, 'error', 'INVALID_TOKEN',
      'message', 'Tautan penugasan tidak valid atau sudah dicabut.');
  end if;

  v_state := private.crew_offer_state(v_row.acceptance_status, v_row.offer_expires_at);

  if v_state = 'EXPIRED' then
    return jsonb_build_object('success', false, 'error', 'OFFER_EXPIRED',
      'status', 'EXPIRED',
      'message', 'Tawaran tugas ini sudah kedaluwarsa. Hubungi Production Manager.');
  end if;

  /*
   * SINGLE-USE. Once the crew member has answered, the link is a receipt, not
   * a form. Re-submitting used to flip ACCEPTED to DECLINED (and back),
   * silently changing who is on the call sheet after the schedule was locked.
   * A deliberate reversal is an admin operation, not something a stale tab
   * can do by replaying a POST.
   */
  if v_state in ('ACCEPTED', 'DECLINED') then
    return jsonb_build_object('success', false, 'error',
      'ALREADY_RESPONDED', 'status', v_state,
      'message', case v_state
        when 'ACCEPTED' then 'Tugas ini sudah Anda terima.'
        else 'Tugas ini sudah Anda tolak.'
      end);
  end if;

  if p_accept then
    update public.project_crew_assignments
       set acceptance_status = 'ACCEPTED',
           accepted_at = v_now,
           declined_at = null,
           declined_reason = null,
           updated_at = v_now
     where id = v_row.id;
    return jsonb_build_object('success', true, 'status', 'ACCEPTED',
      'message', 'Terima kasih. Anda tercatat hadir untuk produksi ini.');
  end if;

  update public.project_crew_assignments
     set acceptance_status = 'DECLINED',
         declined_at = v_now,
         declined_reason = nullif(btrim(p_declined_reason), ''),
         updated_at = v_now
   where id = v_row.id;

  return jsonb_build_object('success', true, 'status', 'DECLINED',
    'message', 'Penolakan tercatat. Production Manager akan menghubungi Anda.');
end $$;

revoke all on function public.respond_crew_assignment_offer(text, boolean, text) from public;
grant execute on function public.respond_crew_assignment_offer(text, boolean, text)
  to anon, authenticated, service_role;

-- ── 3. Check-in is token-authenticated, idempotent, deadline-aware ──────────
/*
 * The old path took an assignment UUID from the browser. The UUID appears in
 * admin URLs and attention-queue links, so it is not a secret — anyone who
 * had seen one could mark that crew member present. The token is the only
 * credential a crew member holds, so it is the only thing that may authorise
 * the write.
 *
 * Idempotent: a second tap returns the first timestamp instead of overwriting
 * it. Field crews lose signal and re-tap; an overwrite would corrupt the
 * arrival record the call sheet is reconciled against.
 */
create or replace function public.crew_check_in(p_magic_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.project_crew_assignments%rowtype;
  v_now timestamptz := now();
begin
  select * into v_row
    from public.project_crew_assignments
   where magic_token = p_magic_token
     for update;

  if not found or v_row.revoked_at is not null then
    return jsonb_build_object('success', false, 'error', 'INVALID_TOKEN',
      'message', 'Tautan penugasan tidak valid.');
  end if;

  if private.crew_offer_state(v_row.acceptance_status, v_row.offer_expires_at) <> 'ACCEPTED' then
    return jsonb_build_object('success', false, 'error', 'NOT_ACCEPTED',
      'message', 'Terima tugas terlebih dahulu sebelum melakukan check-in.');
  end if;

  if v_row.check_in_at is not null then
    return jsonb_build_object('success', true, 'already_checked_in', true,
      'check_in_at', v_row.check_in_at,
      'message', 'Anda sudah tercatat tiba.');
  end if;

  update public.project_crew_assignments
     set check_in_at = v_now, updated_at = v_now
   where id = v_row.id;

  return jsonb_build_object('success', true, 'already_checked_in', false,
    'check_in_at', v_now, 'message', 'Kehadiran Anda tercatat.');
end $$;

revoke all on function public.crew_check_in(text) from public;
grant execute on function public.crew_check_in(text) to anon, authenticated, service_role;

-- ── 4. Backfill: offers already past their deadline become EXPIRED ──────────
update public.project_crew_assignments
   set acceptance_status = 'EXPIRED', updated_at = now()
 where acceptance_status = 'PENDING_OFFER'
   and offer_expires_at is not null
   and offer_expires_at <= now();

commit;
