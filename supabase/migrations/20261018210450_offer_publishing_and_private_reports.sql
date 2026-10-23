create schema if not exists fluqon_private;
revoke all on schema fluqon_private from public, anon, authenticated;
create table fluqon_private.gateway_config (singleton boolean primary key default true check(singleton),key_hash text not null check(key_hash~'^[a-f0-9]{64}$'));
create table fluqon_private.offers (
 id text primary key check(id~'^[a-z0-9][a-z0-9-]{2,59}$'),
 retailer text not null check(length(retailer) between 1 and 80),department text not null default '' check(length(department)<=50),
 category text not null check(category in ('tech','fashion','food','other')),
 title text not null check(length(title) between 3 and 140),description text not null default '' check(length(description)<=400),
 discount text not null check(length(discount) between 1 and 30),code text not null default '' check(length(code)<=80),
 merchant_url text not null check(merchant_url~'^https://[^[:space:]]+$'),
 conditions text not null check(length(conditions) between 10 and 1500),
 affiliate boolean not null default false,glitch boolean not null default false,
 status text not null default 'draft' check(status in ('draft','published','paused','patched','expired')),
 expires_at timestamptz not null,revision integer not null default 1,
 checked_at timestamptz,check_method text check(check_method in ('checkout','merchant')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table fluqon_private.offer_checks (
 id uuid primary key default gen_random_uuid(),offer_id text not null references fluqon_private.offers(id),revision integer not null,
 result text not null check(result in ('working','failed')),method text not null check(method in ('checkout','merchant')),
 source_url text not null check(source_url~'^https://[^[:space:]]+$'),
 evidence text not null check(length(evidence) between 15 and 2500),reviewer text not null check(length(reviewer) between 2 and 100),checked_at timestamptz not null default now()
);
create index checks_offer_time on fluqon_private.offer_checks(offer_id,checked_at desc);
create table fluqon_private.reports (
 id uuid primary key default gen_random_uuid(),offer_id text references fluqon_private.offers(id),
 page_path text not null check(page_path~'^/[a-zA-Z0-9/_-]*$' and length(page_path)<=180),
 reason text not null check(reason in ('code_failed','price_changed','expired','other')),
 details text not null default '' check(length(details)<=800),status text not null default 'new' check(status in ('new','reviewing','resolved','dismissed')),
 resolution text check(length(resolution) between 5 and 1000),created_at timestamptz not null default now(),resolved_at timestamptz
);
create index reports_queue on fluqon_private.reports(status,created_at desc);
create table fluqon_private.audit_log(id bigint generated always as identity primary key,event text not null,entity text,details jsonb not null default '{}',created_at timestamptz not null default now());
create table fluqon_private.request_limits(bucket text not null,kind text not null,window_at timestamptz not null,total integer not null,primary key(bucket,kind,window_at));
create table fluqon_private.email_sync_failures(email text primary key,created_at timestamptz not null default now(),resolved_at timestamptz);
-- Every table is private and denies visitor/authenticated access, including through the Data API.
alter table fluqon_private.gateway_config enable row level security;
alter table fluqon_private.offers enable row level security;
alter table fluqon_private.offer_checks enable row level security;
alter table fluqon_private.reports enable row level security;
alter table fluqon_private.audit_log enable row level security;
alter table fluqon_private.request_limits enable row level security;
alter table fluqon_private.email_sync_failures enable row level security;
revoke all on all tables in schema fluqon_private from public,anon,authenticated;
revoke all on all sequences in schema fluqon_private from public,anon,authenticated;
alter default privileges in schema fluqon_private revoke all on tables from public,anon,authenticated;

create or replace function public.fluqon_gateway(gateway_hash text,operation text,payload jsonb default '{}',client_bucket text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare o fluqon_private.offers; c fluqon_private.offer_checks; r fluqon_private.reports; v_id text; v_count integer; v_out jsonb;
begin
 if not exists(select 1 from fluqon_private.gateway_config g where g.key_hash=gateway_hash) then return jsonb_build_object('error','Unauthorised','status',401);end if;
 if operation='authorize' then return 'true'::jsonb; end if;
 if operation='feed' then
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'shortSlug',id,'retailer',retailer,'department',department,'category',category,'title',title,'description',description,'discount',discount,'code',code,'url',merchant_url,'conditions',conditions,'affiliate',affiliate,'glitch',glitch,'checkedAt',checked_at,'checkMethod',check_method,'expiresAt',expires_at) order by checked_at desc),'[]'::jsonb) into v_out from fluqon_private.offers where status='published' and expires_at>now() and checked_at>now()-(case when glitch then interval '4 hours' else interval '24 hours' end);
  return jsonb_build_object('offers',v_out,'checkedAt',now());
 elsif operation='dashboard' then
  return jsonb_build_object('offers',(select coalesce(jsonb_agg(to_jsonb(t) order by updated_at desc),'[]') from fluqon_private.offers t),'reports',(select coalesce(jsonb_agg(to_jsonb(t) order by created_at desc),'[]') from (select * from fluqon_private.reports order by created_at desc limit 100) t),'checks',(select coalesce(jsonb_agg(to_jsonb(t) order by checked_at desc),'[]') from (select * from fluqon_private.offer_checks order by checked_at desc limit 100) t),'audit',(select coalesce(jsonb_agg(to_jsonb(t) order by created_at desc),'[]') from (select * from fluqon_private.audit_log order by created_at desc limit 40) t),'subscriberCounts',(select jsonb_build_object('pending',count(*) filter(where status='pending'),'active',count(*) filter(where status='active'),'unsubscribed',count(*) filter(where status='unsubscribed')) from subscriber_private.subscribers),'emailSyncFailures',(select count(*) from fluqon_private.email_sync_failures where resolved_at is null));
 elsif operation='save_offer' then
  v_id:=payload->>'id';
  insert into fluqon_private.offers(id,retailer,department,category,title,description,discount,code,merchant_url,conditions,glitch,affiliate,expires_at)
  values(v_id,btrim(payload->>'retailer'),coalesce(payload->>'department',''),payload->>'category',btrim(payload->>'title'),coalesce(payload->>'description',''),payload->>'discount',coalesce(payload->>'code',''),payload->>'merchant_url',payload->>'conditions',coalesce((payload->>'glitch')::boolean,false),coalesce((payload->>'affiliate')::boolean,false),(payload->>'expires_at')::timestamptz)
  on conflict(id) do update set retailer=excluded.retailer,department=excluded.department,category=excluded.category,title=excluded.title,description=excluded.description,discount=excluded.discount,code=excluded.code,merchant_url=excluded.merchant_url,conditions=excluded.conditions,glitch=excluded.glitch,affiliate=excluded.affiliate,expires_at=excluded.expires_at,status='draft',checked_at=null,check_method=null,revision=fluqon_private.offers.revision+1,updated_at=now();
  insert into fluqon_private.audit_log(event,entity) values('draft_saved',v_id);
  return jsonb_build_object('ok',true,'message','Draft saved. A fresh check is required.');
 elsif operation='check_offer' then
  select * into o from fluqon_private.offers where id=payload->>'id' for update;if not found then return jsonb_build_object('error','Offer not found');end if;
  if (payload->>'method'='merchant' and o.glitch) then return jsonb_build_object('error','Glitches require a checkout check.');end if;
  insert into fluqon_private.offer_checks(offer_id,revision,result,method,source_url,evidence,reviewer) values(o.id,o.revision,payload->>'result',payload->>'method',payload->>'source_url',payload->>'evidence',payload->>'reviewer');
  update fluqon_private.offers set checked_at=case when payload->>'result'='working' then now() else null end,check_method=payload->>'method',status=case when payload->>'result'='failed' then 'patched' else status end,updated_at=now() where id=o.id;
  insert into fluqon_private.audit_log(event,entity,details) values('offer_checked',o.id,jsonb_build_object('result',payload->>'result','method',payload->>'method'));
  return jsonb_build_object('ok',true,'message','Check recorded.');
 elsif operation='publish_offer' then
  select * into o from fluqon_private.offers where id=payload->>'id' for update;if not found then return jsonb_build_object('error','Offer not found');end if;
  select * into c from fluqon_private.offer_checks where offer_id=o.id and revision=o.revision order by checked_at desc limit 1;
  if c.id is null or c.result<>'working' or c.checked_at<now()-(case when o.glitch then interval '4 hours' else interval '24 hours' end) or o.expires_at<=now() then return jsonb_build_object('error','A fresh successful check and future expiry are required.');end if;
  update fluqon_private.offers set status='published',updated_at=now() where id=o.id;
  insert into fluqon_private.audit_log(event,entity) values('offer_published',o.id);
  return jsonb_build_object('ok',true,'message','Published.');
 elsif operation='set_status' then
  if payload->>'status' not in ('paused','patched','expired') then return jsonb_build_object('error','Invalid status');end if;
  update fluqon_private.offers set status=payload->>'status',updated_at=now() where id=payload->>'id';if not found then return jsonb_build_object('error','Offer not found');end if;
  insert into fluqon_private.audit_log(event,entity,details) values('offer_status',payload->>'id',jsonb_build_object('status',payload->>'status'));
  return jsonb_build_object('ok',true,'message','Offer removed from the live feed.');
 elsif operation='report' then
  if client_bucket!~'^[a-f0-9]{64}$' then return jsonb_build_object('error','Invalid request');end if;
  delete from fluqon_private.request_limits where window_at<now()-interval '48 hours';
  insert into fluqon_private.request_limits(bucket,kind,window_at,total) values(client_bucket,'report',date_trunc('hour',now()),1) on conflict(bucket,kind,window_at) do update set total=fluqon_private.request_limits.total+1 returning total into v_count;
  if v_count>5 then return jsonb_build_object('error','Too many reports. Try again later.','status',429);end if;
  if nullif(payload->>'offer_id','') is not null and not exists(select 1 from fluqon_private.offers where id=payload->>'offer_id') then return jsonb_build_object('error','Offer not found');end if;
  insert into fluqon_private.reports(offer_id,page_path,reason,details) values(nullif(payload->>'offer_id',''),coalesce(payload->>'page_path','/'),payload->>'reason',coalesce(payload->>'details','')) returning * into r;
  return jsonb_build_object('ok',true,'reference',r.id,'message','Report received. We will check it.');
 elsif operation='resolve_report' then
  if payload->>'status' not in ('reviewing','resolved','dismissed') or length(payload->>'resolution')<5 then return jsonb_build_object('error','Choose a status and add a review note.');end if;
  update fluqon_private.reports set status=payload->>'status',resolution=payload->>'resolution',resolved_at=case when payload->>'status' in ('resolved','dismissed') then now() else null end where id=(payload->>'id')::uuid;if not found then return jsonb_build_object('error','Report not found');end if;
  insert into fluqon_private.audit_log(event,entity,details) values('report_reviewed',payload->>'id',jsonb_build_object('status',payload->>'status'));
  return jsonb_build_object('ok',true,'message','Review saved. Offer status changes are separate.');
 elsif operation in ('subscribe','confirm','unsubscribe','email_sync_failed','provider_unsubscribe') then
  return fluqon_private.subscription_action(operation,payload,client_bucket);
 end if;
 return jsonb_build_object('error','Unknown operation');
exception when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format then return jsonb_build_object('error','Check the fields and try again.');
end; $$;
revoke all on function public.fluqon_gateway(text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.fluqon_gateway(text,text,jsonb,text) to service_role;
comment on function public.fluqon_gateway(text,text,jsonb,text) is 'Server-only gateway. Service role and a separate gateway credential are both required. No direct visitor access.';
