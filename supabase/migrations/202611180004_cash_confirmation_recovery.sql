-- New cash entries enter the ledger only after the receiver confirms receipt.
create table public.cash_payments (
 id uuid primary key, household_id uuid not null references public.households(id),
 from_id uuid not null references public.members(id), to_id uuid not null references public.members(id),
 cents integer not null check(cents between 1 and 100000000), date date not null,
 proposed_by uuid not null references auth.users(id), status text not null default 'pending' check(status in ('pending','confirmed','disputed')),
 resolved_by uuid references auth.users(id), resolved_at timestamptz, created_at timestamptz not null default now(),
 check(from_id<>to_id), check((status='pending' and resolved_by is null and resolved_at is null) or (status<>'pending' and resolved_by is not null and resolved_at is not null))
);
alter table public.cash_payments enable row level security;
revoke all on public.cash_payments from public,anon,authenticated;
grant select on public.cash_payments to authenticated;
grant all on public.cash_payments to service_role;
create policy cash_participant_read on public.cash_payments for select to authenticated using(
 public.is_member(household_id) and exists(select 1 from members m where m.user_id=auth.uid() and m.id in(from_id,to_id) and m.left_at is null)
);
-- Prevent bypassing confirmation through the legacy direct insert path.
drop policy repayment_insert on public.repayments;
create policy repayment_insert on public.repayments for insert to authenticated with check(
 public.is_member(household_id) and recorded_by=auth.uid() and method='other'
 and exists(select 1 from members m where m.id=from_id and m.household_id=repayments.household_id)
 and exists(select 1 from members m where m.id=to_id and m.household_id=repayments.household_id)
 and exists(select 1 from members m where m.user_id=auth.uid() and m.id in(from_id,to_id) and m.left_at is null)
);
create function public.propose_cash_payment(payload jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.cash_payments; cash_uuid uuid:=(payload->>'id')::uuid; house uuid:=(payload->>'household_id')::uuid;
 sender uuid:=(payload->>'from_id')::uuid; receiver uuid:=(payload->>'to_id')::uuid; amount integer:=(payload->>'cents')::integer;
begin
 if auth.uid() is null or not is_member(house) or not exists(select 1 from members where id=sender and household_id=house and user_id=auth.uid() and left_at is null)
 or not exists(select 1 from members where id=receiver and household_id=house and left_at is null) then raise exception 'Only the sender can record cash for an active roommate'; end if;
 -- The household lock serializes proposals and reference checks.
 perform 1 from households where id=house for update;
 select * into p from cash_payments where id=cash_uuid;
 if found then
  if p.household_id<>house or p.from_id<>sender or p.to_id<>receiver or p.cents<>amount or p.date<>(payload->>'date')::date then raise exception 'A cash entry cannot be changed. Create a corrected entry.'; end if;
  return p.id;
 end if;
 if exists(select 1 from repayments where id=cash_uuid) then raise exception 'Payment reference already used'; end if;
 insert into cash_payments(id,household_id,from_id,to_id,cents,date,proposed_by)
 values(cash_uuid,house,sender,receiver,amount,(payload->>'date')::date,auth.uid());
 return cash_uuid;
end $$;
create function public.resolve_cash_payment(cash_id uuid, decision text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.cash_payments;
begin
 select * into p from cash_payments where id=cash_id for update;
 if not found or not is_member(p.household_id) or not exists(select 1 from members where id=p.to_id and user_id=auth.uid() and left_at is null) then raise exception 'Only the receiving roommate can confirm or dispute this cash entry'; end if;
 if decision not in ('confirmed','disputed') or decision is null then raise exception 'Choose confirm or dispute'; end if;
 if p.status=decision then return; end if;
 if p.status<>'pending' then raise exception 'This cash entry has already been resolved'; end if;
 if decision='confirmed' then
  insert into repayments(id,household_id,from_id,to_id,cents,date,recorded_by,method)
  values(p.id,p.household_id,p.from_id,p.to_id,p.cents,p.date,p.proposed_by,'cash');
 end if;
 update cash_payments set status=decision,resolved_by=auth.uid(),resolved_at=now() where id=p.id;
end $$;
revoke all on function public.propose_cash_payment(jsonb),public.resolve_cash_payment(uuid,text) from public,anon;
grant execute on function public.propose_cash_payment(jsonb),public.resolve_cash_payment(uuid,text) to authenticated;

-- Cancel automatic charges while retaining the due and its payment history.
create function public.cancel_due_autopay(due_uuid uuid, account_user uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.payment_dues;
begin
 select * into d from payment_dues where id=due_uuid and user_id=account_user for update;
 if not found then raise exception 'Schedule unavailable'; end if;
 update payment_dues set automatic=false,consent_at=null,payment_method='',paused=false where id=d.id;
end $$;
revoke all on function public.cancel_due_autopay(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cancel_due_autopay(uuid,uuid) to service_role;

-- Recovery codes are generated with 128 bits of randomness and stored only hashed.
alter table public.billing_accounts add column recovery_pending boolean not null default false;
alter table public.billing_accounts add column recovery_started timestamptz;
alter table public.billing_accounts add column recovery_session text;
create table public.mfa_recovery_codes (
 user_id uuid not null references auth.users(id), code_hash text not null check(code_hash ~ '^[0-9a-f]{64}$'),
 used_at timestamptz, created_at timestamptz not null default now(), primary key(user_id,code_hash)
);
alter table public.mfa_recovery_codes enable row level security;
revoke all on public.mfa_recovery_codes from public,anon,authenticated;
grant all on public.mfa_recovery_codes to service_role;
create function public.replace_mfa_recovery_codes(account_user uuid, hashes text[]) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from billing_accounts where user_id=account_user and not recovery_pending for update;
 if not found or array_length(hashes,1) is distinct from 8 or (select count(distinct h) from unnest(hashes) h)<>8 then raise exception 'Recovery codes unavailable'; end if;
 delete from mfa_recovery_codes where user_id=account_user;
 insert into mfa_recovery_codes(user_id,code_hash) select account_user,unnest(hashes);
end $$;
create function public.consume_mfa_recovery_code(account_user uuid, hashed_code text, session_reference text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from billing_accounts where user_id=account_user for update;
 if not found or session_reference is null or length(session_reference)<10 then raise exception 'Recovery unavailable'; end if;
 update mfa_recovery_codes set used_at=now() where user_id=account_user and code_hash=hashed_code and used_at is null;
 if not found then raise exception 'Recovery code is invalid or already used'; end if;
 update billing_accounts set recovery_pending=true,recovery_started=now(),recovery_session=session_reference where user_id=account_user;
end $$;
revoke all on function public.replace_mfa_recovery_codes(uuid,text[]),public.consume_mfa_recovery_code(uuid,text,text) from public,anon,authenticated;
grant execute on function public.replace_mfa_recovery_codes(uuid,text[]),public.consume_mfa_recovery_code(uuid,text,text) to service_role;
