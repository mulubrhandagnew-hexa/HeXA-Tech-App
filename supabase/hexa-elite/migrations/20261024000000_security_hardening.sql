-- =============================================================================
-- HeXA ELITE (Supabase project lwgxmtelkeegrkgdcpop) — security hardening
-- 2026-10-24
--
-- Closes privilege-escalation and payment-tampering paths found in the audit:
--   * anyone could sign up as admin (handle_new_user trusted user metadata)
--   * any signed-in user could edit their own role / verified badge /
--     subscription tier, and hosts their listing's verified / featured /
--     rating fields
--   * admin RPCs (approve/reject host verification) had no admin check and were
--     callable anonymously
--   * escrow-release / refund RPCs trusted a caller-supplied user id
--   * host_documents had an UPDATE policy of `true` (anyone edits any document)
--   * reviews could be inserted without a completed booking
--   * hosts could write their own payout ledger / earnings rows and activate
--     featured placements without paying
--
-- Approach: guard triggers silently keep the old value of privileged columns
-- when the caller is a regular user, so existing app screens keep working.
-- Trusted callers (admins, service_role edge functions, internal triggers and
-- the SECURITY DEFINER functions below) are unaffected.
--
-- Rollback: original function bodies and dropped policies are copied into the
-- audit_backup schema before anything changes.
-- =============================================================================

-- 0. Backups -------------------------------------------------------------------
create schema if not exists audit_backup;
revoke all on schema audit_backup from public, anon, authenticated;

create table if not exists audit_backup.function_defs_20261024 as
  select p.proname::text as proname, pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef;

create table if not exists audit_backup.policies_20261024 as
  select * from pg_policies
  where schemaname = 'public'
    and (tablename, policyname) in (
      ('host_documents', 'admin_update_documents'),
      ('reviews', 'guests_can_insert_own_reviews'),
      ('reviews', 'guests_manage_own_reviews_ins'),
      ('user_subscriptions', 'admin_manage_all_subscriptions_sel'),
      ('user_subscriptions', 'admin_manage_all_subscriptions_ins'),
      ('user_subscriptions', 'admin_manage_all_subscriptions_upd'),
      ('user_subscriptions', 'admin_manage_all_subscriptions_del'),
      ('payout_ledger', 'host_own_payouts'),
      ('payout_ledger', 'admin_full_access_payout_ledger_ins'),
      ('payout_ledger', 'admin_full_access_payout_ledger_upd'),
      ('payout_ledger', 'admin_full_access_payout_ledger_del'),
      ('earnings', 'hosts_manage_own_earnings_ins'),
      ('earnings', 'hosts_manage_own_earnings_upd'),
      ('earnings', 'hosts_manage_own_earnings_del'),
      ('earnings', 'admin_full_access_earnings_ins'),
      ('earnings', 'admin_full_access_earnings_upd'),
      ('earnings', 'admin_full_access_earnings_del')
    );

-- 1. Trusted-caller helper ----------------------------------------------------
-- Trusted = admin user, service_role (edge functions), no request context
-- (SQL editor, auth signup trigger), or a SECURITY DEFINER function below that
-- has already authorised the caller and set hexa.trusted for this transaction.
-- set_config lives in pg_catalog, which PostgREST does not expose, so clients
-- cannot set the flag themselves.
create or replace function public.is_trusted_caller()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(current_setting('hexa.trusted', true), '') = 'on'
      or coalesce(auth.role(), 'service_role') = 'service_role'
      or public.is_admin_user();
$$;
revoke execute on function public.is_trusted_caller() from public, anon, authenticated;

create or replace function public.require_admin()
returns void
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not (coalesce(auth.role(), 'service_role') = 'service_role' or public.is_admin_user()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.require_admin() from public, anon, authenticated;

-- 2. Signup can no longer self-assign admin ------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare
  v_role text;
  v_canonical_role public.hexaelite_role;
begin
  -- raw_user_meta_data is supplied by the client at signup, so it may only
  -- choose between guest and host. Admins are promoted by an existing admin.
  v_role := lower(trim(coalesce(new.raw_user_meta_data->>'role', 'guest')));

  case v_role
    when 'host'     then v_canonical_role := 'host'::public.hexaelite_role;
    when 'provider' then v_canonical_role := 'host'::public.hexaelite_role;
    else                 v_canonical_role := 'guest'::public.hexaelite_role;
  end case;

  insert into public.user_profiles (id, email, full_name, role, avatar_url, city)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    v_canonical_role,
    coalesce(new.raw_user_meta_data->>'avatar_url', ''),
    coalesce(new.raw_user_meta_data->>'city', '')
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.user_profiles.full_name),
    updated_at = current_timestamp;

  return new;
