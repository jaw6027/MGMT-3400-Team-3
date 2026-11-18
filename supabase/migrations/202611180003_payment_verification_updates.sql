-- Cash records remain distinct from processor-confirmed repayments.
alter table public.repayments add column method text not null default 'other' check(method in ('other','cash','bank_card'));
update public.repayments set method='bank_card' where id in (select id from public.payment_orders);
drop policy repayment_insert on public.repayments;
create policy repayment_insert on public.repayments for insert to authenticated with check(
 public.is_member(household_id) and recorded_by=auth.uid() and method in ('cash','other')
 and exists(select 1 from public.members m where m.id=from_id and m.household_id=repayments.household_id)
 and exists(select 1 from public.members m where m.id=to_id and m.household_id=repayments.household_id)
 and exists(select 1 from public.members m where m.user_id=auth.uid() and m.id in (from_id,to_id) and m.left_at is null)
);
create or replace function public.complete_payment(order_id uuid, intent_id text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.payment_orders;
begin
 select * into p from public.payment_orders where id=order_id for update;
 if not found or p.stripe_intent is distinct from intent_id then raise exception 'Unknown payment'; end if;
 if p.status in ('refunded','disputed') then return; end if;
 update public.payment_orders set status='succeeded' where id=order_id;
 if p.recipient_id is not null then
  insert into public.repayments(id,household_id,from_id,to_id,cents,date,recorded_by,method)
  values(p.id,p.household_id,p.from_id,p.recipient_id,p.cents,current_date,p.user_id,'bank_card') on conflict(id) do nothing;
 end if;
end $$;

alter table public.billing_accounts add column autopay_notices boolean not null default false;
alter table public.billing_accounts add column payment_updates boolean not null default false;
alter table public.payment_reminder_deliveries drop constraint payment_reminder_deliveries_kind_check;
alter table public.payment_reminder_deliveries add constraint payment_reminder_deliveries_kind_check check(kind in ('due','failure','autopay'));
create table public.bank_link_attempts (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 session_id text not null unique, created_at timestamptz not null default now()
);
create table public.payment_update_deliveries (
 order_id uuid not null references public.payment_orders(id), user_id uuid not null references auth.users(id),
 event text not null check(event in ('pending','succeeded','failed','requires_action')),
 channel text not null check(channel in ('email','sms')), status text not null check(status in ('sending','sent','failed')),
 created_at timestamptz not null default now(), primary key(order_id,user_id,event,channel)
);
-- Avoid sending retroactive updates about historical payments after deployment.
alter table public.payment_orders add column notify_events boolean not null default false;
alter table public.payment_orders alter column notify_events set default true;
alter table public.bank_link_attempts enable row level security;
alter table public.payment_update_deliveries enable row level security;
revoke all on public.bank_link_attempts,public.payment_update_deliveries from public,anon,authenticated;
grant all on public.bank_link_attempts,public.payment_update_deliveries to service_role;
