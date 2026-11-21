-- Preserve existing cash records and their confirmation workflow. Venmo/Zelle
-- records describe payments completed outside SplitCart, not API debits.
alter table public.cash_payments add column channel text not null default 'cash' check(channel in ('cash','venmo','zelle'));
alter table public.repayments drop constraint repayments_method_check;
alter table public.repayments add constraint repayments_method_check check(method in ('other','cash','bank_card','venmo','zelle'));
create or replace function public.propose_cash_payment(payload jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.cash_payments; cash_uuid uuid:=(payload->>'id')::uuid; house uuid:=(payload->>'household_id')::uuid;
 sender uuid:=(payload->>'from_id')::uuid; receiver uuid:=(payload->>'to_id')::uuid; amount integer:=(payload->>'cents')::integer;
 selected_channel text:=coalesce(payload->>'method','cash');
begin
 if selected_channel not in ('cash','venmo','zelle') then raise exception 'Choose cash, Venmo or Zelle'; end if;
 if auth.uid() is null or not is_member(house) or not exists(select 1 from members where id=sender and household_id=house and user_id=auth.uid() and left_at is null)
 or not exists(select 1 from members where id=receiver and household_id=house and left_at is null) then raise exception 'Only the sender can record an outside payment for an active roommate'; end if;
 perform 1 from households where id=house for update;
 select * into p from cash_payments where id=cash_uuid;
 if found then
  if p.household_id<>house or p.from_id<>sender or p.to_id<>receiver or p.cents<>amount or p.date<>(payload->>'date')::date or p.channel<>selected_channel then raise exception 'A payment record cannot be changed. Create a corrected entry.'; end if;
  return p.id;
 end if;
 if exists(select 1 from repayments where id=cash_uuid) then raise exception 'Payment reference already used'; end if;
 insert into cash_payments(id,household_id,from_id,to_id,cents,date,proposed_by,channel)
 values(cash_uuid,house,sender,receiver,amount,(payload->>'date')::date,auth.uid(),selected_channel);
 return cash_uuid;
end $$;
create or replace function public.resolve_cash_payment(cash_id uuid, decision text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.cash_payments;
begin
 select * into p from cash_payments where id=cash_id for update;
 if not found or not is_member(p.household_id) or not exists(select 1 from members where id=p.to_id and user_id=auth.uid() and left_at is null) then raise exception 'Only the receiving roommate can confirm or dispute this payment'; end if;
 if decision not in ('confirmed','disputed') or decision is null then raise exception 'Choose confirm or dispute'; end if;
 if p.status=decision then return; end if;
 if p.status<>'pending' then raise exception 'This payment entry has already been resolved'; end if;
 if decision='confirmed' then
  insert into repayments(id,household_id,from_id,to_id,cents,date,recorded_by,method)
  values(p.id,p.household_id,p.from_id,p.to_id,p.cents,p.date,p.proposed_by,p.channel);
 end if;
 update cash_payments set status=decision,resolved_by=auth.uid(),resolved_at=now() where id=p.id;
end $$;
-- Existing sender/receiver authorization, grants, RLS, and duplicate-reservation
-- triggers remain in effect for all three channels. No contact details are stored.
