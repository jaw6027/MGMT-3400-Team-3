-- SplitCart: all money is integer cents; all household writes are authorized server-side.
create table public.profiles (
 id uuid primary key references auth.users(id), name text not null check (length(trim(name)) between 1 and 80)
);
create table public.households (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 80),
 currency text not null check(currency in ('USD','EUR','GBP','CAD','AUD')),
 invite_code text not null unique default replace(gen_random_uuid()::text,'-',''), created_at timestamptz not null default now()
);
create table public.members (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id),
 user_id uuid not null references auth.users(id), name text not null check(length(trim(name)) between 1 and 80),
 joined_at timestamptz not null default now(), left_at timestamptz, unique(household_id,user_id)
);
create unique index one_active_household on public.members(user_id) where left_at is null;
create index members_household_idx on public.members(household_id);
create table public.expenses (
 id uuid primary key, household_id uuid not null references public.households(id), name text not null check(length(trim(name)) between 1 and 120),
 cents integer not null check(cents between 1 and 100000000), date date not null,
 paid_by uuid not null references public.members(id), created_by uuid not null references auth.users(id),
 category text not null check(category in ('Groceries','Household','Utilities','Food & drinks','Other')),
 store text not null default '' check(length(store)<=120), notes text not null default '' check(length(notes)<=2000),
 receipt text, created_at timestamptz not null default now()
);
create index expenses_household_date_idx on public.expenses(household_id,date desc);
create table public.expense_shares (
 expense_id uuid not null references public.expenses(id) on delete cascade, member_id uuid not null references public.members(id),
 cents integer not null check(cents>=0), primary key(expense_id,member_id)
);
create table public.repayments (
 id uuid primary key, household_id uuid not null references public.households(id),
 from_id uuid not null references public.members(id), to_id uuid not null references public.members(id),
 cents integer not null check(cents between 1 and 100000000), date date not null,
 recorded_by uuid not null references auth.users(id), created_at timestamptz not null default now(), check(from_id<>to_id)
);
create index repayments_household_date_idx on public.repayments(household_id,date desc);
create function public.is_member(house uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.members where household_id=house and user_id=auth.uid() and left_at is null);
$$;
create function public.is_payer(expense uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.expenses e join public.members m on m.id=e.paid_by where e.id=expense and m.user_id=auth.uid() and m.left_at is null and public.is_member(e.household_id));
$$;
alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_shares enable row level security;
alter table public.repayments enable row level security;
create policy own_profile on public.profiles for select to authenticated using(id=auth.uid());
create policy household_read on public.households for select to authenticated using(public.is_member(id));
create policy member_read on public.members for select to authenticated using(public.is_member(household_id) or user_id=auth.uid());
create policy expense_read on public.expenses for select to authenticated using(public.is_member(household_id));
create policy share_read on public.expense_shares for select to authenticated using(exists(select 1 from public.expenses e where e.id=expense_id and public.is_member(e.household_id)));
create policy repayment_read on public.repayments for select to authenticated using(public.is_member(household_id));
create policy repayment_insert on public.repayments for insert to authenticated with check(
 public.is_member(household_id) and recorded_by=auth.uid()
 and exists(select 1 from public.members m where m.id=from_id and m.household_id=repayments.household_id)
 and exists(select 1 from public.members m where m.id=to_id and m.household_id=repayments.household_id)
 and exists(select 1 from public.members m where m.user_id=auth.uid() and m.id in (from_id,to_id) and m.left_at is null)
);
-- No direct expense/share writes: only the atomic validating RPC has write access.
revoke all on public.profiles,public.households,public.members,public.expenses,public.expense_shares,public.repayments from anon,authenticated;
grant select on public.profiles,public.households,public.members,public.expenses,public.expense_shares,public.repayments to authenticated;
grant insert on public.repayments to authenticated;
create function public.create_household(house_name text,house_currency text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare house uuid; display text;
begin
 if auth.uid() is null then raise exception 'Please log in first.'; end if;
 if exists(select 1 from public.members where user_id=auth.uid() and left_at is null) then raise exception 'Leave your current household before creating another.'; end if;
 display:=coalesce(nullif(trim((select raw_user_meta_data->>'name' from auth.users where id=auth.uid())),''),'Roommate');
 insert into public.profiles(id,name) values(auth.uid(),left(display,80)) on conflict(id) do nothing;
 insert into public.households(name,currency) values(trim(house_name),house_currency) returning id into house;
 insert into public.members(household_id,user_id,name) select house,auth.uid(),name from public.profiles where id=auth.uid();
 return house;
end;$$;
create function public.join_household(code text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare house uuid; display text;
begin
 if auth.uid() is null then raise exception 'Please log in first.'; end if;
 if exists(select 1 from public.members where user_id=auth.uid() and left_at is null) then raise exception 'You already belong to a household.'; end if;
 select id into house from public.households where invite_code=trim(code) for update;
 if house is null then raise exception 'That invitation code didn’t match a household. Check with your roommate.'; end if;
 display:=coalesce(nullif(trim((select raw_user_meta_data->>'name' from auth.users where id=auth.uid())),''),'Roommate');
 insert into public.profiles(id,name) values(auth.uid(),left(display,80)) on conflict(id) do nothing;
 insert into public.members(household_id,user_id,name) select house,auth.uid(),name from public.profiles where id=auth.uid()
 on conflict(household_id,user_id) do update set left_at=null,name=excluded.name;
 return house;
end;$$;
create function public.update_profile(display_name text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Please log in first.'; end if;
 insert into public.profiles(id,name) values(auth.uid(),trim(display_name)) on conflict(id) do update set name=excluded.name;
 update public.members set name=trim(display_name) where user_id=auth.uid() and left_at is null;
end;$$;
create function public.leave_household() returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare house uuid;
begin
 select household_id into house from public.members where user_id=auth.uid() and left_at is null;
 perform 1 from public.households where id=house for update;
 update public.members set left_at=now() where user_id=auth.uid() and left_at is null;
end;$$;
create function public.save_expense(payload jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare house uuid:=(payload->>'household_id')::uuid; eid uuid:=(payload->>'id')::uuid; payer uuid:=(payload->>'paid_by')::uuid;
 total integer:=(payload->>'cents')::integer; splits jsonb:=payload->'shares'; old public.expenses; path text:=nullif(payload->>'receipt','');
begin
 perform 1 from public.households where id=house for update;
 if not public.is_member(house) then raise exception 'This purchase belongs to a household you cannot access.'; end if;
 select * into old from public.expenses where id=eid for update;
 if found and (old.household_id<>house or not public.is_payer(eid)) then raise exception 'Only the roommate who paid can edit this purchase.'; end if;
 if not exists(select 1 from public.members where id=payer and household_id=house and (left_at is null or id=old.paid_by)) then raise exception 'Choose a current roommate who paid.'; end if;
 if jsonb_typeof(splits) is distinct from 'array' or jsonb_array_length(splits)=0 then raise exception 'Choose at least one roommate.'; end if;
 if exists(select 1 from jsonb_array_elements(splits) x where jsonb_typeof(x->'cents') is distinct from 'number' or (x->>'cents') !~ '^\d+$' or (x->>'cents')::numeric>100000000 or (x->>'member_id') is null) then raise exception 'Shares must be nonnegative integer cents.'; end if;
 if jsonb_array_length(splits)<>(select count(distinct x->>'member_id') from jsonb_array_elements(splits) x) then raise exception 'A roommate can only appear once.'; end if;
 if (select sum((x->>'cents')::integer) from jsonb_array_elements(splits) x) is distinct from total::bigint then raise exception 'Shares must add up to the purchase total.'; end if;
 if exists(select 1 from jsonb_array_elements(splits) x where not exists(select 1 from public.members m where m.id=(x->>'member_id')::uuid and m.household_id=house and (m.left_at is null or exists(select 1 from public.expense_shares es where es.expense_id=eid and es.member_id=m.id)))) then raise exception 'Choose roommates from this household.'; end if;
 if path is not null and path is distinct from old.receipt then
  if split_part(path,'/',1)<>house::text or split_part(path,'/',2)<>auth.uid()::text or not exists(select 1 from storage.objects where bucket_id='receipts' and name=path) then raise exception 'Upload a valid receipt to your private household folder.'; end if;
 end if;
 insert into public.expenses(id,household_id,name,cents,date,paid_by,created_by,category,store,notes,receipt)
 values(eid,house,trim(payload->>'name'),total,(payload->>'date')::date,payer,auth.uid(),payload->>'category',coalesce(payload->>'store',''),coalesce(payload->>'notes',''),path)
 on conflict(id) do update set name=excluded.name,cents=excluded.cents,date=excluded.date,paid_by=excluded.paid_by,category=excluded.category,store=excluded.store,notes=excluded.notes,receipt=excluded.receipt;
 delete from public.expense_shares where expense_id=eid;
 insert into public.expense_shares(expense_id,member_id,cents) select eid,(x->>'member_id')::uuid,(x->>'cents')::integer from jsonb_array_elements(splits) x;
 return eid;
end;$$;
create function public.delete_expense(expense_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.is_payer(expense_id) then raise exception 'Only the roommate who paid can delete this purchase.'; end if;
 delete from public.expenses where id=expense_id;
end;$$;
-- Private bucket. Supabase Storage validates the MIME allowlist and 5 MB limit.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('receipts','receipts',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy receipt_read on storage.objects for select to authenticated using(bucket_id='receipts' and exists(select 1 from public.households h where h.id::text=split_part(storage.objects.name,'/',1) and public.is_member(h.id)));
create policy receipt_upload on storage.objects for insert to authenticated with check(bucket_id='receipts' and split_part(name,'/',2)=auth.uid()::text and exists(select 1 from public.households h where h.id::text=split_part(storage.objects.name,'/',1) and public.is_member(h.id)));
-- Receipts are immutable evidence. No client UPDATE or DELETE policy.
revoke all on function public.is_member(uuid),public.is_payer(uuid),public.create_household(text,text),public.join_household(text),public.update_profile(text),public.leave_household(),public.save_expense(jsonb),public.delete_expense(uuid) from public,anon;
grant execute on function public.is_member(uuid),public.is_payer(uuid),public.create_household(text,text),public.join_household(text),public.update_profile(text),public.leave_household(),public.save_expense(jsonb),public.delete_expense(uuid) to authenticated;
