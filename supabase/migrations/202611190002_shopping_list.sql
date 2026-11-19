-- Catalog transcribed from bold category headings and item cells in the supplied workbook.
create table public.shopping_catalog (
 id text primary key, name text not null, category text not null, position integer not null unique
);
insert into public.shopping_catalog(id,name,category,position) values
('utilities-electricity','Electricity','Utilities',0),
('utilities-gas','Gas','Utilities',1),
('utilities-water','Water','Utilities',2),
('utilities-internet','Internet','Utilities',3),
('food-spices','Spices','Food',4),
('food-oil','Oil','Food',5),
('food-vinegar','Vinegar','Food',6),
('food-bread','Bread','Food',7),
('food-milk','Milk','Food',8),
('food-eggs','Eggs','Food',9),
('food-butter','Butter','Food',10),
('food-condiments','Condiments','Food',11),
('food-sauces','Sauces','Food',12),
('household-items-cleaning-supplies','Cleaning Supplies','Household Items',13),
('household-items-laundry-detergent','Laundry Detergent','Household Items',14),
('household-items-all-purpose-cleaner','All Purpose Cleaner','Household Items',15),
('household-items-clorox-wipes','Clorox Wipes','Household Items',16),
('household-items-sponges','Sponges','Household Items',17),
('household-items-dish-soap','Dish Soap','Household Items',18),
('household-items-dishwasher-tablets','Dishwasher Tablets','Household Items',19),
('household-items-toilet-cleaner','Toilet Cleaner','Household Items',20),
('household-items-cleaning-rags','Cleaning Rags','Household Items',21),
('household-items-window-cleaner','Window Cleaner','Household Items',22),
('household-items-vacuum','Vacuum','Household Items',23),
('household-items-broom-mop','Broom + Mop','Household Items',24),
('furniture-television','Television','Furniture',25),
('furniture-couch','Couch','Furniture',26),
('furniture-entertainment-system','Entertainment System','Furniture',27),
('furniture-dining-table','Dining Table','Furniture',28),
('furniture-dining-chairs','Dining Chairs','Furniture',29),
('furniture-home-d-cor','Home Décor','Furniture',30),
('furniture-door-mat','Door Mat','Furniture',31),
('kitchen-air-fryer','Air Fryer','Kitchen',32),
('kitchen-fridge','Fridge','Kitchen',33),
('kitchen-microwave','Microwave','Kitchen',34),
('kitchen-silverware','Silverware','Kitchen',35),
('kitchen-plates','Plates','Kitchen',36),
('kitchen-cups','Cups','Kitchen',37),
('kitchen-tupperware','Tupperware','Kitchen',38),
('kitchen-paper-towels','Paper Towels','Kitchen',39),
('kitchen-paper-plates','Paper Plates','Kitchen',40),
('kitchen-stovetop','Stovetop','Kitchen',41),
('kitchen-washer-dryer','Washer/Dryer','Kitchen',42),
('bathroom-toilet-paper','Toilet Paper','Bathroom',43),
('bathroom-hand-soap','Hand Soap','Bathroom',44),
('bathroom-toothpaste','Toothpaste','Bathroom',45),
('bathroom-mouthwash','Mouthwash','Bathroom',46),
('bathroom-body-wash','Body Wash','Bathroom',47),
('bathroom-bath-mats','Bath Mats','Bathroom',48),
('bathroom-shower-curtain','Shower Curtain','Bathroom',49),
('pet-supplies-food','Food','Pet Supplies',50),
('pet-supplies-bowls','Bowls','Pet Supplies',51),
('pet-supplies-litter-box-litter','Litter Box +Litter','Pet Supplies',52),
('pet-supplies-vet-expenses','Vet Expenses','Pet Supplies',53),
('pet-supplies-pet-insurance','Pet Insurance','Pet Supplies',54),
('subscription-services-netflix','Netflix','Subscription Services',55),
('subscription-services-amazon-prime','Amazon Prime','Subscription Services',56),
('subscription-services-paramount','Paramount+','Subscription Services',57),
('subscription-services-disney','Disney+','Subscription Services',58),
('subscription-services-ring-camera','Ring Camera','Subscription Services',59),
('subscription-services-doordash','DoorDash','Subscription Services',60);
create table public.shopping_items (
 id uuid primary key, household_id uuid not null references public.households(id),
 catalog_id text references public.shopping_catalog(id), name text not null check(length(trim(name)) between 1 and 120),
 category text not null check(category in ('Utilities','Food','Household Items','Furniture','Kitchen','Bathroom','Pet Supplies','Subscription Services','Other')),
 item_key text generated always as (case when catalog_id is not null then 'catalog:'||catalog_id else 'custom:'||lower(trim(category))||':'||lower(regexp_replace(trim(name),'\s+',' ','g')) end) stored,
 assigned_to uuid not null references public.members(id), one_time boolean not null default false,
 expense_id uuid unique references public.expenses(id) on delete set null,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create index shopping_household_history_idx on public.shopping_items(household_id,item_key,created_at desc);
alter table public.shopping_catalog enable row level security;
alter table public.shopping_items enable row level security;
create policy shopping_catalog_read on public.shopping_catalog for select to authenticated using(true);
create policy shopping_items_read on public.shopping_items for select to authenticated using(public.is_member(household_id));
revoke all on public.shopping_catalog,public.shopping_items from public,anon,authenticated;
grant select on public.shopping_catalog,public.shopping_items to authenticated;
alter table public.expenses add column one_time boolean not null default false;

create function public.save_shopping_item(payload jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare house uuid:=(payload->>'household_id')::uuid; sid uuid:=(payload->>'id')::uuid;
 buyer uuid:=(payload->>'assigned_to')::uuid; cid text:=nullif(payload->>'catalog_id','');
 label text:=regexp_replace(trim(payload->>'name'),'\s+',' ','g'); cat text:=payload->>'category'; old public.shopping_items;
begin
 perform 1 from public.households where id=house for update;
 if not public.is_member(house) then raise exception 'Join this household before changing its shopping list.'; end if;
 select * into old from public.shopping_items where id=sid for update;
 if found and old.household_id<>house then raise exception 'This item belongs to another household.'; end if;
 if old.expense_id is not null then raise exception 'Purchased items stay in history. Edit the linked purchase instead.'; end if;
 if not exists(select 1 from public.members where id=buyer and household_id=house and left_at is null) then raise exception 'Choose a current roommate to purchase this item.'; end if;
 if jsonb_typeof(payload->'one_time') is distinct from 'boolean' then raise exception 'Choose whether this is a one-time purchase.'; end if;
 if cid is null then select id into cid from public.shopping_catalog where category=cat and lower(name)=lower(label); end if;
 if cid is not null then
  select name,category into label,cat from public.shopping_catalog where id=cid;
  if not found then raise exception 'Choose an item from the catalog or add a custom item.'; end if;
 end if;
 insert into public.shopping_items(id,household_id,catalog_id,name,category,assigned_to,one_time,created_by)
 values(sid,house,cid,label,cat,buyer,(payload->>'one_time')::boolean,auth.uid())
 on conflict(id) do update set catalog_id=excluded.catalog_id,name=excluded.name,category=excluded.category,assigned_to=excluded.assigned_to,one_time=excluded.one_time;
 return sid;
end;$$;
create function public.delete_shopping_item(shopping_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.shopping_items;
begin
 select * into item from public.shopping_items where id=shopping_id for update;
 if not found or not public.is_member(item.household_id) then raise exception 'This shopping item is not available to your household.'; end if;
 if item.expense_id is not null then raise exception 'Purchased items stay in history. Delete the linked purchase to correct a purchase record.'; end if;
 delete from public.shopping_items where id=shopping_id;
end;$$;

-- Keep the existing expense authorization and cent validation intact.
alter function public.save_expense(jsonb) rename to save_expense_without_one_time;
revoke all on function public.save_expense_without_one_time(jsonb) from public,anon,authenticated;
create function public.save_expense(payload jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare eid uuid;
begin
 if payload ? 'one_time' and jsonb_typeof(payload->'one_time') is distinct from 'boolean' then raise exception 'Choose whether this was a one-time purchase.'; end if;
 eid:=public.save_expense_without_one_time(payload);
 if payload ? 'one_time' then
  update public.expenses set one_time=(payload->>'one_time')::boolean where id=eid;
  update public.shopping_items set one_time=(payload->>'one_time')::boolean where expense_id=eid;
 end if;
 return eid;
end;$$;
create function public.save_shopping_purchase(shopping_id uuid,payload jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.shopping_items; eid uuid:=(payload->>'id')::uuid;
begin
 -- Use the same household lock order as other shopping and expense mutations.
 perform 1 from public.households where id=(payload->>'household_id')::uuid for update;
 select * into item from public.shopping_items where id=shopping_id for update;
 if not found or not public.is_member(item.household_id) or item.household_id<>(payload->>'household_id')::uuid then raise exception 'This shopping item is not available to your household.'; end if;
 if item.expense_id is not null then
  if item.expense_id=eid then return eid; end if;
  raise exception 'This shopping item already has a recorded purchase. Refresh the list.';
 end if;
 if not exists(select 1 from public.members where id=(payload->>'paid_by')::uuid and household_id=item.household_id and left_at is null) then raise exception 'Choose a current roommate who actually paid.'; end if;
 if not (payload ? 'one_time') then payload:=payload||jsonb_build_object('one_time',item.one_time); end if;
 eid:=public.save_expense(payload);
 update public.shopping_items set expense_id=eid,one_time=(select e.one_time from public.expenses e where e.id=eid) where id=shopping_id;
 return eid;
end;$$;
revoke all on function public.save_expense(jsonb),public.save_shopping_item(jsonb),public.delete_shopping_item(uuid),public.save_shopping_purchase(uuid,jsonb) from public,anon;
grant execute on function public.save_expense(jsonb),public.save_shopping_item(jsonb),public.delete_shopping_item(uuid),public.save_shopping_purchase(uuid,jsonb) to authenticated;