end;
$function$;

-- 3. Guard triggers ------------------------------------------------------------
-- Named aaa_* so they run before the existing BEFORE triggers (e.g.
-- trg_set_auto_release), which may then legitimately set guarded columns.
-- pg_trigger_depth() > 1 means the write comes from another trigger
-- (e.g. update_listing_rating), which is internal and trusted.

create or replace function public.guard_user_profiles()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if pg_trigger_depth() > 1 or public.is_trusted_caller() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role::text not in ('guest', 'host') then new.role := 'guest'; end if;
    new.is_verified := false;
    new.subscription_tier := 'free';
    new.subscription_expires_at := null;
    new.stripe_connect_onboarding_complete := false;
    new.stripe_connect_charges_enabled := false;
    new.stripe_connect_payouts_enabled := false;
    if new.government_id_status in ('approved', 'verified') then
      new.government_id_status := 'pending';
    end if;
  else
    if new.role is distinct from old.role and new.role::text not in ('guest', 'host') then
      new.role := old.role;
    end if;
    new.is_verified := old.is_verified;
    new.subscription_tier := old.subscription_tier;
    new.subscription_expires_at := old.subscription_expires_at;
    new.stripe_connect_onboarding_complete := old.stripe_connect_onboarding_complete;
    new.stripe_connect_charges_enabled := old.stripe_connect_charges_enabled;
    new.stripe_connect_payouts_enabled := old.stripe_connect_payouts_enabled;
    if new.government_id_status is distinct from old.government_id_status
       and new.government_id_status in ('approved', 'verified') then
      new.government_id_status := old.government_id_status;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists aaa_guard_user_profiles on public.user_profiles;
create trigger aaa_guard_user_profiles
  before insert or update on public.user_profiles
  for each row execute function public.guard_user_profiles();

create or replace function public.guard_listings()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if pg_trigger_depth() > 1 or public.is_trusted_caller() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.is_verified := false;
    new.verification_status := 'unverified';
    new.verified_at := null;
    new.is_featured := false;
    new.featured_until := null;
    new.featured_placement := 0;
    new.rating := 0;
    new.review_count := 0;
    new.completed_bookings := 0;
    new.commission_rate_override := null;
    new.is_high_volume_host := false;
  else
    new.is_verified := old.is_verified;
    new.verification_status := old.verification_status;
    new.verification_notes := old.verification_notes;
    new.verified_at := old.verified_at;
    new.is_featured := old.is_featured;
    new.featured_until := old.featured_until;
    new.featured_placement := old.featured_placement;
    new.rating := old.rating;
    new.review_count := old.review_count;
    new.completed_bookings := old.completed_bookings;
    new.commission_rate_override := old.commission_rate_override;
    new.is_high_volume_host := old.is_high_volume_host;
  end if;
  return new;
end;
$$;

drop trigger if exists aaa_guard_listings on public.listings;
create trigger aaa_guard_listings
  before insert or update on public.listings
  for each row execute function public.guard_listings();

