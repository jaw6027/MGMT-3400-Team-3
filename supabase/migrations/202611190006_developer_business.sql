-- No developers are seeded. Provision verified Auth UUIDs through a trusted
-- database operator only; signing up or editing profile metadata grants nothing.
create table public.app_developers (
 user_id uuid primary key references auth.users(id) on delete cascade,
 active boolean not null default true, created_at timestamptz not null default now()
);
create table public.developer_business_settings (
 id boolean primary key default true check(id), legal_name text not null default '' check(length(legal_name)<=160),
 legal_structure text not null default 'not_set' check(legal_structure in ('not_set','corporation','llc','sole_proprietorship')),
 tax_classification text not null default 'not_set' check(tax_classification in ('not_set','c_corporation','s_corporation','partnership','disregarded_entity','individual')),
 check((legal_structure='not_set' and tax_classification='not_set') or (legal_structure='corporation' and tax_classification in ('not_set','c_corporation','s_corporation')) or (legal_structure='llc' and tax_classification in ('not_set','c_corporation','s_corporation','partnership','disregarded_entity')) or (legal_structure='sole_proprietorship' and tax_classification in ('not_set','individual'))),
 version integer not null default 0,updated_by uuid references auth.users(id),updated_at timestamptz not null default now()
);
insert into public.developer_business_settings(id) values(true);
create table public.developer_business_audit (
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id),
 event text not null check(event in ('business_settings_updated','payout_settings_opened')),created_at timestamptz not null default now()
);
alter table public.app_developers enable row level security;
alter table public.developer_business_settings enable row level security;
alter table public.developer_business_audit enable row level security;
revoke all on public.app_developers,public.developer_business_settings,public.developer_business_audit from public,anon,authenticated;
grant all on public.app_developers,public.developer_business_settings,public.developer_business_audit to service_role;
-- Service-only mutation rechecks the role atomically, including revocations.
create function public.save_developer_business(actor uuid, expected_version integer, business_name text, structure text, tax text) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare next_version integer;
begin
 perform 1 from app_developers where user_id=actor and active for update;
 if not found then raise exception 'Developer access required'; end if;
 if structure not in ('not_set','corporation','llc','sole_proprietorship') or structure is null
 or tax not in ('not_set','c_corporation','s_corporation','partnership','disregarded_entity','individual') or tax is null
 or business_name is null or length(trim(business_name))>160 then raise exception 'Invalid business settings'; end if;
 update developer_business_settings set legal_name=trim(business_name),legal_structure=structure,tax_classification=tax,
 version=version+1,updated_by=actor,updated_at=now() where id and version=expected_version returning version into next_version;
 if not found then raise exception using errcode='SC003',message='Business settings changed. Refresh before saving.'; end if;
 insert into developer_business_audit(actor_id,event) values(actor,'business_settings_updated');
 return next_version;
end $$;
revoke all on function public.save_developer_business(uuid,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.save_developer_business(uuid,integer,text,text,text) to service_role;
