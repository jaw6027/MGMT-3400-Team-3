alter table public.expenses add column receipt_details jsonb;
alter function public.save_expense(jsonb) rename to save_expense_without_receipt_items;
revoke all on function public.save_expense_without_receipt_items(jsonb) from public,anon,authenticated;
create function public.save_expense(payload jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare eid uuid; d jsonb:=payload->'receipt_details'; item jsonb; field text; subtotal bigint; total bigint; adjustment bigint;
 expected jsonb; actual jsonb; house uuid:=(payload->>'household_id')::uuid;
begin
 if d is not null and d<>'null'::jsonb then
  if jsonb_typeof(d)<>'object' or octet_length(d::text)>64000 or jsonb_typeof(d->'items') is distinct from 'array' then raise exception 'Invalid receipt details'; end if;
  if jsonb_array_length(d->'items') not between 1 and 100 then raise exception 'Add between 1 and 100 receipt items'; end if;
  subtotal:=0;
  for item in select value from jsonb_array_elements(d->'items') loop
   if jsonb_typeof(item->'name') is distinct from 'string' or length(trim(item->>'name')) not between 1 and 120
    or jsonb_typeof(item->'cents') is distinct from 'number' or (item->>'cents') !~ '^[0-9]{1,9}$' or (item->>'cents')::bigint not between 1 and 100000000
    or jsonb_typeof(item->'members') is distinct from 'array' then raise exception 'Invalid receipt item'; end if;
   if jsonb_array_length(item->'members')<1 or (select count(*)<>count(distinct value) from jsonb_array_elements_text(item->'members'))
    or exists(select 1 from jsonb_array_elements(item->'members') m where jsonb_typeof(m)<>'string')
    or exists(select 1 from jsonb_array_elements_text(item->'members') m where not exists(select 1 from members where id=m.value::uuid and household_id=house)) then raise exception 'Assign receipt items to household members'; end if;
   subtotal:=subtotal+(item->>'cents')::bigint;
  end loop;
  foreach field in array array['taxCents','tipCents','discountCents','cashbackExpectedCents','cashbackReceivedCents'] loop
   if jsonb_typeof(d->field) is distinct from 'number' or (d->>field)!~'^[0-9]{1,9}$' or (d->>field)::bigint not between 0 and 100000000 then raise exception 'Invalid receipt adjustment'; end if;
  end loop;
  total:=subtotal+(d->>'taxCents')::bigint+(d->>'tipCents')::bigint-(d->>'discountCents')::bigint;
  if subtotal>100000000 or total not between 1 and 100000000 or total<>(payload->>'cents')::bigint then raise exception 'Receipt total does not match the purchase'; end if;
  if d ? 'sourceTotalCents' and (jsonb_typeof(d->'sourceTotalCents')<>'number' or (d->>'sourceTotalCents')!~'^[0-9]{1,9}$' or (d->>'sourceTotalCents')::bigint<>total) then raise exception 'Review the printed receipt total'; end if;
  if (d->>'cashbackExpectedCents')::bigint>total or (d->>'cashbackReceivedCents')::bigint>total then raise exception 'Cashback cannot exceed the receipt total'; end if;
  with lines as (select value as item,ordinality as line from jsonb_array_elements(d->'items') with ordinality),
  assignments as (select (l.item->>'cents')::bigint as cents, jsonb_array_length(l.item->'members') as n,
    m.value::uuid as member_id,row_number() over(partition by l.line order by m.value::uuid) as position
    from lines l cross join lateral jsonb_array_elements_text(l.item->'members') m),
  weights as (select member_id,sum(cents/n+case when position<=cents%n then 1 else 0 end)::bigint as weight from assignments group by member_id),
  portions as (select member_id,total*weight/subtotal as cents,total*weight%subtotal as remainder from weights),
  ranked as (select *,row_number() over(order by remainder desc,member_id) as position,total-sum(cents) over() as spare from portions)
  select jsonb_agg(jsonb_build_object('member_id',member_id,'cents',cents+case when position<=spare then 1 else 0 end) order by member_id) into expected from ranked;
  select jsonb_agg(jsonb_build_object('member_id',(s->>'member_id')::uuid,'cents',(s->>'cents')::bigint) order by (s->>'member_id')::uuid) into actual from jsonb_array_elements(payload->'shares') s;
  if actual is distinct from expected then raise exception 'Receipt shares do not match the item assignments'; end if;
 end if;
 eid:=public.save_expense_without_receipt_items(payload);
 -- Old clients cannot silently erase existing item assignments by omitting metadata.
 if payload ? 'receipt_details' then update expenses set receipt_details=nullif(d,'null'::jsonb) where id=eid;
 elsif exists(select 1 from expenses where id=eid and receipt_details is not null) then raise exception 'Update this itemized receipt using the current app'; end if;
 return eid;
end $$;
revoke all on function public.save_expense(jsonb) from public,anon;
grant execute on function public.save_expense(jsonb) to authenticated;

-- Only a daily usage count is stored, never OCR images or extracted text.
create table public.receipt_scan_usage(user_id uuid not null references auth.users(id) on delete cascade,day date not null,count integer not null,primary key(user_id,day));
alter table public.receipt_scan_usage enable row level security;
revoke all on public.receipt_scan_usage from public,anon,authenticated;
create function public.claim_receipt_scan(house uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare claimed integer;
begin
 if auth.uid() is null or not is_member(house) then raise exception 'Household unavailable'; end if;
 insert into receipt_scan_usage(user_id,day,count) values(auth.uid(),(now() at time zone 'UTC')::date,1)
 on conflict(user_id,day) do update set count=receipt_scan_usage.count+1 where receipt_scan_usage.count<20 returning count into claimed;
 if claimed is null then raise exception 'Daily receipt scan limit reached. Enter receipt items manually or try tomorrow.'; end if;
end $$;
revoke all on function public.claim_receipt_scan(uuid) from public,anon;
grant execute on function public.claim_receipt_scan(uuid) to authenticated;
