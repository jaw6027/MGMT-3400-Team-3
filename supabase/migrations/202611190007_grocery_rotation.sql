-- Grocery schedules, stock and agreement history share a household lock and version.
create function public.grocery_empty() returns jsonb language sql immutable set search_path=public,pg_temp as $fn$select '
{"version": 0, "rotation": null, "essentials": [{"id": "70000000-0000-4000-8000-000000000001", "name": "Toilet Paper", "category": "Bathroom", "quantity": "", "notes": "", "low": false, "shoppingId": null, "lastPurchased": null}, {"id": "70000000-0000-4000-8000-000000000002", "name": "Paper Towels", "category": "Kitchen", "quantity": "", "notes": "", "low": false, "shoppingId": null, "lastPurchased": null}, {"id": "70000000-0000-4000-8000-000000000003", "name": "Dish Soap", "category": "Household Items", "quantity": "", "notes": "", "low": false, "shoppingId": null, "lastPurchased": null}, {"id": "70000000-0000-4000-8000-000000000004", "name": "Laundry Detergent", "category": "Household Items", "quantity": "", "notes": "", "low": false, "shoppingId": null, "lastPurchased": null}, {"id": "70000000-0000-4000-8000-000000000005", "name": "Trash Bags", "category": "Household Items", "quantity": "", "notes": "", "low": false, "shoppingId": null, "lastPurchased": null}, {"id": "70000000-0000-4000-8000-000000000006", "name": "Cleaning Supplies", "category": "Household Items", "quantity": "", "notes": "", "low": false, "shoppingId": null, "lastPurchased": null}, {"id": "70000000-0000-4000-8000-000000000007", "name": "Hand Soap", "category": "Bathroom", "quantity": "", "notes": "", "low": false, "shoppingId": null, "lastPurchased": null}, {"id": "70000000-0000-4000-8000-000000000008", "name": "Shared Food Items", "category": "Food", "quantity": "", "notes": "", "low": false, "shoppingId": null, "lastPurchased": null}], "swaps": [], "history": []}
'::jsonb$fn$;
create table public.grocery_states (
 household_id uuid primary key references public.households(id),
 state jsonb not null default public.grocery_empty(),
 updated_at timestamptz not null default now()
);
alter table public.grocery_states enable row level security;
create policy grocery_read on public.grocery_states for select to authenticated using(public.is_member(household_id));
revoke all on public.grocery_states from public,anon,authenticated;
grant select on public.grocery_states to authenticated;

