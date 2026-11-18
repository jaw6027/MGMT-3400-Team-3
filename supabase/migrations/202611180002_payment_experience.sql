-- Payment experience: retain schedules while paused, bind receipts to occurrences,
-- and keep account alerts private. All writes remain behind the trusted service.
alter table public.payment_dues add column paused boolean not null default false;
alter table public.payment_orders add column method_label text not null default '';
alter table public.payment_orders add column automatic boolean not null default false;
update public.payment_orders p set automatic=true from public.payment_dues d where p.due_id=d.id and d.automatic;
alter table public.payment_reminder_deliveries add column kind text not null default 'due' check(kind in ('due','failure'));
alter table public.payment_reminder_deliveries drop constraint payment_reminder_deliveries_pkey;
alter table public.payment_reminder_deliveries add primary key(due_id,due_date,channel,kind);
create table public.payment_notifications (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 event_key text not null, message text not null, created_at timestamptz not null default now(),
 unique(user_id,event_key)
);
create table public.payment_requests (
 id uuid primary key, household_id uuid not null references public.households(id),
 requester_id uuid not null references public.members(id), payer_id uuid not null references public.members(id),
 cents integer not null check(cents between 50 and 99999999), note text not null default '' check(length(note)<=240),
 expense_id uuid references public.expenses(id) on delete set null,
 canceled boolean not null default false, created_at timestamptz not null default now(),
 check(requester_id<>payer_id)
);
alter table public.payment_orders add column request_id uuid references public.payment_requests(id);
-- A request cannot be paid twice by concurrent browser tabs. A failed or canceled
-- attempt can be replaced only after its provider status is terminal. Refunds
-- remain blocked for support review, including partial refunds.
create unique index payment_request_active_order on public.payment_orders(request_id)
 where request_id is not null and status not in ('failed','canceled');
alter table public.payment_requests enable row level security;
alter table public.payment_notifications enable row level security;
revoke all on public.payment_requests,public.payment_notifications from public,anon,authenticated;
grant all on public.payment_requests,public.payment_notifications to service_role;

create function public.reserve_request_payment(order_data jsonb) returns public.payment_orders
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.payment_requests; p public.payment_orders;
begin
 select * into r from public.payment_requests where id=(order_data->>'request_id')::uuid for update;
 if not found or r.canceled then raise exception 'Request unavailable'; end if;
 if r.payer_id<>(order_data->>'from_id')::uuid or r.requester_id<>(order_data->>'recipient_id')::uuid
 or r.household_id<>(order_data->>'household_id')::uuid or r.cents<>(order_data->>'cents')::integer
 or not exists(select 1 from members where id=r.payer_id and user_id=(order_data->>'user_id')::uuid and left_at is null)
 then raise exception 'Request does not match this payment'; end if;
 select * into p from payment_orders where request_id=r.id and status not in ('failed','canceled') limit 1;
 if found then return p; end if;
 insert into payment_orders(id,user_id,household_id,from_id,recipient_id,cents,fee,funding,payment_method,method_label,destination,request_id)
 values((order_data->>'id')::uuid,(order_data->>'user_id')::uuid,r.household_id,r.payer_id,r.requester_id,r.cents,
 (order_data->>'fee')::integer,order_data->>'funding',order_data->>'payment_method',order_data->>'method_label',order_data->>'destination',r.id)
 returning * into p;
 return p;
end $$;
create function public.cancel_payment_request(request_uuid uuid, member_uuid uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.payment_requests;
begin
 select * into r from payment_requests where id=request_uuid for update;
 if not found or r.requester_id<>member_uuid then raise exception 'Request unavailable'; end if;
 if exists(select 1 from payment_orders where request_id=r.id and status not in ('failed','canceled'))
 then raise exception 'A payment is already in progress or completed'; end if;
 update payment_requests set canceled=true where id=r.id;
end $$;
revoke all on function public.reserve_request_payment(jsonb),public.cancel_payment_request(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_request_payment(jsonb),public.cancel_payment_request(uuid,uuid) to service_role;

-- Serialize schedule edits/pauses with new occurrence claims. A claimed payment
-- may finish after a pause; a stale worker cannot claim a new charge afterwards.
create function public.reserve_due_payment(order_data jsonb, off_session boolean) returns public.payment_orders
language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.payment_dues; p public.payment_orders; occurrence date;
begin
 select * into d from payment_dues where id=(order_data->>'due_id')::uuid for update;
 occurrence:=(order_data->>'due_date')::date;
 if not found or d.user_id<>(order_data->>'user_id')::uuid or d.household_id<>(order_data->>'household_id')::uuid
 or d.cents<>(order_data->>'cents')::integer or d.recipient_id is distinct from (order_data->>'recipient_id')::uuid
 or extract(day from occurrence)::integer<>d.due_day or occurrence<d.created_at::date
 then raise exception 'Schedule changed. Refresh before paying.'; end if;
 if off_session and (d.paused or not d.automatic or d.consent_at is null or d.payment_method<>(order_data->>'payment_method') or order_data->>'funding'<>'bank')
 then raise exception 'Schedule is paused or authorization changed'; end if;
 if not exists(select 1 from members where id=(order_data->>'from_id')::uuid and user_id=d.user_id and household_id=d.household_id and left_at is null)
 then raise exception 'Household membership changed'; end if;
 select * into p from payment_orders where due_id=d.id and due_date=occurrence;
 if found then return p; end if;
 insert into payment_orders(id,user_id,household_id,from_id,recipient_id,cents,fee,funding,payment_method,method_label,destination,due_id,due_date,automatic)
 values((order_data->>'id')::uuid,d.user_id,d.household_id,(order_data->>'from_id')::uuid,d.recipient_id,d.cents,
 (order_data->>'fee')::integer,order_data->>'funding',order_data->>'payment_method',order_data->>'method_label',order_data->>'destination',d.id,occurrence,off_session)
 returning * into p;
 return p;
end $$;
revoke all on function public.reserve_due_payment(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.reserve_due_payment(jsonb,boolean) to service_role;
