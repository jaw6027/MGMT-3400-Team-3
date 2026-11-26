create table public.split_templates (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  allocations jsonb not null,
  version integer not null check (version > 0)
);
create index split_templates_household_idx on public.split_templates(household_id, id);
alter table public.split_templates enable row level security;
create policy split_template_read on public.split_templates for select to authenticated
  using (public.is_member(household_id));
revoke all on public.split_templates from public, anon, authenticated;
grant select on public.split_templates to authenticated;

create function public.save_split_template(payload jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  house uuid := (payload->>'household_id')::uuid;
  template_id uuid := (payload->>'id')::uuid;
  template_name text := btrim(payload->>'name');
  entries jsonb := payload->'allocations';
  expected_version integer := (payload->>'version')::integer;
begin
  perform 1 from public.households where id=house for update;
  if not public.is_member(house) then
    raise exception 'This template is unavailable in your household.';
  end if;
  if template_name is null or char_length(template_name) not between 1 and 80 then
    raise exception 'Enter a template name of 1 to 80 characters.';
  end if;
  if jsonb_typeof(entries) is distinct from 'array' then
    raise exception 'Choose roommates for the template.';
  end if;
  if jsonb_array_length(entries)=0 then
    raise exception 'Select at least one roommate.';
  end if;
  if (select count(distinct entry->>'member_id') from jsonb_array_elements(entries) entry)
      <> jsonb_array_length(entries) then
    raise exception 'Choose unique roommates for the template.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(entries) entry
    where not exists (
      select 1 from public.members m
      where m.household_id=house and m.left_at is null and m.id::text=entry->>'member_id'
    )
  ) then
    raise exception 'Choose current roommates for the template.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(entries) entry
    where jsonb_typeof(entry->'percentage') is distinct from 'string'
      or (entry->>'percentage') !~ '^[0-9]+([.][0-9]{1,2})?$'
  ) then
    raise exception 'Enter a valid percentage for each roommate.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(entries) entry
    where (entry->>'percentage')::numeric > 100
  ) then
    raise exception 'Percentages must be between 0 and 100.';
  end if;
  if (select sum((entry->>'percentage')::numeric) from jsonb_array_elements(entries) entry) <> 100 then
    raise exception 'Roommate percentages must total exactly 100%%.';
  end if;

  if expected_version=0 then
    insert into public.split_templates(id,household_id,name,allocations,version)
    values (template_id,house,template_name,entries,1)
    on conflict (id) do nothing;
  else
    update public.split_templates t
    set name=template_name, allocations=entries, version=t.version+1
    where t.id=template_id and t.household_id=house and t.version=expected_version;
  end if;
  if not found then
    raise exception 'This template changed. Reopen it and try again.';
  end if;
end $$;

create function public.delete_split_template(template_id uuid, household_id uuid, expected_version integer)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform 1 from public.households h where h.id=delete_split_template.household_id for update;
  if not public.is_member(delete_split_template.household_id) then
    raise exception 'This template is unavailable in your household.';
  end if;
  delete from public.split_templates t
  where t.id=template_id and t.household_id=delete_split_template.household_id
    and t.version=expected_version;
  if not found then
    raise exception 'This template changed. Reopen it and try again.';
  end if;
end $$;

revoke all on function public.save_split_template(jsonb), public.delete_split_template(uuid,uuid,integer)
  from public, anon, authenticated;
grant execute on function public.save_split_template(jsonb), public.delete_split_template(uuid,uuid,integer)
  to authenticated;
