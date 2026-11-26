alter table public.expenses add column split_percentages jsonb;

alter function public.save_expense(jsonb) rename to save_expense_without_percentages;
revoke all on function public.save_expense_without_percentages(jsonb) from public,anon,authenticated;

create function public.save_expense(payload jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  eid uuid;
  percentages jsonb := nullif(payload->'split_percentages','null'::jsonb);
  total bigint;
  expected jsonb;
  actual jsonb;
begin
  if percentages is not null then
    if nullif(payload->'receipt_details','null'::jsonb) is not null then
      raise exception 'Choose either receipt items or percentage splitting.';
    end if;
    if jsonb_typeof(percentages) <> 'array' then
      raise exception 'Enter a valid percentage for each roommate.';
    end if;
    if jsonb_array_length(percentages) = 0 then
      raise exception 'Select at least one roommate.';
    end if;
    if exists (
      select 1 from jsonb_array_elements(percentages) entry
      where jsonb_typeof(entry->'member_id') is distinct from 'string'
        or jsonb_typeof(entry->'percentage') is distinct from 'string'
        or (entry->>'percentage') !~ '^[0-9]+([.][0-9]{1,2})?$'
    ) then
      raise exception 'Enter a valid percentage for each roommate.';
    end if;
    if exists (
      select 1 from jsonb_array_elements(percentages) entry
      where (entry->>'percentage')::numeric > 100
    ) then
      raise exception 'Percentages must be between 0 and 100.';
    end if;
    if (select sum((entry->>'percentage')::numeric)
        from jsonb_array_elements(percentages) entry) <> 100 then
      raise exception 'Roommate percentages must total exactly 100%%.';
    end if;

    total := (payload->>'cents')::bigint;
    if total is null or total not between 1 and 100000000 then
      raise exception 'Enter a valid purchase total.';
    end if;
    -- Break ties in entry order, matching the app's percentage allocator.
    with weights as (
      select (entry->>'member_id')::uuid as member_id,
        ((entry->>'percentage')::numeric * 100)::bigint as basis_points,
        ordinality
      from jsonb_array_elements(percentages) with ordinality as entries(entry, ordinality)
    ), portions as (
      select member_id, ordinality, total * basis_points / 10000 as cents,
        total * basis_points % 10000 as remainder
      from weights
    ), ranked as (
      select *, row_number() over (order by remainder desc, ordinality) as position,
        total - sum(cents) over () as spare
      from portions
    )
    select jsonb_agg(jsonb_build_object('member_id',member_id,
      'cents',cents + case when position <= spare then 1 else 0 end) order by member_id, cents)
    into expected from ranked;

    select jsonb_agg(jsonb_build_object('member_id',member_id,'cents',cents) order by member_id, cents)
    into actual
    from jsonb_to_recordset(payload->'shares') as shares(member_id uuid, cents bigint);

    if actual is distinct from expected then
      raise exception 'Shares must match the roommate percentages.';
    end if;
  end if;

  eid := public.save_expense_without_percentages(payload);
  if payload ? 'split_percentages' then
    update public.expenses set split_percentages=percentages where id=eid;
  elsif exists (select 1 from public.expenses where id=eid and split_percentages is not null) then
    raise exception 'Update this percentage split using the current app.';
  end if;
  return eid;
end $$;

revoke all on function public.save_expense(jsonb) from public,anon;
grant execute on function public.save_expense(jsonb) to authenticated;