create or replace function public.guard_bookings()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if pg_trigger_depth() > 1 or public.is_trusted_caller() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Paid bookings are created by the create-payment-intent edge function
    -- (service_role). A client-side insert is only ever an unpaid request.
    new.booking_status := 'pending';
    new.payment_intent_id := null;
    new.payment_status := 'pending';
    new.stripe_charge_id := null;
    new.escrow_status := 'held';
    new.commission_rate := 0.18;
    new.commission_amount := 0;
    new.provider_payout_amount := 0;
    new.host_payout := 0;
    new.refund_amount := 0;
    new.refund_status := null;
    new.auto_release_at := null;
    new.auto_released := false;
    new.completed_at := null;
  else
    -- Money, payment and escrow state is owned by edge functions / RPCs.
    new.payment_intent_id := old.payment_intent_id;
    new.payment_status := old.payment_status;
    new.stripe_charge_id := old.stripe_charge_id;
    new.escrow_status := old.escrow_status;
    new.base_amount := old.base_amount;
    new.service_fee := old.service_fee;
    new.platform_fee := old.platform_fee;
    new.total_amount := old.total_amount;
    new.booking_total := old.booking_total;
    new.rush_fee := old.rush_fee;
    new.commission_rate := old.commission_rate;
    new.commission_amount := old.commission_amount;
    new.provider_payout_amount := old.provider_payout_amount;
    new.host_payout := old.host_payout;
    new.refund_amount := old.refund_amount;
    new.refund_status := old.refund_status;
    new.auto_release_at := old.auto_release_at;
    new.auto_released := old.auto_released;
    new.completed_at := old.completed_at;
    new.guest_id := old.guest_id;
    new.host_id := old.host_id;

    if new.booking_status is distinct from old.booking_status then
      -- Completion / refund go through release-escrow and the refund RPC.
      if new.booking_status::text in ('completed', 'refunded') then
        new.booking_status := old.booking_status;
      -- Only the host may accept a booking.
      elsif new.booking_status::text = 'confirmed' and auth.uid() is distinct from old.host_id then
        new.booking_status := old.booking_status;
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists aaa_guard_bookings on public.bookings;
create trigger aaa_guard_bookings
  before insert or update on public.bookings
  for each row execute function public.guard_bookings();

create or replace function public.guard_host_documents()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if pg_trigger_depth() > 1 or public.is_trusted_caller() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.admin_notes := '';
  else
    if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
      new.status := old.status;
    end if;
    new.reviewed_at := old.reviewed_at;
    new.reviewed_by := old.reviewed_by;
    new.admin_notes := old.admin_notes;
  end if;
  return new;
end;
$$;

drop trigger if exists aaa_guard_host_documents on public.host_documents;
create trigger aaa_guard_host_documents
  before insert or update on public.host_documents
  for each row execute function public.guard_host_documents();

create or replace function public.guard_provider_onboarding()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if pg_trigger_depth() > 1 or public.is_trusted_caller() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.stripe_identity_status := 'not_started';
    new.stripe_identity_verification_id := null;
    if new.government_id_status in ('approved', 'verified') then
      new.government_id_status := 'pending';
    end if;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.admin_notes := '';
  else
    new.stripe_identity_status := old.stripe_identity_status;
    new.stripe_identity_verification_id := old.stripe_identity_verification_id;
    if new.government_id_status is distinct from old.government_id_status
       and new.government_id_status in ('approved', 'verified') then
      new.government_id_status := old.government_id_status;
    end if;
    new.reviewed_at := old.reviewed_at;
    new.reviewed_by := old.reviewed_by;
    new.admin_notes := old.admin_notes;
  end if;
  return new;
end;
$$;

drop trigger if exists aaa_guard_provider_onboarding on public.provider_onboarding;
create trigger aaa_guard_provider_onboarding
  before insert or update on public.provider_onboarding
  for each row execute function public.guard_provider_onboarding();

create or replace function public.guard_featured_placements()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if pg_trigger_depth() > 1 or public.is_trusted_caller() then
    return new;
  end if;

  -- Featured placement is a paid product: hosts may create a pending request,
  -- activation happens server-side after payment.
  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.is_active := false;
    new.amount_paid := 0;
    new.stripe_payment_intent_id := null;
    new.stripe_subscription_id := null;
  else
    new.status := old.status;
    new.is_active := old.is_active;
    new.amount_paid := old.amount_paid;
    new.starts_at := old.starts_at;
    new.ends_at := old.ends_at;
    new.featured_from := old.featured_from;
    new.featured_until := old.featured_until;
    new.subscription_tier := old.subscription_tier;
    new.monthly_fee := old.monthly_fee;
    new.stripe_payment_intent_id := old.stripe_payment_intent_id;
    new.stripe_subscription_id := old.stripe_subscription_id;
  end if;
  return new;
end;
$$;

drop trigger if exists aaa_guard_featured_placements on public.featured_placements;
create trigger aaa_guard_featured_placements
  before insert or update on public.featured_placements
  for each row execute function public.guard_featured_placements();

