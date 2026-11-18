-- Complete a signed-in account's household choice after signup/email confirmation.
-- A per-account lock makes retries and duplicate auth events idempotent.
create function public.complete_household_setup(
  setup_mode text, house_name text default '', house_currency text default 'USD', invitation_code text default ''
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare house uuid;
begin
 if auth.uid() is null then raise exception 'Please log in before joining a household.'; end if;
 if setup_mode is null or setup_mode not in ('create','join') then raise exception 'Choose whether to create or join a household.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select household_id into house from public.members where user_id=auth.uid() and left_at is null;
 -- A replay must never create a second household or move an existing member.
 if house is not null then return house; end if;
 if setup_mode='create' then
  if house_name is null or char_length(trim(house_name)) not between 1 and 80 then raise exception 'Give your household a name between 1 and 80 characters.'; end if;
  if house_currency is null or house_currency not in ('USD','EUR','GBP','CAD','AUD') then raise exception 'Choose a supported household currency.'; end if;
  return public.create_household(trim(house_name),house_currency);
 end if;
 if invitation_code is null or char_length(regexp_replace(invitation_code,'\s','','g')) not between 1 and 128 then raise exception 'Enter the invitation code your roommate shared with you.'; end if;
 return public.join_household(lower(regexp_replace(invitation_code,'\s','','g')));
end;$$;

-- Household names are freely chosen, not unique identifiers. Invitations use codes.
-- Any active household member can rename their own household.
create function public.rename_household(household_id uuid, house_name text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.is_member(household_id) then raise exception 'Only current household members can change its name.'; end if;
 if house_name is null or char_length(trim(house_name)) not between 1 and 80 then raise exception 'Give your household a name between 1 and 80 characters.'; end if;
 update public.households set name=trim(house_name) where id=household_id;
end;$$;
revoke all on function public.complete_household_setup(text,text,text,text),public.rename_household(uuid,text) from public,anon;
grant execute on function public.complete_household_setup(text,text,text,text),public.rename_household(uuid,text) to authenticated;
