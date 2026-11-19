-- Additive metadata: old schedules and purchases retain their existing values.
alter table public.payment_dues add column label text not null default 'Monthly due' check(length(label) between 1 and 120),
 add column category text not null default 'Other' check(category in ('Rent','Internet','Utilities','Subscriptions','Groceries','Dining','Household','Food & drinks','Other'));
alter table public.expenses drop constraint expenses_category_check;
alter table public.expenses add constraint expenses_category_check check(category in ('Groceries','Household','Utilities','Food & drinks','Other','Rent','Internet','Subscriptions','Dining'));

-- Multiple successful installments are allowed, but only one unresolved
-- reservation per request. Refunds/disputes require support reconciliation.
drop index public.payment_request_active_order;
create unique index payment_request_active_order on public.payment_orders(request_id)
 where request_id is not null and status in ('created','processing','requires_action');
create or replace function public.reserve_request_payment(order_data jsonb) returns public.payment_orders
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.payment_requests; p public.payment_orders; paid bigint; amount integer:=(order_data->>'cents')::integer;
begin
 select * into r from payment_requests where id=(order_data->>'request_id')::uuid for update;
 if not found or r.canceled then raise exception 'Request unavailable'; end if;
 if r.payer_id<>(order_data->>'from_id')::uuid or r.requester_id<>(order_data->>'recipient_id')::uuid
 or r.household_id<>(order_data->>'household_id')::uuid
 or not exists(select 1 from members where id=r.payer_id and user_id=(order_data->>'user_id')::uuid and left_at is null)
 then raise exception 'Request does not match this payment'; end if;
 select * into p from payment_orders where id=(order_data->>'id')::uuid;
 if found then
  if p.request_id is distinct from r.id or p.cents<>amount or p.user_id<>(order_data->>'user_id')::uuid then raise exception 'Payment reference changed'; end if;
  return p;
 end if;
 if exists(select 1 from payment_orders where request_id=r.id and status in ('created','processing','requires_action','refunded','disputed')) then
  raise exception using errcode='SC002',message='This request already has a payment in progress or needing review. Check Activity before paying again.';
 end if;
 select coalesce(sum(cents),0) into paid from payment_orders where request_id=r.id and status='succeeded';
 if amount is null or amount<50 or amount>r.cents-paid or (r.cents-paid-amount between 1 and 49) then
  raise exception using errcode='SC002',message='Refresh this request. Pay up to the remaining balance and leave either zero or at least $0.50 outstanding.';
 end if;
 insert into payment_orders(id,user_id,household_id,from_id,recipient_id,cents,fee,funding,payment_method,method_label,destination,request_id)
 values((order_data->>'id')::uuid,(order_data->>'user_id')::uuid,r.household_id,r.payer_id,r.requester_id,amount,
 (order_data->>'fee')::integer,order_data->>'funding',order_data->>'payment_method',order_data->>'method_label',order_data->>'destination',r.id)
 returning * into p;
 return p;
end $$;
-- Existing function ACL remains service-only after replacement.

-- A cleared installment of this same request is safe to follow immediately:
-- the locked request reservation enforces the aggregate cap. Active attempts
-- and unrelated/new references keep the cross-method duplicate protection.
create or replace function public.guard_duplicate_payment() returns trigger
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
   and (p.status in ('created','processing','requires_action') or (p.status='succeeded' and coalesce(p.completed_at,p.created_at)>now()-interval '10 minutes' and (p.request_id is null or p.request_id is distinct from (to_jsonb(new)->>'request_id')::uuid))))
 or exists(select 1 from cash_payments p where p.household_id=new.household_id and p.from_id=new.from_id
   and p.to_id=receiver and p.cents=new.cents and (p.status='pending' or (p.status='confirmed' and p.resolved_at>now()-interval '10 minutes'))) then
  raise exception using errcode='SC001',message='Possible duplicate payment. Check Activity and pending cash confirmations before paying again. A matching completed payment is protected for 10 minutes.';
 end if;
 return new;
end $$;

-- Serialize settlement/reversal status changes with new installment claims.
-- Holds are checked under this lock rather than put into the active unique
-- index: a refund must still be recordable while another installment processes.
create function public.lock_request_payment_status() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.request_id is not null then perform 1 from payment_requests where id=new.request_id for update; end if;
 return new;
end $$;
revoke all on function public.lock_request_payment_status() from public,anon,authenticated;
create trigger lock_request_payment_status before update of status on public.payment_orders for each row execute function public.lock_request_payment_status();