create or replace function public.guard_user_subscriptions()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if pg_trigger_depth() > 1 or public.is_trusted_caller() then
    return new;
  end if;

  -- Paid tiers are activated by confirm-subscription / stripe-webhook.
  if tg_op = 'INSERT' then
    if new.tier_name <> 'free' then
      new.status := 'pending';
    end if;
    new.payment_intent_id := null;
  else
    new.tier_name := old.tier_name;
    new.amount := old.amount;
    new.payment_intent_id := old.payment_intent_id;
    new.stripe_customer_id := old.stripe_customer_id;
    new.starts_at := old.starts_at;
    new.expires_at := old.expires_at;
    new.user_id := old.user_id;
    -- users may cancel, but not (re)activate
    if new.status is distinct from old.status and new.status = 'active' then
      new.status := old.status;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists aaa_guard_user_subscriptions on public.user_subscriptions;
create trigger aaa_guard_user_subscriptions
  before insert or update on public.user_subscriptions
  for each row execute function public.guard_user_subscriptions();

revoke execute on function
  public.guard_user_profiles(), public.guard_listings(), public.guard_bookings(),
  public.guard_host_documents(), public.guard_provider_onboarding(),
  public.guard_featured_placements(), public.guard_user_subscriptions()
from public, anon, authenticated;

