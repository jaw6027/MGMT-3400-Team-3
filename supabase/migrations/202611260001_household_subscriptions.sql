-- Simulated classroom subscriptions. No provider calls, credentials or expense writes.
-- One durable record per household; clients cannot set prices, dates or billing status.
create table public.household_subscriptions (
 household_id uuid primary key references public.households(id),
 state jsonb not null
);
alter table public.household_subscriptions enable row level security;
revoke all on public.household_subscriptions from public,anon,authenticated;
grant all on public.household_subscriptions to service_role;

create function public.subscription_iso(value timestamptz) returns text language sql immutable set timezone='UTC' as $$
 select to_char(value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
create function public.subscription_price(plan text) returns integer language plpgsql immutable as $$
begin
 case plan when 'basic' then return 399; when 'plus' then return 549; when 'premium' then return 699;
 else raise exception 'Choose Basic, Plus or Premium.'; end case;
end $$;
create function public.subscription_settle(s jsonb, real_now timestamptz) returns jsonb language plpgsql set search_path=public,pg_temp set timezone='UTC' as $$
declare at_time timestamptz:=greatest(real_now,(s->>'simulated_at')::timestamptz); due text; plan text; charge_id text; n integer:=0;
begin
 while s->>'status' in ('trialing','active') and (s->>'period_ends_at')::timestamptz<=at_time loop
  n:=n+1; if n>1200 then raise exception 'Refresh the subscription clock with an administrator.'; end if;
  if (s->>'cancel_at_period_end')::boolean then
   s:=s||jsonb_build_object('status','canceled','pending_plan',null,'cancel_at_period_end',false,'fail_next',false);
   exit;
  end if;
  due:=s->>'period_ends_at'; plan:=coalesce(s->>'pending_plan',s->>'plan'); charge_id:='cycle:'||due;
  s:=s||jsonb_build_object('plan',plan,'pending_plan',null);
  if not exists(select 1 from jsonb_array_elements(s->'charges') c where c->>'id'=charge_id) then
   s:=s||jsonb_build_object('charges',(s->'charges')||jsonb_build_array(jsonb_build_object('id',charge_id,'at',due,'plan',plan,'cents',public.subscription_price(plan),'status',case when (s->>'fail_next')::boolean then 'failed' else 'paid' end)));
  end if;
  if (s->>'fail_next')::boolean then s:=s||jsonb_build_object('status','past_due','fail_next',false);
  else s:=s||jsonb_build_object('status','active','period_ends_at',public.subscription_iso(due::timestamptz+interval '1 month')); end if;
 end loop;
 return s;
end $$;

-- Both public entry points serialize on the household row, including first activation.
create function public.subscription_locked(house uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s jsonb; manager uuid;
begin
 if not public.is_member(house) then raise exception 'This household subscription is unavailable.'; end if;
 perform 1 from households where id=house for update;
 select state into s from household_subscriptions where household_id=house;
 if s is null then
  select user_id into manager from members where household_id=house order by joined_at,id limit 1;
  s:=jsonb_build_object('household_id',house,'manager_id',manager,'version',0,'plan',null,'pending_plan',null,'status','not_started','trial_started_at',null,'trial_ends_at',null,'period_ends_at',null,'cancel_at_period_end',false,'fail_next',false,'simulated_at',null,'charges','[]'::jsonb);
  insert into household_subscriptions values(house,s);
 end if;
 return s;
end $$;
create function public.household_subscription_snapshot(household_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s jsonb; next_state jsonb;
begin
 s:=public.subscription_locked(household_id);
 next_state:=public.subscription_settle(s,statement_timestamp());
 if next_state is distinct from s then
  next_state:=next_state||jsonb_build_object('version',(s->>'version')::integer+1);
  update household_subscriptions set state=next_state where household_subscriptions.household_id=household_subscription_snapshot.household_id;
 end if;
 return next_state;
end $$;
create function public.household_subscription_apply(household_id uuid, command jsonb, expected_version integer) returns jsonb language plpgsql security definer set search_path=public,pg_temp set timezone='UTC' as $$
declare s jsonb; action text:=command->>'type'; plan text:=command->>'plan'; at_time timestamptz; manager uuid; target uuid; charge jsonb; last_index integer;
begin
 s:=public.subscription_locked(household_id);
 if expected_version is distinct from (s->>'version')::integer then raise exception 'Subscription changed. Refresh and try again.'; end if;
 if action='claim_management' then
  select user_id into manager from members where members.household_id=household_subscription_apply.household_id and left_at is null order by joined_at,id limit 1;
  if exists(select 1 from members where members.household_id=household_subscription_apply.household_id and user_id=(s->>'manager_id')::uuid and left_at is null) or auth.uid() is distinct from manager then
   raise exception 'Only the first remaining roommate can recover billing management after the manager leaves.';
  end if;
 elsif auth.uid() is distinct from (s->>'manager_id')::uuid then raise exception 'Only the household billing manager can change this subscription.'; end if;
 s:=public.subscription_settle(s,statement_timestamp());
 at_time:=greatest(statement_timestamp(),(s->>'simulated_at')::timestamptz);
 case action
 when 'activate' then
  perform public.subscription_price(plan);
  if s->>'status' not in ('not_started','canceled') then raise exception 'This household already has a subscription.'; end if;
  -- Do not overlap an already submitted legacy app charge. No real payment is changed here.
  if exists(select 1 from payment_orders p where p.household_id=household_subscription_apply.household_id and recipient_id is null and status in ('created','processing','requires_action')) then
   raise exception 'Resolve the pending legacy app-dues payment before activating a subscription.';
  end if;
  s:=s||jsonb_build_object('plan',plan,'pending_plan',null,'cancel_at_period_end',false,'fail_next',false);
  if s->>'trial_started_at' is null then
   s:=s||jsonb_build_object('status','trialing','trial_started_at',public.subscription_iso(at_time),'trial_ends_at',public.subscription_iso(at_time+interval '30 days'),'period_ends_at',public.subscription_iso(at_time+interval '30 days'));
  else
   s:=s||jsonb_build_object('status','active','period_ends_at',public.subscription_iso(at_time+interval '1 month'),'charges',(s->'charges')||jsonb_build_array(jsonb_build_object('id','reactivate:'||((s->>'version')::integer+1)::text,'at',public.subscription_iso(at_time),'plan',plan,'cents',public.subscription_price(plan),'status','paid')));
  end if;
  -- Retain schedule history but disable old app dues for every roommate.
  update payment_dues set paused=true,automatic=false where payment_dues.household_id=household_subscription_apply.household_id and recipient_id is null;
 when 'change_plan' then
  perform public.subscription_price(plan);
  if s->>'status' not in ('trialing','active') or (s->>'cancel_at_period_end')::boolean then raise exception 'Resume or reactivate the subscription before changing plans.'; end if;
  if s->>'status'='trialing' then s:=s||jsonb_build_object('plan',plan,'pending_plan',null);
  else s:=s||jsonb_build_object('pending_plan',case when plan=s->>'plan' then null else plan end); end if;
 when 'cancel' then
  if s->>'status' not in ('trialing','active','past_due') then raise exception 'There is no renewing subscription to cancel.'; end if;
  if s->>'status'='past_due' then s:=s||jsonb_build_object('status','canceled');
  else s:=s||jsonb_build_object('cancel_at_period_end',true); end if;
  s:=s||jsonb_build_object('pending_plan',null,'fail_next',false);
 when 'resume' then
  if not (s->>'cancel_at_period_end')::boolean or s->>'status' not in ('trialing','active') then raise exception 'There is no scheduled cancellation to undo.'; end if;
  s:=s||jsonb_build_object('cancel_at_period_end',false);
 when 'toggle_failure' then
  if s->>'status' not in ('trialing','active') or (s->>'cancel_at_period_end')::boolean then raise exception 'Activate or resume a subscription first.'; end if;
  s:=s||jsonb_build_object('fail_next',not (s->>'fail_next')::boolean);
 when 'advance' then
  if s->>'status' not in ('trialing','active') or s->>'period_ends_at' is null then raise exception 'There is no upcoming billing date.'; end if;
  s:=s||jsonb_build_object('simulated_at',s->>'period_ends_at');
  s:=public.subscription_settle(s,(s->>'simulated_at')::timestamptz);
 when 'retry' then
  if s->>'status'<>'past_due' then raise exception 'There is no failed payment to retry.'; end if;
  last_index:=jsonb_array_length(s->'charges')-1; charge:=s->'charges'->last_index;
  if charge->>'status' is distinct from 'failed' then raise exception 'Failed billing record unavailable.'; end if;
  s:=jsonb_set(s,array['charges',last_index::text],charge||jsonb_build_object('status','paid'));
  s:=s||jsonb_build_object('status','active','period_ends_at',public.subscription_iso(at_time+interval '1 month'));
 when 'transfer' then
  target:=(command->>'user_id')::uuid;
  if not exists(select 1 from members where members.household_id=household_subscription_apply.household_id and user_id=target and left_at is null) then raise exception 'Choose an active household member.'; end if;
  s:=s||jsonb_build_object('manager_id',target);
 when 'claim_management' then s:=s||jsonb_build_object('manager_id',auth.uid());
 else raise exception 'Unknown subscription action.';
 end case;
 s:=s||jsonb_build_object('version',expected_version+1);
 update household_subscriptions set state=s where household_subscriptions.household_id=household_subscription_apply.household_id;
 return s;
end $$;

-- Server guard for the legacy real-payment service, including its background job.
create function public.legacy_app_dues_allowed(household_id uuid) returns boolean language sql security definer set search_path=public,pg_temp as $$
 select not exists(select 1 from household_subscriptions h where h.household_id=legacy_app_dues_allowed.household_id and state->>'trial_started_at' is not null)
$$;
create function public.guard_subscription_app_dues() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 -- Share the activation lock so an order cannot race the eligibility check.
 if new.recipient_id is null then
  perform 1 from households where id=new.household_id for update;
  if not public.legacy_app_dues_allowed(new.household_id) then raise exception 'App dues are replaced by the household subscription. No duplicate app payment is allowed.'; end if;
 end if;
 return new;
end $$;
create trigger subscription_order_guard before insert on public.payment_orders for each row execute function public.guard_subscription_app_dues();
-- Pausing/canceling an existing due is allowed. Creating or resuming one is blocked.
create function public.guard_subscription_app_schedule() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.recipient_id is null and not new.paused then
  perform 1 from households where id=new.household_id for update;
  if not public.legacy_app_dues_allowed(new.household_id) then raise exception 'App dues are replaced by the household subscription. No duplicate app payment is allowed.'; end if;
 end if;
 return new;
end $$;
create trigger subscription_schedule_guard before insert or update on public.payment_dues for each row execute function public.guard_subscription_app_schedule();

revoke all on function public.subscription_iso(timestamptz),public.subscription_price(text),public.subscription_settle(jsonb,timestamptz),public.subscription_locked(uuid),public.guard_subscription_app_dues(),public.guard_subscription_app_schedule(),public.legacy_app_dues_allowed(uuid),public.household_subscription_snapshot(uuid),public.household_subscription_apply(uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.household_subscription_snapshot(uuid),public.household_subscription_apply(uuid,jsonb,integer) to authenticated;
grant execute on function public.legacy_app_dues_allowed(uuid) to service_role;
