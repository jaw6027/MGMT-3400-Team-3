-- Raw bank numbers, PANs and CVCs never enter SplitCart. Only Stripe identifiers
-- and verified reminder contacts are stored. Writes go through the Edge service.
create table public.billing_accounts (
 user_id uuid primary key references auth.users(id),
 customer_id text unique, connect_id text unique,
 phone_code_at timestamptz, phone_code_window timestamptz, phone_code_count integer not null default 0,
 phone text, phone_verified boolean not null default false,
 email_reminders boolean not null default false, sms_reminders boolean not null default false,
 reminder_days integer not null default 3 check(reminder_days in (0,1,3,7)),
 reminder_consent_at timestamptz,
 unsubscribe_token uuid not null default gen_random_uuid() unique
);
create table public.payment_dues (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 household_id uuid not null references public.households(id),
 recipient_id uuid references public.members(id), -- null = configured SplitCart app dues
 cents integer not null check(cents between 50 and 100000000),
 due_day integer not null check(due_day between 1 and 28),
 automatic boolean not null default false, payment_method text not null,
 consent_at timestamptz, created_at timestamptz not null default now(),
 check(not automatic or consent_at is not null)
);
create table public.payment_orders (
 id uuid primary key, user_id uuid not null references auth.users(id),
 household_id uuid not null references public.households(id),
 from_id uuid not null references public.members(id), recipient_id uuid references public.members(id),
 cents integer not null check(cents between 50 and 100000000),
 fee integer not null check(fee>=0), funding text not null check(funding in ('bank','credit','debit')),
 payment_method text not null, destination text,
 stripe_intent text unique, status text not null default 'created'
 check(status in ('created','processing','requires_action','succeeded','failed','canceled','refunded','disputed')),
 due_id uuid references public.payment_dues(id) on delete set null, due_date date,
 created_at timestamptz not null default now(),
 unique(due_id,due_date),
 check(fee=case when funding='credit' then floor((cents::bigint*25+500)/1000) else 0 end),
 check(cents::bigint+fee<=99999999),
 check(from_id is distinct from recipient_id)
);
create table public.payment_reminder_deliveries (
 due_id uuid not null references public.payment_dues(id) on delete cascade,
 due_date date not null, channel text not null check(channel in ('email','sms')),
 status text not null check(status in ('sending','sent','failed')), created_at timestamptz not null default now(),
 primary key(due_id,due_date,channel)
);
alter table public.billing_accounts enable row level security;
alter table public.payment_dues enable row level security;
alter table public.payment_orders enable row level security;
alter table public.payment_reminder_deliveries enable row level security;
-- Even authenticated clients cannot read provider identifiers or contacts directly.
revoke all on public.billing_accounts,public.payment_dues,public.payment_orders,public.payment_reminder_deliveries from public,anon,authenticated;
grant all on public.billing_accounts,public.payment_dues,public.payment_orders,public.payment_reminder_deliveries to service_role;

-- Called only after retrieving a succeeded PaymentIntent from Stripe. Updating
-- status and recording principal in the household ledger is atomic and repeatable.
create function public.complete_payment(order_id uuid, intent_id text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.payment_orders;
begin
 select * into p from public.payment_orders where id=order_id for update;
 if not found or p.stripe_intent is distinct from intent_id then raise exception 'Unknown payment'; end if;
 if p.status in ('refunded','disputed') then return; end if;
 update public.payment_orders set status='succeeded' where id=order_id;
 if p.recipient_id is not null then
  insert into public.repayments(id,household_id,from_id,to_id,cents,date,recorded_by)
  values(p.id,p.household_id,p.from_id,p.recipient_id,p.cents,current_date,p.user_id)
  on conflict(id) do nothing;
 end if;
end $$;
revoke all on function public.complete_payment(uuid,text) from public,anon,authenticated;
grant execute on function public.complete_payment(uuid,text) to service_role;

create function public.reverse_payment(order_id uuid, new_status text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new_status not in ('refunded','disputed','failed') then raise exception 'Invalid reversal'; end if;
 perform 1 from public.payment_orders where id=order_id for update;
 update public.payment_orders set status=new_status where id=order_id;
 delete from public.repayments where id=order_id;
end $$;
revoke all on function public.reverse_payment(uuid,text) from public,anon,authenticated;
grant execute on function public.reverse_payment(uuid,text) to service_role;

-- Limit verification SMS abuse per authenticated, email-verified account. Twilio
-- Verify fraud/rate controls provide additional destination/IP protection.
create function public.claim_phone_verification(account_user uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.billing_accounts;
begin
 select * into a from public.billing_accounts where user_id=account_user for update;
 if not found then raise exception 'Account unavailable'; end if;
 if a.phone_code_at > now()-interval '60 seconds' then raise exception 'Wait a minute before requesting another code.'; end if;
 if a.phone_code_window is null or a.phone_code_window < now()-interval '1 hour' then
  a.phone_code_count:=0; a.phone_code_window:=now();
 end if;
 if a.phone_code_count>=5 then raise exception 'Verification limit reached. Try again in an hour.'; end if;
 update public.billing_accounts set phone_code_at=now(),phone_code_window=a.phone_code_window,phone_code_count=a.phone_code_count+1 where user_id=account_user;
end $$;
revoke all on function public.claim_phone_verification(uuid) from public,anon,authenticated;
grant execute on function public.claim_phone_verification(uuid) to service_role;
