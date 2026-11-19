-- Serialize new bank/card and cash reservations before any provider charge.
-- Existing records are retained; only new attempts are checked.
alter table public.payment_orders add column failure_code text, add column completed_at timestamptz;
create function public.stamp_payment_completion() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if new.status='succeeded' and old.status<>'succeeded' then new.completed_at:=now(); end if;
 return new;
end $$;
revoke all on function public.stamp_payment_completion() from public,anon,authenticated;
create trigger payment_completed_at before update of status on public.payment_orders for each row execute function public.stamp_payment_completion();
create function public.guard_duplicate_payment() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare receiver uuid;
begin
 receiver:=case when tg_table_name='cash_payments' then (to_jsonb(new)->>'to_id')::uuid else (to_jsonb(new)->>'recipient_id')::uuid end;
 perform 1 from households where id=new.household_id for update;
 -- Same-id retries still use the original immutable reservation.
 if (tg_table_name='payment_orders' and exists(select 1 from payment_orders where id=new.id))
 or (tg_table_name='cash_payments' and exists(select 1 from cash_payments where id=new.id)) then return new; end if;
 if exists(select 1 from payment_orders p where p.household_id=new.household_id and p.from_id=new.from_id
   and p.recipient_id is not distinct from receiver and p.cents=new.cents
   and (p.status in ('created','processing','requires_action') or (p.status='succeeded' and coalesce(p.completed_at,p.created_at)>now()-interval '10 minutes')))
 or exists(select 1 from cash_payments p where p.household_id=new.household_id and p.from_id=new.from_id
   and p.to_id=receiver and p.cents=new.cents and (p.status='pending' or (p.status='confirmed' and p.resolved_at>now()-interval '10 minutes'))) then
  raise exception using errcode='SC001',message='Possible duplicate payment. Check Activity and pending cash confirmations before paying again. A matching completed payment is protected for 10 minutes.';
 end if;
 return new;
end $$;
revoke all on function public.guard_duplicate_payment() from public,anon,authenticated;
create trigger prevent_duplicate_order before insert on public.payment_orders for each row execute function public.guard_duplicate_payment();
create trigger prevent_duplicate_cash before insert on public.cash_payments for each row execute function public.guard_duplicate_payment();

-- Atomic state transitions deduplicate bank alerts across polls and job runs.
create table public.bank_health (
 user_id uuid not null references auth.users(id) on delete cascade,
 resource text not null, state text not null, updated_at timestamptz not null default now(),
 primary key(user_id,resource)
);
create table public.bank_health_events (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 resource text not null, state text not null, message text not null,
 delivery_status text not null default 'in_app', created_at timestamptz not null default now()
);
alter table public.bank_health enable row level security;
alter table public.bank_health_events enable row level security;
revoke all on public.bank_health,public.bank_health_events from public,anon,authenticated;
grant all on public.bank_health,public.bank_health_events to service_role;
create function public.record_bank_health(account_user uuid, resource_key text, new_state text, alert_message text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare previous text; event_id uuid;
begin
 perform 1 from billing_accounts where user_id=account_user for update;
 select state into previous from bank_health where user_id=account_user and resource=resource_key;
 if previous is not distinct from new_state then return null; end if;
 insert into bank_health(user_id,resource,state) values(account_user,resource_key,new_state)
 on conflict(user_id,resource) do update set state=excluded.state,updated_at=now();
 -- Establish an initial healthy baseline quietly; announce later recovery.
 if previous is null and new_state='ready' then return null; end if;
 insert into bank_health_events(user_id,resource,state,message) values(account_user,resource_key,new_state,alert_message) returning id into event_id;
 insert into payment_notifications(user_id,event_key,message) values(account_user,'bank-'||event_id::text,alert_message);
 return event_id;
end $$;
revoke all on function public.record_bank_health(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.record_bank_health(uuid,text,text,text) to service_role;