create function public.grocery_queue(ids jsonb, house uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(x.value order by x.n),'[]'::jsonb) from jsonb_array_elements(ids) with ordinality x(value,n)
 where exists(select 1 from public.members m where m.id::text=x.value#>>'{}' and m.household_id=house and m.left_at is null)
$$;
create function public.grocery_owner(s jsonb, essential_id text, house uuid, day date) returns uuid language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r jsonb:=s->'rotation'; q jsonb; idx integer; periods integer;
begin
 if r is null or r='null'::jsonb then return null; end if;
 if r->>'mode'='grocery' then q:=public.grocery_queue(r->'queue',house); return (q->>0)::uuid; end if;
 q:=public.grocery_queue(r->'restockQueue',house);
 if jsonb_array_length(q)=0 then return null; end if;
 select n-1 into idx from jsonb_array_elements(s->'essentials') with ordinality x(value,n) where value->>'id'=essential_id;
 periods:=greatest(0,floor((day-(r->>'restockStart')::date)::numeric/(r->>'restockDays')::int)::int);
 return (q->>((periods+coalesce(idx,0))%jsonb_array_length(q)))::uuid;
end;$$;
create function public.grocery_sync(house uuid,s jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare e jsonb; owner uuid; cid text; label text; cat text;
begin
 for e in select value from jsonb_array_elements(s->'essentials') loop
  if coalesce((e->>'low')::boolean,false) and e->>'shoppingId' is not null then
   owner:=public.grocery_owner(s,e->>'id',house,(now() at time zone 'UTC')::date);
   if owner is not null then
    cid:=null; label:=e->>'name'; cat:=e->>'category';
    select id into cid from public.shopping_catalog where lower(name)=lower(label) and category=cat;
    update public.shopping_items set assigned_to=owner,name=label,category=cat,catalog_id=cid
     where id=(e->>'shoppingId')::uuid and household_id=house and expense_id is null;
   end if;
  end if;
 end loop;
end;$$;
create function public.grocery_expire(s jsonb) returns jsonb language sql immutable set search_path=public,pg_temp as $$
 select jsonb_set(s,'{swaps}',coalesce((select jsonb_agg(case when x->>'status'='pending' then x||'{"status":"expired"}'::jsonb else x end) from jsonb_array_elements(s->'swaps') x),'[]'::jsonb))
$$;
create function public.grocery_snapshot(household_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s jsonb;
begin
 perform 1 from public.households where id=household_id for update;
 if not public.is_member(household_id) then raise exception 'Join this household before viewing its grocery rotation.'; end if;
 select g.state into s from public.grocery_states g where g.household_id=grocery_snapshot.household_id;
 s:=coalesce(s,public.grocery_empty());
 perform public.grocery_sync(household_id,s);
 return s;
end;$$;
create function public.grocery_apply(household_id uuid, command jsonb, expected_version integer) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 house uuid:=household_id; actor uuid; s jsonb; r jsonb; q jsonb; ev jsonb; old_ev jsonb; e jsonb; item jsonb;
 kind text:=command->>'kind'; rid text:=command->>'id'; target text; essential_key text; label text; cat text;
 owner uuid; shopping uuid; cid text; identity text; swap jsonb; swap_idx integer; target_idx integer;
 days integer; restock_days integer; due date; start_date date; today date:=(now() at time zone 'UTC')::date;
 selected jsonb; restock_selected jsonb; kept jsonb; queue_next jsonb; essentials jsonb;
begin
 perform 1 from public.households where id=house for update;
 select m.id into actor from public.members m where m.household_id=house and m.user_id=auth.uid() and m.left_at is null;
 if actor is null then raise exception 'Join this household before changing its grocery rotation.'; end if;
 if rid is null or length(rid)>100 then raise exception 'Provide a request ID.'; end if;
 perform rid::uuid;
 select g.state into s from public.grocery_states g where g.household_id=house;
 s:=coalesce(s,public.grocery_empty()); r:=nullif(s->'rotation','null'::jsonb);
 select value into old_ev from jsonb_array_elements(s->'history') where value->>'id'=rid;
 if old_ev is not null then
  if old_ev->>'actor'<>actor::text or old_ev->'command' is distinct from command then raise exception 'This request ID was already used.'; end if;
  perform public.grocery_sync(house,s); return s;
 end if;
 if kind='low' and exists(select 1 from jsonb_array_elements(s->'essentials') x where x->>'id'=command->>'essentialId' and (x->>'low')::boolean) then
  perform public.grocery_sync(house,s); return s;
 end if;
 if expected_version is distinct from (s->>'version')::integer then raise exception 'This grocery schedule changed. Refresh and try again.'; end if;
 ev:=jsonb_build_object('id',rid,'kind',kind,'actor',actor::text,'date',today::text,'command',command);
 if kind='configure' then
  selected:=command->'participants'; restock_selected:=command->'restockParticipants';
  if jsonb_typeof(selected) is distinct from 'array' or jsonb_typeof(restock_selected) is distinct from 'array' then raise exception 'Choose distinct current household roommates for the rotation.'; end if;
  foreach q in array array[selected,restock_selected] loop
   if jsonb_array_length(q)<1 or jsonb_array_length(q)>30 or jsonb_array_length(q)<>(select count(distinct value) from jsonb_array_elements_text(q)) or exists(select 1 from jsonb_array_elements_text(q) x where not exists(select 1 from public.members m where m.id::text=x and m.household_id=house and m.left_at is null)) then
    raise exception 'Choose distinct current household roommates for the rotation.';
   end if;
  end loop;
  days:=(command->>'days')::integer; restock_days:=(command->>'restockDays')::integer;
  if jsonb_typeof(command->'days') is distinct from 'number' or jsonb_typeof(command->'restockDays') is distinct from 'number' or days not between 1 and 365 or restock_days not between 1 and 365 or days is null or restock_days is null or command->>'days'!~'^\d+$' or command->>'restockDays'!~'^\d+$' then raise exception 'Choose an interval from 1 to 365 days.'; end if;
  due:=(command->>'due')::date; start_date:=(command->>'restockStart')::date;
  if due is null or start_date is null or command->>'due'<>to_char(due,'YYYY-MM-DD') or command->>'restockStart'<>to_char(start_date,'YYYY-MM-DD') then raise exception 'Choose valid schedule dates (YYYY-MM-DD).'; end if;
  if coalesce(command->>'mode','') not in ('grocery','separate') then raise exception 'Choose a restock mode.'; end if;
  kept:='[]'::jsonb;
  if r is not null then select coalesce(jsonb_agg(value order by n),'[]'::jsonb) into kept from jsonb_array_elements(public.grocery_queue(r->'queue',house)) with ordinality x(value,n) where selected @> jsonb_build_array(value); end if;
  select kept||coalesce(jsonb_agg(value order by n),'[]'::jsonb) into queue_next from jsonb_array_elements(selected) with ordinality x(value,n) where not kept @> jsonb_build_array(value);
  r:=jsonb_build_object('queue',queue_next,'days',days,'due',due::text,'mode',command->>'mode','restockQueue',restock_selected,'restockDays',restock_days,'restockStart',start_date::text,'turn',coalesce((r->>'turn')::integer,0)+1);
  s:=public.grocery_expire(s);
 elsif kind='essential' then
  item:=command->'item'; essential_key:=item->>'id'; if essential_key is null then raise exception 'Choose an essential ID.'; end if; perform essential_key::uuid;
  label:=regexp_replace(trim(item->>'name'),'\s+',' ','g'); cat:=item->>'category';
  if label is null or length(label) not between 1 and 120 or cat is null or cat not in ('Utilities','Food','Household Items','Furniture','Kitchen','Bathroom','Pet Supplies','Subscription Services','Other') then raise exception 'Enter an item name and shopping category.'; end if;
  if item->>'notes' is null or item->>'quantity' is null or length(item->>'notes')>300 or length(item->>'quantity')>60 then raise exception 'Keep notes under 300 characters and quantity under 60.'; end if;
  select name into label from public.shopping_catalog where lower(name)=lower(label) and category=cat;
  label:=coalesce(label,regexp_replace(trim(item->>'name'),'\s+',' ','g'));
  if exists(select 1 from jsonb_array_elements(s->'essentials') x where x->>'id'<>essential_key and lower(x->>'name')=lower(label) and x->>'category'=cat) then raise exception 'This essential already exists. Use its Running Low button.'; end if;
  select value into e from jsonb_array_elements(s->'essentials') where value->>'id'=essential_key;
  e:=coalesce(e,jsonb_build_object('low',false,'shoppingId',null,'lastPurchased',null))||jsonb_build_object('id',essential_key,'name',label,'category',cat,'quantity',item->>'quantity','notes',item->>'notes');
  if exists(select 1 from jsonb_array_elements(s->'essentials') x where x->>'id'=essential_key) then
   select jsonb_agg(case when x->>'id'=essential_key then e else x end) into essentials from jsonb_array_elements(s->'essentials') x;
  else essentials:=s->'essentials'||jsonb_build_array(e); end if;
  s:=jsonb_set(s,'{essentials}',essentials); ev:=ev||jsonb_build_object('item',label);
 elsif kind='low' then
  if r is null then raise exception 'Create a grocery rotation first.'; end if;
  select value into e from jsonb_array_elements(s->'essentials') where value->>'id'=command->>'essentialId';
  if e is null then raise exception 'This essential is unavailable.'; end if;
  owner:=public.grocery_owner(s,e->>'id',house,today);
  if owner is null then raise exception 'Choose active restock participants in the schedule.'; end if;
  label:=e->>'name'; cat:=e->>'category';
  select c.id into cid from public.shopping_catalog c where lower(c.name)=lower(label) and c.category=cat;
  identity:=case when cid is not null then 'catalog:'||cid else 'custom:'||lower(cat)||':'||lower(label) end;
  select si.id into shopping from public.shopping_items si where si.household_id=house and si.item_key=identity and si.expense_id is null order by si.created_at,si.id limit 1;
  if shopping is null then
   shopping:=(command->>'shoppingId')::uuid;
   perform public.save_shopping_item(jsonb_build_object('id',shopping,'household_id',house,'name',label,'category',cat,'catalog_id',cid,'assigned_to',owner,'one_time',false));
  else update public.shopping_items set assigned_to=owner where public.shopping_items.id=shopping; end if;
  select jsonb_agg(case when x->>'id'=e->>'id' then x||jsonb_build_object('low',true,'shoppingId',shopping::text) else x end) into essentials from jsonb_array_elements(s->'essentials') x;
  s:=jsonb_set(s,'{essentials}',essentials); ev:=ev||jsonb_build_object('item',label);
 else
  if r is null then raise exception 'Create a grocery rotation first.'; end if;
  q:=public.grocery_queue(r->'queue',house);
  if jsonb_array_length(q)=0 then raise exception 'Choose active participants in the schedule.'; end if;
  if kind in ('complete','skip') then
   if q->>0<>actor::text then raise exception 'Only the roommate whose turn it is can complete or skip it.'; end if;
   if kind='complete' then
    if (r->>'due')::date>today then raise exception 'This turn has not started yet.'; end if;
    r:=jsonb_set(r,'{due}',to_jsonb((greatest(today,(r->>'due')::date)+(r->>'days')::integer)::text));
   elsif jsonb_array_length(q)<2 then raise exception 'Add another participant before skipping a turn.'; end if;
   r:=r||jsonb_build_object('queue',(q-0)||jsonb_build_array(q->0),'turn',(r->>'turn')::integer+1); s:=public.grocery_expire(s);
  elsif kind='requestSwap' then
   target:=command->>'target';
   if q->>0<>actor::text then raise exception 'Only the current shopper can request a swap.'; end if;
   if target is null or target=actor::text or not q @> jsonb_build_array(target) then raise exception 'Choose another active rotation participant.'; end if;
   if exists(select 1 from jsonb_array_elements(s->'swaps') x where x->>'status'='pending' and x->'turn'=r->'turn') then raise exception 'Resolve or cancel the pending swap first.'; end if;
   swap:=jsonb_build_object('id',rid,'from',actor::text,'to',target,'turn',r->'turn','status','pending');
   s:=jsonb_set(s,'{swaps}',s->'swaps'||jsonb_build_array(swap)); ev:=ev||jsonb_build_object('target',target);
  elsif kind='resolveSwap' then
   select value,(n-1)::integer into swap,swap_idx from jsonb_array_elements(s->'swaps') with ordinality x(value,n) where value->>'id'=command->>'swapId';
   if swap is null or swap->>'status'<>'pending' or swap->'turn'<>r->'turn' or q->>0<>swap->>'from' or not q @> jsonb_build_array(swap->>'to') then raise exception 'This swap is no longer available.'; end if;
   if command->>'decision'='cancel' then
    if actor::text<>swap->>'from' then raise exception 'Only the requester can cancel this swap.'; end if;
    swap:=swap||'{"status":"canceled"}'::jsonb;
   else
    if actor::text<>swap->>'to' then raise exception 'Only the invited roommate can accept or decline this swap.'; end if;
    if coalesce(command->>'decision','') not in ('accept','decline') then raise exception 'Choose an accept or decline decision.'; end if;
    swap:=swap||jsonb_build_object('status',case when command->>'decision'='accept' then 'accepted' else 'declined' end);
    if command->>'decision'='accept' then
     select (n-1)::integer into target_idx from jsonb_array_elements_text(q) with ordinality x(value,n) where value=swap->>'to';
     q:=jsonb_set(jsonb_set(q,array[target_idx::text],q->0),'{0}',to_jsonb(swap->>'to'));
     r:=r||jsonb_build_object('queue',q,'turn',(r->>'turn')::integer+1);
    end if;
   end if;
   s:=jsonb_set(s,array['swaps',swap_idx::text],swap);
   if command->>'decision'='accept' then s:=public.grocery_expire(s); end if;
   ev:=ev||jsonb_build_object('target',swap->>'from');
  else raise exception 'Choose a supported grocery action.'; end if;
 end if;
 s:=s||jsonb_build_object('rotation',r,'version',(s->>'version')::integer+1,'history',jsonb_build_array(ev)||(s->'history'));
 insert into public.grocery_states(household_id,state) values(house,s) on conflict on constraint grocery_states_pkey do update set state=excluded.state,updated_at=now();
 perform public.grocery_sync(house,s);
 return s;
end;$$;

-- Preserve the existing expense validation and payer permissions; trip links do not imply payments.
alter table public.expenses add column grocery_trip_id uuid;
alter function public.save_expense(jsonb) rename to save_expense_without_grocery;
revoke all on function public.save_expense_without_grocery(jsonb) from public,anon,authenticated;
create function public.save_expense(payload jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare house uuid:=(payload->>'household_id')::uuid; trip uuid; old_trip uuid; eid uuid; s jsonb; actor uuid;
begin
 perform 1 from public.households where id=house for update;
 if not public.is_member(house) then raise exception 'Join this household before saving a purchase.'; end if;
 select grocery_trip_id into old_trip from public.expenses where id=(payload->>'id')::uuid and household_id=house;
 trip:=case when payload ? 'grocery_trip_id' then (payload->>'grocery_trip_id')::uuid else old_trip end;
 if trip is not null and trip is distinct from old_trip then
  select m.id into actor from public.members m where m.household_id=house and m.user_id=auth.uid() and m.left_at is null;
  select state into s from public.grocery_states where household_id=house;
  if not exists(select 1 from jsonb_array_elements(s->'history') x where x->>'id'=trip::text and x->>'kind'='complete' and x->>'actor'=actor::text) then raise exception 'Link an expense to a grocery trip you completed in this household.'; end if;
 end if;
 eid:=public.save_expense_without_grocery(payload);
 update public.expenses set grocery_trip_id=trip where id=eid;
 return eid;
end;$$;
alter function public.save_shopping_purchase(uuid,jsonb) rename to save_shopping_purchase_without_grocery;
revoke all on function public.save_shopping_purchase_without_grocery(uuid,jsonb) from public,anon,authenticated;
create function public.save_shopping_purchase(shopping_id uuid,payload jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare house uuid:=(payload->>'household_id')::uuid; s jsonb; e jsonb; owner uuid; eid uuid; actor uuid; entries jsonb;
begin
 perform 1 from public.households where id=house for update;
 if not public.is_member(house) then raise exception 'This shopping item is not available to your household.'; end if;
 select state into s from public.grocery_states where household_id=house;
 select value into e from jsonb_array_elements(s->'essentials') where value->>'shoppingId'=shopping_id::text and (value->>'low')::boolean;
 if e is not null then
  owner:=public.grocery_owner(s,e->>'id',house,(now() at time zone 'UTC')::date);
  select m.id into actor from public.members m where m.household_id=house and m.user_id=auth.uid() and m.left_at is null;
  if owner is null or actor is distinct from owner then raise exception 'Only the assigned restocker can mark this item as purchased. Refresh to check whose turn it is.'; end if;
 end if;
 eid:=public.save_shopping_purchase_without_grocery(shopping_id,payload);
 if e is not null then
  select jsonb_agg(case when x->>'id'=e->>'id' then x||jsonb_build_object('low',false,'quantity','','lastPurchased',payload->>'date') else x end) into entries from jsonb_array_elements(s->'essentials') x;
  s:=s||jsonb_build_object('essentials',entries,'version',(s->>'version')::int+1,'history',jsonb_build_array(jsonb_build_object('id','purchase:'||eid::text,'kind','restock','actor',actor::text,'date',payload->>'date','item',e->>'name','expenseId',eid::text))||(s->'history'));
  update public.grocery_states set state=s,updated_at=now() where household_id=house;
 end if;
 return eid;
end;$$;
-- Direct shopping edits cannot detach an essential from its assigned restocker.
alter function public.save_shopping_item(jsonb) rename to save_shopping_item_without_grocery;
revoke all on function public.save_shopping_item_without_grocery(jsonb) from public,anon,authenticated;
create function public.save_shopping_item(payload jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from public.households where id=(payload->>'household_id')::uuid for update;
 if not public.is_member((payload->>'household_id')::uuid) then raise exception 'Join this household before changing its shopping list.'; end if;
 if exists(select 1 from public.grocery_states g,jsonb_array_elements(g.state->'essentials') e where g.household_id=(payload->>'household_id')::uuid and e->>'shoppingId'=payload->>'id' and (e->>'low')::boolean) then raise exception 'Edit this essential in Grocery & Restock Rotation.'; end if;
 return public.save_shopping_item_without_grocery(payload);
end;$$;
alter function public.delete_shopping_item(uuid) rename to delete_shopping_item_without_grocery;
revoke all on function public.delete_shopping_item_without_grocery(uuid) from public,anon,authenticated;
create function public.delete_shopping_item(shopping_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from public.households where id=(select household_id from public.shopping_items where id=shopping_id) for update;
 if not public.is_member((select household_id from public.shopping_items where id=shopping_id)) then raise exception 'This shopping item is not available to your household.'; end if;
 if exists(select 1 from public.grocery_states g,jsonb_array_elements(g.state->'essentials') e where e->>'shoppingId'=shopping_id::text and (e->>'low')::boolean) then raise exception 'This item is on the shared restocking list. Record its purchase or update the essential.'; end if;
 perform public.delete_shopping_item_without_grocery(shopping_id);
end;$$;
alter function public.delete_expense(uuid) rename to delete_expense_without_grocery;
revoke all on function public.delete_expense_without_grocery(uuid) from public,anon,authenticated;
create function public.delete_expense(expense_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare house uuid; s jsonb; ids text[]; entries jsonb;
begin
 select household_id into house from public.expenses where id=expense_id;
 perform 1 from public.households where id=house for update;
 select state into s from public.grocery_states where household_id=house;
 select array_agg(id::text) into ids from public.shopping_items where public.shopping_items.expense_id=delete_expense.expense_id and household_id=house;
 perform public.delete_expense_without_grocery(expense_id);
 if s is not null and exists(select 1 from jsonb_array_elements(s->'essentials') e where e->>'shoppingId'=any(ids)) then
  select jsonb_agg(case when e->>'shoppingId'=any(ids) then e||jsonb_build_object('low',true,'lastPurchased',null) else e end) into entries from jsonb_array_elements(s->'essentials') e;
  s:=s||jsonb_build_object('essentials',entries,'version',(s->>'version')::int+1);
  update public.grocery_states set state=s,updated_at=now() where household_id=house;
  perform public.grocery_sync(house,s);
 end if;
end;$$;
revoke all on function public.grocery_empty(),public.grocery_queue(jsonb,uuid),public.grocery_owner(jsonb,text,uuid,date),public.grocery_sync(uuid,jsonb),public.grocery_expire(jsonb) from public,anon,authenticated;
revoke all on function public.grocery_snapshot(uuid),public.grocery_apply(uuid,jsonb,integer),public.save_expense(jsonb),public.save_shopping_purchase(uuid,jsonb),public.save_shopping_item(jsonb),public.delete_shopping_item(uuid),public.delete_expense(uuid) from public,anon;
grant execute on function public.grocery_snapshot(uuid),public.grocery_apply(uuid,jsonb,integer),public.save_expense(jsonb),public.save_shopping_purchase(uuid,jsonb),public.save_shopping_item(jsonb),public.delete_shopping_item(uuid),public.delete_expense(uuid) to authenticated;