-- 4. Admin-only RPCs -------------------------------------------------------------
create or replace function public.approve_host_document(p_document_id uuid, p_admin_notes text default ''::text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare
  v_host_id uuid;
  v_is_fully_verified boolean;
begin
  perform public.require_admin();
  perform set_config('hexa.trusted', 'on', true);

  select host_id into v_host_id from public.host_documents where id = p_document_id;

  update public.host_documents
  set status = 'approved',
      admin_notes = p_admin_notes,
      reviewed_at = current_timestamp,
      reviewed_by = auth.uid(),
      updated_at = current_timestamp
  where id = p_document_id;

  select is_fully_verified into v_is_fully_verified
  from public.get_host_verification_summary(v_host_id);

  if v_is_fully_verified then
    update public.user_profiles
    set is_verified = true, updated_at = current_timestamp
    where id = v_host_id;

    update public.listings
    set is_verified = true,
        verification_status = 'verified',
        verified_at = current_timestamp,
        updated_at = current_timestamp
    where host_id = v_host_id;

    update public.provider_onboarding
    set government_id_status = 'approved',
        reviewed_at = current_timestamp,
        reviewed_by = auth.uid(),
        updated_at = current_timestamp
    where host_id = v_host_id;
  end if;
end;
$function$;

create or replace function public.reject_host_document(p_document_id uuid, p_admin_notes text default ''::text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare
  v_host_id uuid;
begin
  perform public.require_admin();
  perform set_config('hexa.trusted', 'on', true);

  select host_id into v_host_id from public.host_documents where id = p_document_id;

  update public.host_documents
  set status = 'rejected',
      admin_notes = p_admin_notes,
      reviewed_at = current_timestamp,
      reviewed_by = auth.uid(),
      updated_at = current_timestamp
  where id = p_document_id;

  update public.user_profiles
  set is_verified = false, updated_at = current_timestamp
  where id = v_host_id;

  update public.listings
  set is_verified = false,
      verification_status = 'rejected',
      updated_at = current_timestamp
  where host_id = v_host_id;
end;
$function$;

create or replace function public.approve_provider_verification(p_host_id uuid, p_notes text default ''::text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $function$
begin
  perform public.require_admin();
  perform set_config('hexa.trusted', 'on', true);

  update public.provider_onboarding
  set government_id_status = 'approved',
      reviewed_at = current_timestamp,
      reviewed_by = auth.uid(),
      admin_notes = p_notes,
      updated_at = current_timestamp
  where host_id = p_host_id;

  update public.listings
  set is_verified = true,
      verification_status = 'verified',
      verification_notes = p_notes,
      verified_at = current_timestamp,
      updated_at = current_timestamp
  where host_id = p_host_id;

  update public.user_profiles
  set is_verified = true, updated_at = current_timestamp
  where id = p_host_id;
end;
$function$;

create or replace function public.reject_provider_verification(p_host_id uuid, p_notes text default ''::text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $function$
begin
  perform public.require_admin();
  perform set_config('hexa.trusted', 'on', true);

  update public.provider_onboarding
  set government_id_status = 'rejected',
      reviewed_at = current_timestamp,
      reviewed_by = auth.uid(),
      admin_notes = p_notes,
      updated_at = current_timestamp
  where host_id = p_host_id;

  update public.listings
  set is_verified = false,
      verification_status = 'rejected',
      verification_notes = p_notes,
      updated_at = current_timestamp
  where host_id = p_host_id;

  update public.user_profiles
  set is_verified = false, updated_at = current_timestamp
  where id = p_host_id;
end;
$function$;

-- Featured placement is paid: only admins / server code may activate it.
create or replace function public.activate_featured_placement(p_listing_id uuid, p_duration_days integer default 7, p_amount_paid numeric default 49.99)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare
  v_host_id uuid;
  v_ends_at timestamptz;
  v_placement_id uuid;
begin
  perform public.require_admin();
  perform set_config('hexa.trusted', 'on', true);

  select host_id into v_host_id from public.listings where id = p_listing_id;
  if v_host_id is null then
    raise exception 'Listing not found';
  end if;

  v_ends_at := now() + (p_duration_days || ' days')::interval;

  insert into public.featured_placements (host_id, listing_id, amount_paid, duration_days, ends_at, status)
  values (v_host_id, p_listing_id, p_amount_paid, p_duration_days, v_ends_at, 'active')
  returning id into v_placement_id;

  update public.listings
  set is_featured = true,
      featured_until = v_ends_at,
      featured_placement = 100,
      updated_at = now()
  where id = p_listing_id;

  return v_placement_id;
end;
$function$;

-- 5. RPCs bound to the caller's identity ---------------------------------------
create or replace function public.complete_booking_and_release_escrow(p_booking_id uuid, p_host_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare
  v_booking record;
  v_commission_calc jsonb;
  v_commission_rate numeric(5,4);
  v_commission_amount numeric(10,2);
  v_net_payout numeric(10,2);
  v_booking_total numeric(10,2);
  v_payout_id uuid;
begin
  -- The caller must be the host named in the request (or an admin / server).
  if not (coalesce(auth.role(), 'service_role') = 'service_role'
          or public.is_admin_user()
          or auth.uid() = p_host_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform set_config('hexa.trusted', 'on', true);

  select * into v_booking
  from public.bookings
  where id = p_booking_id and host_id = p_host_id
  limit 1;

  if v_booking is null then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  if v_booking.booking_status = 'completed' then
    return jsonb_build_object('success', false, 'error', 'Booking already completed');
  end if;

  v_booking_total := case
    when v_booking.booking_total > 0 then v_booking.booking_total
    else v_booking.total_amount
  end;

  v_commission_calc := public.calculate_booking_commission(
    v_booking_total, p_host_id, v_booking.listing_id::uuid
  );

  v_commission_rate := (v_commission_calc->>'commission_rate')::numeric;
  v_commission_amount := (v_commission_calc->>'commission_amount')::numeric;
  v_net_payout := (v_commission_calc->>'host_payout')::numeric;

  update public.bookings set
    booking_status = 'completed',
    escrow_status = 'released',
    booking_total = v_booking_total,
    commission_rate = v_commission_rate,
    commission_amount = v_commission_amount,
    provider_payout_amount = v_net_payout,
    host_payout = v_net_payout,
    completed_at = now(),
    updated_at = now()
  where id = p_booking_id;

  insert into public.provider_payouts (
    host_id, booking_id, gross_amount, commission_rate,
    commission_amount, net_payout, payout_status
  ) values (
    p_host_id, p_booking_id, v_booking_total, v_commission_rate,
    v_commission_amount, v_net_payout, 'pending'
  )
  returning id into v_payout_id;

  return jsonb_build_object(
    'success', true,
    'payout_id', v_payout_id,
    'booking_total', v_booking_total,
    'commission_rate', v_commission_rate,
    'commission_amount', v_commission_amount,
    'host_payout', v_net_payout
  );
end;
$function$;

create or replace function public.cancel_booking_with_refund(p_booking_id uuid, p_user_id uuid, p_reason text default ''::text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare
  v_booking record;
  v_policy record;
  v_hours_until_booking numeric;
  v_refund_pct numeric(5,2) := 0;
  v_refund_amount numeric(10,2) := 0;
begin
  -- The caller must be the guest or host named in the request (or admin / server).
  if not (coalesce(auth.role(), 'service_role') = 'service_role'
          or public.is_admin_user()
          or auth.uid() = p_user_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform set_config('hexa.trusted', 'on', true);

  select * into v_booking
  from public.bookings
  where id = p_booking_id
    and (guest_id = p_user_id or host_id = p_user_id)
  limit 1;

  if v_booking is null then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  if v_booking.booking_status in ('completed', 'cancelled') then
    return jsonb_build_object('success', false, 'error', 'Booking cannot be cancelled');
  end if;

  select * into v_policy
  from public.cancellation_policies
  where host_id = v_booking.host_id
  limit 1;

  v_hours_until_booking := extract(epoch from (
    (v_booking.booking_date::timestamptz) - now()
  )) / 3600.0;

  if v_policy is not null then
    if v_hours_until_booking >= v_policy.refund_window_hours then
      v_refund_pct := v_policy.refund_percentage;
    else
      v_refund_pct := 0;
    end if;
  else
    if v_hours_until_booking >= 24 then
      v_refund_pct := 100;
    else
      v_refund_pct := 0;
    end if;
  end if;

  v_refund_amount := round(v_booking.total_amount * (v_refund_pct / 100.0), 2);

  update public.bookings set
    booking_status = 'cancelled',
    escrow_status = case when v_refund_amount > 0 then 'refunded' else 'held' end,
    cancelled_at = now(),
    cancellation_reason = p_reason,
    refund_amount = v_refund_amount,
    refund_status = case when v_refund_amount > 0 then 'pending' else 'none' end,
    updated_at = now()
  where id = p_booking_id;

  return jsonb_build_object(
    'success', true,
    'refund_percentage', v_refund_pct,
    'refund_amount', v_refund_amount,
    'hours_until_booking', v_hours_until_booking
  );
end;
$function$;

create or replace function public.generate_referral_code(p_host_id uuid)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare
  v_code text;
  v_exists boolean;
  v_name text;
begin
  if not (coalesce(auth.role(), 'service_role') = 'service_role'
          or public.is_admin_user()
          or auth.uid() = p_host_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select upper(substring(replace(full_name, ' ', ''), 1, 4)) into v_name
  from public.user_profiles where id = p_host_id;

  if v_name is null or v_name = '' then
    v_name := 'HOST';
  end if;

  loop
    v_code := v_name || upper(substring(md5(random()::text), 1, 4));
    select exists(select 1 from public.referral_codes where code = v_code) into v_exists;
    exit when not v_exists;
  end loop;

  insert into public.referral_codes (host_id, code, discount_pct, is_active)
  values (p_host_id, v_code, 10, true)
  on conflict (code) do nothing;

  return v_code;
end;
$function$;

-- 6. Remove client access to server-only functions ----------------------------
-- Trigger functions do not need EXECUTE for the triggering role.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_booking_notification() from public, anon, authenticated;
revoke execute on function public.notify_booking_status_change() from public, anon, authenticated;
revoke execute on function public.notify_host_went_live() from public, anon, authenticated;
revoke execute on function public.fn_create_payout_on_completion() from public, anon, authenticated;
revoke execute on function public.set_auto_release_timer() from public, anon, authenticated;
revoke execute on function public.update_listing_bookings() from public, anon, authenticated;
revoke execute on function public.update_listing_rating() from public, anon, authenticated;
-- Marks escrow released without capturing in Stripe: server/cron only.
revoke execute on function public.auto_release_overdue_escrow() from public, anon, authenticated;
revoke execute on function public.cleanup_rate_limit_log() from public, anon, authenticated;
-- Writes a notification for any user id: no anonymous access.
revoke execute on function public.insert_booking_notification(uuid, text, text, text, jsonb) from public, anon;
-- Admin / identity-checked RPCs: signed-in users only.
revoke execute on function public.approve_host_document(uuid, text) from public, anon;
revoke execute on function public.reject_host_document(uuid, text) from public, anon;
revoke execute on function public.approve_provider_verification(uuid, text) from public, anon;
revoke execute on function public.reject_provider_verification(uuid, text) from public, anon;
revoke execute on function public.activate_featured_placement(uuid, integer, numeric) from public, anon;
revoke execute on function public.complete_booking_and_release_escrow(uuid, uuid) from public, anon;
revoke execute on function public.cancel_booking_with_refund(uuid, uuid, text) from public, anon;
revoke execute on function public.generate_referral_code(uuid) from public, anon;
revoke execute on function public.calculate_bundle_commission(uuid) from public, anon;
grant execute on function
  public.approve_host_document(uuid, text), public.reject_host_document(uuid, text),
  public.approve_provider_verification(uuid, text), public.reject_provider_verification(uuid, text),
  public.activate_featured_placement(uuid, integer, numeric),
  public.complete_booking_and_release_escrow(uuid, uuid),
  public.cancel_booking_with_refund(uuid, uuid, text),
  public.generate_referral_code(uuid), public.calculate_bundle_commission(uuid),
  public.insert_booking_notification(uuid, text, text, text, jsonb)
to authenticated, service_role;

-- 7. Policy fixes ----------------------------------------------------------------
-- USING (true): any signed-in user could approve any host's documents.
drop policy if exists admin_update_documents on public.host_documents;

-- These bypassed the completed-booking requirement in guests_create_reviews.
drop policy if exists guests_can_insert_own_reviews on public.reviews;
drop policy if exists guests_manage_own_reviews_ins on public.reviews;

-- Admin check trusted raw_user_meta_data, which users can edit themselves.
drop policy if exists admin_manage_all_subscriptions_sel on public.user_subscriptions;
drop policy if exists admin_manage_all_subscriptions_ins on public.user_subscriptions;
drop policy if exists admin_manage_all_subscriptions_upd on public.user_subscriptions;
drop policy if exists admin_manage_all_subscriptions_del on public.user_subscriptions;
create policy admin_manage_all_subscriptions_sel on public.user_subscriptions
  for select to authenticated using ((select public.is_admin_user()));
create policy admin_manage_all_subscriptions_ins on public.user_subscriptions
  for insert to authenticated with check ((select public.is_admin_user()));
create policy admin_manage_all_subscriptions_upd on public.user_subscriptions
  for update to authenticated using ((select public.is_admin_user())) with check ((select public.is_admin_user()));
create policy admin_manage_all_subscriptions_del on public.user_subscriptions
  for delete to authenticated using ((select public.is_admin_user()));

-- Hosts could write their own payout ledger and earnings. Make them read-only;
-- rows are written by release-escrow (service_role) and definer triggers.
drop policy if exists host_own_payouts on public.payout_ledger;
drop policy if exists admin_full_access_payout_ledger_ins on public.payout_ledger;
drop policy if exists admin_full_access_payout_ledger_upd on public.payout_ledger;
drop policy if exists admin_full_access_payout_ledger_del on public.payout_ledger;
drop policy if exists host_read_own_payouts on public.payout_ledger;
create policy host_read_own_payouts on public.payout_ledger
  for select to authenticated using (host_id = (select auth.uid()));

drop policy if exists hosts_manage_own_earnings_ins on public.earnings;
drop policy if exists hosts_manage_own_earnings_upd on public.earnings;
drop policy if exists hosts_manage_own_earnings_del on public.earnings;
drop policy if exists admin_full_access_earnings_ins on public.earnings;
drop policy if exists admin_full_access_earnings_upd on public.earnings;
drop policy if exists admin_full_access_earnings_del on public.earnings;
drop policy if exists admin_manage_earnings_ins on public.earnings;
drop policy if exists admin_manage_earnings_upd on public.earnings;
drop policy if exists admin_manage_earnings_del on public.earnings;
create policy admin_manage_earnings_ins on public.earnings
  for insert to authenticated with check ((select public.is_admin_user()));
create policy admin_manage_earnings_upd on public.earnings
  for update to authenticated using ((select public.is_admin_user())) with check ((select public.is_admin_user()));
create policy admin_manage_earnings_del on public.earnings
  for delete to authenticated using ((select public.is_admin_user()));

-- 8. Contact and admin emails move to the parent company's domain ------------
update public.platform_settings
set value = jsonb_build_object('value', 'admin@hexatech.app'),
    updated_at = now()
where key = 'support_email';

-- The admin login moves from admin@hexaelite.app to admin@hexatech.app.
-- Its password is unchanged; use "Forgot password" to set a new one.
update auth.users
set email = 'admin@hexatech.app',
    raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                         || jsonb_build_object('email', 'admin@hexatech.app'),
    updated_at = now()
where lower(email) = 'admin@hexaelite.app'
  and not exists (select 1 from auth.users where lower(email) = 'admin@hexatech.app');

update public.user_profiles
set email = 'admin@hexatech.app', updated_at = now()
where lower(email) = 'admin@hexaelite.app';
