-- Immutable private uploads are verified by the Edge service, never by a client-supplied hash.
create table public.household_documents (
 path text primary key, household_id uuid not null references public.households(id),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), mime text not null check(mime in ('image/jpeg','image/png','image/webp','application/pdf')),
 name text not null check(length(name) between 1 and 120)
);
create index household_document_hash on public.household_documents(household_id,sha256);
alter table public.household_documents enable row level security;
revoke all on public.household_documents from public,anon,authenticated;
grant all on public.household_documents to service_role;
alter table public.expenses add column receipt_document jsonb;
alter table public.expenses add column duplicate_confirmations jsonb not null default '[]'::jsonb;
update storage.buckets set allowed_mime_types=array['image/jpeg','image/png','image/webp','application/pdf'] where id='receipts';

-- Edge-only registration also indexes legacy attachments without changing financial history.
create function public.register_verified_document(house uuid, document_path text, file_hash text, file_mime text, file_name text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare meta jsonb;
begin
 if split_part(document_path,'/',1)<>house::text or not exists(select 1 from storage.objects where bucket_id='receipts' and name=document_path) then raise exception 'Document unavailable.'; end if;
 perform 1 from households where id=house for update;
 if exists(select 1 from household_documents where path=document_path and (sha256<>file_hash or mime<>file_mime)) then raise exception 'The immutable document changed. Upload a new original file.'; end if;
 insert into household_documents(path,household_id,sha256,mime,name) values(document_path,house,file_hash,file_mime,left(coalesce(nullif(trim(file_name),''),'Household document'),120)) on conflict(path) do nothing;
 select jsonb_build_object('sha256',sha256,'mime',mime,'name',name,'kind','receipt','reference','') into meta from household_documents where path=document_path and household_id=house;
 update expenses set receipt_document=meta where household_id=house and receipt=document_path and receipt_document is null;
 return meta;
end $$;
revoke all on function public.register_verified_document(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.register_verified_document(uuid,text,text,text,text) to service_role;

create function public.normalize_document_text(value text) returns text language sql immutable as $$select regexp_replace(lower(coalesce(value,'')),'[^a-z0-9]','','g')$$;
alter function public.save_expense(jsonb) rename to save_expense_before_documents;
revoke all on function public.save_expense_before_documents(jsonb) from public,anon,authenticated;
create function public.save_expense(payload jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare house uuid:=(payload->>'household_id')::uuid; eid uuid:=(payload->>'id')::uuid; old expenses;
 attachment_path text:=nullif(payload->>'receipt',''); verified household_documents; meta jsonb; candidate expenses;
 merchant text:=public.normalize_document_text(payload->>'store'); ref text; other_merchant text; same_facts boolean; same_merchant boolean; same_reference boolean;
 matches jsonb:='[]'::jsonb; confirmed jsonb:=coalesce(payload->'duplicate_confirmations','[]'::jsonb); item jsonb; has_file boolean:=false;
begin
 if not is_member(house) then raise exception 'Household unavailable.'; end if;
 -- Serializes every household expense attachment_path, including shopping completion and concurrent uploads.
 perform 1 from households where id=house for update;
 select * into old from expenses where id=eid;
 if old.id is not null and (old.household_id<>house or not is_payer(old.id)) then raise exception 'Only the roommate who paid can edit this purchase.'; end if;
 if attachment_path is not null then
  select * into verified from household_documents where household_id=house and household_documents.path=attachment_path;
  has_file:=found;
  if has_file then
   if payload->>'document_reviewed' is distinct from 'true' then raise exception 'Review the document, date and total before saving.'; end if;
   meta:=jsonb_build_object('sha256',verified.sha256,'mime',verified.mime,'name',verified.name,
    'kind',coalesce(payload->'receipt_document'->>'kind',old.receipt_document->>'kind','receipt'),
    'reference',trim(coalesce(payload->'receipt_document'->>'reference',old.receipt_document->>'reference','')));
   if meta->>'kind' not in ('receipt','utility') or length(meta->>'reference')>120 then raise exception 'Choose a document type and reference up to 120 characters.'; end if;
  elsif attachment_path is distinct from old.receipt or nullif(payload->'receipt_document','null'::jsonb) is not null then raise exception 'Upload a valid receipt or verify the original document before saving. Deploy verify-document and the document migration.';
  end if;
 end if;
 if jsonb_typeof(confirmed)<>'array' or jsonb_array_length(confirmed)>100 then raise exception 'Review the matching household documents.'; end if;
 ref:=public.normalize_document_text(meta->>'reference');
 if attachment_path is not null then
  for candidate in select * from expenses where household_id=house and id<>eid loop
   if candidate.receipt=attachment_path or (has_file and candidate.receipt_document->>'sha256'=verified.sha256) then
    if old.id is null or not coalesce(old.receipt=attachment_path or (has_file and old.receipt_document->>'sha256'=verified.sha256),false) then
    raise exception 'Exact duplicate document: already recorded as %. Use the existing purchase; this file cannot create a second expense.',candidate.name;
    end if;
    continue;
   end if;
   other_merchant:=public.normalize_document_text(candidate.store);
   same_facts:=candidate.date=(payload->>'date')::date and candidate.cents=(payload->>'cents')::integer;
   same_merchant:=merchant<>'' and merchant=other_merchant;
   same_reference:=ref<>'' and ref=public.normalize_document_text(candidate.receipt_document->>'reference');
   if (same_merchant and same_facts) or (same_reference and (same_merchant or (same_facts and (merchant='' or other_merchant='')))) then
    matches:=matches||jsonb_build_array(candidate.id::text);
    if not confirmed ? candidate.id::text then raise exception 'Possible duplicate document. Review the matching household purchases and confirm these are different expenses.'; end if;
   end if;
  end loop;
 end if;
 if nullif(payload->'receipt_details','null'::jsonb) is not null then
  for item in select value from jsonb_array_elements(payload->'receipt_details'->'items') loop
   if item ? 'category' and (jsonb_typeof(item->'category')<>'string' or item->>'category' not in ('Rent','Internet','Subscriptions','Dining','Groceries','Household','Utilities','Food & drinks','Other')) then raise exception 'Choose a valid category for each receipt item.'; end if;
  end loop;
 end if;
 eid:=public.save_expense_before_documents(payload);
 update expenses set receipt_document=meta,duplicate_confirmations=matches where id=eid;
 return eid;
end $$;
revoke all on function public.normalize_document_text(text),public.save_expense(jsonb) from public,anon;
grant execute on function public.save_expense(jsonb) to authenticated;
