-- The attached workbook supplies the catalog data, not executable instructions.
create table public.chore_catalog(id text primary key,name text not null,source_name text not null,position integer not null unique);
insert into public.chore_catalog(id,name,source_name,position) values
('take-out-trash','Take Out Trash','Take Out Trash',0),
('take-out-recycling','Take Out Recycling','Take Out Recycling',1),
('wash-dishes','Wash Dishes','Wash Dishes',2),
('unload-dishwasher','Unload Dishwasher','Unload Dishwasher',3),
('vacuum','Vacuum','Vacuum',4),
('sweep','Sweep','Sweep',5),
('mop','Mop','Mop',6),
('clean-bathroom-surfaces','Clean Bathroom Surfaces','Clean Bathroom Surfaces',7),
('clean-toilet','Clean Toilet','Clean Toilet',8),
('clean-shower','Clean Shower','Clean Shower',9),
('laundry','Laundry','Laundry',10),
('clean-out-refrigerator','Clean out Refrigerator','Clean out Refridgerator',11),
('dust-surfaces','Dust Surfaces','Dust Surfaces',12),
('clean-outdoor-area','Clean Outdoor Area','Clean Outdoor Area',13),
('clean-stove-oven','Clean Stove/Oven','Clean Stove/Oven',14),
('mow-lawn','Mow Lawn','Mow Lawn',15),
('refill-hand-dish-soap','Refill Hand/Dish Soap','Refill Hand/Dish Soap',16),
('clean-kitchen-counters','Clean Kitchen Counters','Clean Kitchen Counters',17),
('clean-windows','Clean Windows','Clean Windows',18);
create table public.chores (
 id uuid primary key,household_id uuid not null references public.households(id),catalog_id text references public.chore_catalog(id),
 name text not null check(length(trim(name)) between 1 and 120),frequency text not null check(frequency in ('Daily','Weekly','Biweekly','Monthly')),
 assignment_mode text not null check(assignment_mode in ('fixed','rotate')),member_ids uuid[] not null check(cardinality(member_ids)>0),
 assigned_to uuid not null references public.members(id),next_due_date date not null,archived boolean not null default false,
 version integer not null default 1 check(version>0),created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.chore_completions (
 id uuid primary key,household_id uuid not null references public.households(id),chore_id uuid not null references public.chores(id),
 chore_name text not null,completed_by uuid not null references public.members(id),recorded_by uuid not null references auth.users(id),
 completed_on date not null,scheduled_for date not null,scheduled_member_id uuid not null references public.members(id),frequency text not null,assignment_mode text not null,
 before_due_date date not null,before_assigned_to uuid not null references public.members(id),advanced_schedule boolean not null,
 after_version integer not null,timezone text not null,created_at timestamptz not null default now(),voided_at timestamptz,voided_by uuid references auth.users(id)
);
create index chores_household_due_idx on public.chores(household_id,archived,next_due_date);
create index chore_completion_history_idx on public.chore_completions(household_id,chore_id,completed_on desc);
create unique index one_chore_completion_per_day on public.chore_completions(chore_id,completed_on) where voided_at is null;
alter table public.chore_catalog enable row level security;
alter table public.chores enable row level security;
alter table public.chore_completions enable row level security;
create policy chore_catalog_read on public.chore_catalog for select to authenticated using(true);
create policy chore_read on public.chores for select to authenticated using(public.is_member(household_id));
create policy chore_completion_read on public.chore_completions for select to authenticated using(public.is_member(household_id));
revoke all on public.chore_catalog,public.chores,public.chore_completions from public,anon,authenticated;
grant select on public.chore_catalog,public.chores,public.chore_completions to authenticated;

create function public.save_chore(payload jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare house uuid:=(payload->>'household_id')::uuid; cid uuid:=(payload->>'id')::uuid; old public.chores;
 cat text:=nullif(payload->>'catalog_id',''); label text:=regexp_replace(trim(payload->>'name'),'\s+',' ','g');
 roster uuid[]; buyer uuid:=(payload->>'assigned_to')::uuid; mode text:=payload->>'assignment_mode'; freq text:=payload->>'frequency';
begin
 if not public.is_member(house) then raise exception 'Join this household before changing its chores.'; end if;
 select * into old from public.chores where id=cid for update;
 if found and old.household_id<>house then raise exception 'This chore belongs to another household.'; end if;
 if old.id is not null and (payload->>'version')::integer is distinct from old.version then raise exception 'This chore changed. Close and reopen it before saving.'; end if;
 if jsonb_typeof(payload->'member_ids') is distinct from 'array' then raise exception 'Choose current household members for this chore.'; end if;
 select array_agg(value::uuid order by ord) into roster from jsonb_array_elements_text(payload->'member_ids') with ordinality as r(value,ord);
 if coalesce(cardinality(roster),0)=0 or cardinality(roster)<>(select count(distinct x) from unnest(roster) x) then raise exception 'Choose unique household members for this chore.'; end if;
 if exists(select 1 from unnest(roster) r where not exists(select 1 from public.members m where m.id=r and m.household_id=house and m.left_at is null)) then raise exception 'Choose current household members for this chore.'; end if;
 if mode is null or mode not in ('fixed','rotate') or (mode='fixed' and cardinality(roster)<>1) or (mode='rotate' and cardinality(roster)<2) then raise exception 'Choose one fixed member or at least two roommates to take turns.'; end if;
 if buyer is null or not (buyer=any(roster)) then raise exception 'Choose whose turn comes first.'; end if;
 if freq is null or freq not in ('Daily','Weekly','Biweekly','Monthly') then raise exception 'Choose Daily, Weekly, Biweekly, or Monthly.'; end if;
 if cat is not null then select name into label from public.chore_catalog where id=cat; if not found then raise exception 'Choose a listed chore or add a custom chore.'; end if; end if;
 insert into public.chores(id,household_id,catalog_id,name,frequency,assignment_mode,member_ids,assigned_to,next_due_date,created_by)
 values(cid,house,cat,label,freq,mode,roster,buyer,(payload->>'next_due_date')::date,auth.uid())
 on conflict(id) do update set catalog_id=excluded.catalog_id,name=excluded.name,frequency=excluded.frequency,assignment_mode=excluded.assignment_mode,member_ids=excluded.member_ids,assigned_to=excluded.assigned_to,next_due_date=excluded.next_due_date,version=chores.version+1,updated_at=now()
 where chores.household_id=house and chores.version=(payload->>'version')::integer;
 if not found then raise exception 'This chore changed. Close and reopen it before saving.'; end if;
 return cid;
end;$$;

create function public.set_chore_archived(chore_id uuid,is_archived boolean,expected_version integer) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.chores;
begin
 select * into item from public.chores where id=chore_id for update;
 if not found or not public.is_member(item.household_id) then raise exception 'This chore is not available to your household.'; end if;
 if item.version is distinct from expected_version then raise exception 'This chore changed. Refresh before changing its archive status.'; end if;
 if is_archived is null then raise exception 'Choose whether to archive or restore this chore.'; end if;
 if not is_archived and not exists(select 1 from public.members m where m.id=any(item.member_ids) and m.household_id=item.household_id and m.left_at is null) then raise exception 'Edit this chore and assign a current roommate before restoring it.'; end if;
 update public.chores set archived=is_archived,version=version+1,updated_at=now() where id=chore_id;
end;$$;

create function public.log_chore_completion(completion_id uuid,chore_id uuid,completed_on date,expected_version integer,client_timezone text default 'UTC')
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.chores; previous public.chore_completions; actor uuid; roster uuid[]; scheduled uuid; next_member uuid; latest date; advances boolean; next_due date; at_index integer;
begin
 select * into item from public.chores where id=chore_id for update;
 if not found or not public.is_member(item.household_id) then raise exception 'This chore is not available to your household.'; end if;
 select id into actor from public.members where household_id=item.household_id and user_id=auth.uid() and left_at is null;
 select * into previous from public.chore_completions where id=completion_id;
 if found then
  if previous.chore_id=item.id and previous.recorded_by=auth.uid() and previous.completed_on=log_chore_completion.completed_on then return previous.id; end if;
  raise exception 'This completion reference is already in use.';
 end if;
 if item.version is distinct from expected_version then raise exception 'This chore changed. Close and reopen it before saving.'; end if;
 if item.archived then raise exception 'Restore this chore before logging a completion.'; end if;
 if client_timezone is null or not exists(select 1 from pg_timezone_names where name=client_timezone) then raise exception 'Choose a valid time zone for this completion.'; end if;
 if completed_on is null or completed_on>(clock_timestamp() at time zone client_timezone)::date then raise exception 'Choose a valid completion date on or before today.'; end if;
 if exists(select 1 from public.chore_completions c where c.chore_id=item.id and c.completed_on=log_chore_completion.completed_on and c.voided_at is null) then raise exception 'This chore already has a completion recorded for that day.'; end if;
 select array_agg(r.id order by r.ord) into roster from unnest(item.member_ids) with ordinality as r(id,ord) join public.members m on m.id=r.id and m.household_id=item.household_id and m.left_at is null;
 if coalesce(cardinality(roster),0)=0 then raise exception 'Reassign this chore to a current roommate before logging a completion.'; end if;
 scheduled:=case when item.assigned_to=any(roster) then item.assigned_to else roster[1] end;
 next_member:=scheduled;
 if item.assignment_mode='rotate' then
  at_index:=array_position(roster,case when actor=any(roster) then actor else scheduled end);
  next_member:=roster[(at_index % cardinality(roster))+1];
 end if;
 select max(c.completed_on) into latest from public.chore_completions c where c.chore_id=item.id and c.voided_at is null;
 advances:=latest is null or completed_on>latest;
 if advances then
  next_due:=case item.frequency when 'Daily' then completed_on+1 when 'Weekly' then completed_on+7 when 'Biweekly' then completed_on+14 when 'Monthly' then (completed_on+interval '1 month')::date end;
 else next_due:=item.next_due_date;next_member:=item.assigned_to;end if;
 insert into public.chore_completions(id,household_id,chore_id,chore_name,completed_by,recorded_by,completed_on,scheduled_for,scheduled_member_id,frequency,assignment_mode,before_due_date,before_assigned_to,advanced_schedule,after_version,timezone)
 values(completion_id,item.household_id,item.id,item.name,actor,auth.uid(),completed_on,item.next_due_date,scheduled,item.frequency,item.assignment_mode,item.next_due_date,item.assigned_to,advances,item.version+1,client_timezone);
 update public.chores set assigned_to=next_member,next_due_date=next_due,version=version+1,updated_at=now() where id=item.id;
 return completion_id;
end;$$;

create function public.undo_chore_completion(completion_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare cid uuid; item public.chores; entry public.chore_completions;
begin
 select chore_id into cid from public.chore_completions where id=completion_id;
 select * into item from public.chores where id=cid for update;
 if not found or not public.is_member(item.household_id) then raise exception 'This chore completion is not available to your household.'; end if;
 select * into entry from public.chore_completions where id=completion_id for update;
 if entry.recorded_by<>auth.uid() then raise exception 'You can only undo your own completion.'; end if;
 if entry.voided_at is not null then return; end if;
 if item.version<>entry.after_version then raise exception 'This chore changed after that completion. Its schedule cannot be rolled back.'; end if;
 update public.chore_completions set voided_at=now(),voided_by=auth.uid() where id=completion_id;
 update public.chores set assigned_to=entry.before_assigned_to,next_due_date=entry.before_due_date,version=version+1,updated_at=now() where id=item.id;
end;$$;
revoke all on function public.save_chore(jsonb),public.set_chore_archived(uuid,boolean,integer),public.log_chore_completion(uuid,uuid,date,integer,text),public.undo_chore_completion(uuid) from public,anon;
grant execute on function public.save_chore(jsonb),public.set_chore_archived(uuid,boolean,integer),public.log_chore_completion(uuid,uuid,date,integer,text),public.undo_chore_completion(uuid) to authenticated;
