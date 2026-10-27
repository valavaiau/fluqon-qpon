-- PREPARED ONLY: no production execution or migration-history entry is authorised.
-- Register this reviewed SQL with the Supabase CLI only at an approved release.
-- Replaces the exact 27 October gateway function; no tables, identities or roles are created.
begin;
do $preflight$
declare target regprocedure; owner_id oid; function_acl aclitem[]; columns_found integer;
begin
 target:=pg_catalog.to_regprocedure('public.fluqon_community_gateway(text,text,jsonb,uuid,text,boolean)');
 if target is null or pg_catalog.md5(pg_catalog.pg_get_functiondef(target))<>'e1356b8db302f4e4c62330fdf2b52e46' then
  raise exception 'Community gateway changed. Stop and review the current definition before applying this patch.';
 end if;
 select proowner,proacl into owner_id,function_acl from pg_catalog.pg_proc where oid=target;
 if owner_id<>'postgres'::regrole or function_acl is distinct from '{postgres=X/postgres,service_role=X/postgres}'::aclitem[] or
  pg_catalog.has_function_privilege('anon',target,'EXECUTE') or pg_catalog.has_function_privilege('authenticated',target,'EXECUTE') or
  not pg_catalog.has_function_privilege('service_role',target,'EXECUTE') then
  raise exception 'Expected gateway owner or service-only execution changed. Stop without changing ownership or grants.';
 end if;
 select count(*) into columns_found from pg_catalog.pg_attribute
  where attrelid=pg_catalog.to_regclass('auth.sessions') and not attisdropped and
   ((attname='id' and atttypid='uuid'::regtype and attnotnull) or
    (attname='user_id' and atttypid='uuid'::regtype and attnotnull) or
    (attname='not_after' and atttypid='timestamptz'::regtype and not attnotnull));
 if columns_found<>3 or not pg_catalog.has_table_privilege(owner_id,'auth.sessions','SELECT') then
  raise exception 'Expected private Auth session columns or gateway-owner access are unavailable. Stop without changing grants.';
 end if;
end;$preflight$;

CREATE OR REPLACE FUNCTION public.fluqon_community_gateway(gateway_hash text, operation text, payload jsonb DEFAULT '{}'::jsonb, actor_id uuid DEFAULT NULL::uuid, client_bucket text DEFAULT ''::text, operator_access boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m fluqon_community.members; p fluqon_community.proposals; o fluqon_private.offers;
 s jsonb; n integer; v uuid; result jsonb; current_revision integer; label text; can_review boolean;
begin
 if not exists(select 1 from fluqon_private.gateway_config g where g.key_hash=gateway_hash) then
  return jsonb_build_object('error','Unauthorised','status',401);end if;
 if operation='auth_limit' then
  if client_bucket!~'^[a-f0-9]{64}$' then return jsonb_build_object('error','Invalid request.','status',400);end if;
  insert into fluqon_private.request_limits(bucket,kind,window_at,total) values(client_bucket,'community_auth',date_trunc('hour',now()),1)
   on conflict(bucket,kind,window_at) do update set total=fluqon_private.request_limits.total+1 returning total into n;
  if n>12 then return jsonb_build_object('error','Sign-in limit reached. Try later.','status',429);end if;
  return jsonb_build_object('ok',true);
 elsif operation='public_referrals' then
  return coalesce((select jsonb_object_agg(r.offer_id,jsonb_build_object('referralBeneficiary',r.beneficiary,'referralReward',r.reward))
   from fluqon_community.referrals r join fluqon_private.offers f on f.id=r.offer_id where f.status='published'),'{}'::jsonb);
 elsif operation='history' then
  -- A private draft must not become readable just because its ID was guessed.
  if not exists(select 1 from fluqon_community.revisions where offer_id=payload->>'id') then return jsonb_build_object('error','No public history for this offer.','status',404);end if;
  return jsonb_build_object('revisions',coalesce((select jsonb_agg(x order by x.revision desc) from
   (select r.revision,r.parent_revision,r.created_at,r.redacted,
    case when r.redacted then '[removed]' else r.author_handle end as author_handle,
    case when r.redacted then 'Content removed by a maintainer.' else r.summary end as summary,
    case when r.redacted then null else r.snapshot end as snapshot,
    case when r.redacted then null else r.source_url end as source_url,
    case when r.redacted then null else r.check_method end as check_method,
    case when r.redacted then null else r.checked_at end as checked_at
    from fluqon_community.revisions r where r.offer_id=payload->>'id' order by r.revision desc limit 50) x),'[]'),
   'notes',coalesce((select jsonb_agg(x order by x.created_at) from
    (select t.id,t.body,t.created_at,cm.handle from fluqon_community.notes t join fluqon_community.members cm on cm.user_id=t.author_id
     where t.offer_id=payload->>'id' and t.status='approved' order by t.created_at desc limit 50) x),'[]'));
 end if;
 -- Recheck the accepted JWT's session inside the same RPC as each protected operation.
 operator_access:=operator_access is true;
 if operator_access is not true then
  if actor_id is null or jsonb_typeof(payload->'_session_id') is distinct from 'string' or
   (payload->>'_session_id')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
   return jsonb_build_object('error','Your contributor session ended. Sign in again.','status',401);end if;
  if not exists(select 1 from auth.sessions a where a.id=(payload->>'_session_id')::uuid and a.user_id=actor_id
   and (a.not_after is null or a.not_after>clock_timestamp())) then
   return jsonb_build_object('error','Your contributor session ended. Sign in again.','status',401);end if;
 end if;
 -- Never persist the session identifier in contribution content or audit payloads.
 payload:=payload-'_session_id';
 if actor_id is not null then select * into m from fluqon_community.members where user_id=actor_id;end if;
 if not operator_access and actor_id is null then return jsonb_build_object('error','Sign in to contribute.','status',401);end if;
 if not operator_access and coalesce(m.blocked,false) then return jsonb_build_object('error','Contributions are paused for this account.','status',403);end if;
 label:=case when operator_access then 'operator' else m.handle end;
 can_review:=operator_access or coalesce(m.role in ('reviewer','maintainer'),false);
 if operation='profile' then
  if actor_id is null or payload->>'terms_version'<>'community-v1' or (payload->>'consent') is distinct from 'true' then return jsonb_build_object('error','Accept the contributor terms.','status',400);end if;
  if not exists(select 1 from fluqon_community.members where user_id=actor_id) then
   if lower(payload->>'handle') in ('operator','admin','maintainer','moderator','system','fluqon','deleted') then return jsonb_build_object('error','Choose another public name.','status',400);end if;
   insert into fluqon_community.members(user_id,handle,terms_version) values(actor_id,lower(payload->>'handle'),'community-v1');
  end if;
  return jsonb_build_object('ok',true,'message','Contributor profile ready.');
 elsif operation='me' then
  return jsonb_build_object('member',case when m.user_id is null then null else jsonb_build_object('handle',m.handle,'role',m.role) end,
   'proposals',coalesce((select jsonb_agg(x order by x.created_at desc) from (select id,offer_id,base_revision,snapshot,source_url,summary,status,review_note,created_at from fluqon_community.proposals where author_id=actor_id order by created_at desc limit 40)x),'[]'));
 elsif operation='draft' then
  select * into o from fluqon_private.offers where id=payload->>'id';
  if not found or not exists(select 1 from fluqon_community.revisions where offer_id=o.id and revision=o.revision and not redacted) then return jsonb_build_object('error','No public offer to edit.','status',404);end if;
  if exists(select 1 from fluqon_community.revisions where offer_id=o.id and revision=o.revision and redacted) then return jsonb_build_object('error','This revision is not available for editing.','status',403);end if;
  return jsonb_build_object('offer',fluqon_community.snapshot(o),'revision',o.revision,'state',o.status);
 elsif operation='submit' then
  if m.user_id is null then return jsonb_build_object('error','Create your contributor profile first.','status',403);end if;
  if client_bucket!~'^[a-f0-9]{64}$' then return jsonb_build_object('error','Invalid request.','status',400);end if;
  insert into fluqon_private.request_limits(bucket,kind,window_at,total) values(client_bucket,'community',date_trunc('hour',now()),1)
   on conflict(bucket,kind,window_at) do update set total=fluqon_private.request_limits.total+1 returning total into n;
  if n>10 then return jsonb_build_object('error','Contribution limit reached. Try later.','status',429);end if;
  perform pg_advisory_xact_lock(hashtextextended('community-author:'||actor_id::text,0));
  -- Account-level limits also apply when the contributor changes networks.
  if (select count(*) from fluqon_community.proposals where author_id=actor_id and created_at>now()-interval '1 hour')>=10 then return jsonb_build_object('error','Contribution limit reached. Try later.','status',429);end if;
  s:=payload->'offer';
  if s is null or jsonb_typeof(s)<>'object' or s->>'id'!~'^[a-z0-9][a-z0-9-]{2,59}$' or (payload->>'source_url')!~'^https://[^[:space:]]+$'
   or (s->>'merchant_url')!~'^https://[^[:space:]]+$' or length(payload->>'summary') not between 10 and 500 then return jsonb_build_object('error','Check the contribution fields.','status',400);end if;
  if exists(select 1 from jsonb_object_keys(s) k where k not in ('id','retailer','department','category','title','description','discount','code','merchant_url','conditions','expires_at','glitch','affiliate','referral_beneficiary','referral_reward')) then return jsonb_build_object('error','This field cannot be changed here.','status',400);end if;
  if (s->>'affiliate')::boolean or coalesce(s->>'referral_beneficiary','')<>'' or coalesce(s->>'referral_reward','')<>'' then
   if length(coalesce(s->>'referral_beneficiary','')) not between 1 and 120 or length(coalesce(s->>'referral_reward','')) not between 1 and 300 then return jsonb_build_object('error','Disclose the referral beneficiary and reward.','status',400);end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('community:'||(s->>'id'),0));
  select revision into current_revision from fluqon_private.offers where id=s->>'id';
  if coalesce(current_revision,0)<>(payload->>'base_revision')::integer then return jsonb_build_object('error','This offer changed. Load its latest revision before submitting.','status',409);end if;
  if current_revision is not null and not exists(select 1 from fluqon_community.revisions where offer_id=s->>'id') then return jsonb_build_object('error','This offer is not available for community editing.','status',403);end if;
  insert into fluqon_community.proposals(offer_id,base_revision,snapshot,source_url,summary,author_id)
   values(s->>'id',(payload->>'base_revision')::integer,s,payload->>'source_url',payload->>'summary',actor_id) returning id into v;
  return jsonb_build_object('ok',true,'reference',v,'message','Submitted for review. The live offer is unchanged.');
 elsif operation='withdraw' then
  update fluqon_community.proposals set status='withdrawn',reviewed_at=now() where id=(payload->>'id')::uuid and author_id=actor_id and status='pending';
  if not found then return jsonb_build_object('error','Pending contribution not found.','status',404);end if;
  return jsonb_build_object('ok',true,'message','Contribution withdrawn.');
 elsif operation='note' then
  if m.user_id is null or (select count(*) from fluqon_community.notes where author_id=actor_id and created_at>now()-interval '1 hour')>=5 then return jsonb_build_object('error','Discussion limit reached or profile required.','status',429);end if;
  if not exists(select 1 from fluqon_community.revisions where offer_id=payload->>'offer_id') then return jsonb_build_object('error','Offer not found.','status',404);end if;
  insert into fluqon_community.notes(offer_id,author_id,body) values(payload->>'offer_id',actor_id,payload->>'body');
  return jsonb_build_object('ok',true,'message','Note submitted for review.');
 end if;
 if not can_review then return jsonb_build_object('error','Reviewer access required.','status',403);end if;
 if operation='queue' then
  return jsonb_build_object('proposals',coalesce((select jsonb_agg(x order by x.created_at) from
   (select cp.*,cm.handle,coalesce(co.revision,0) as current_revision,case when co.id is null then '{}'::jsonb else fluqon_community.snapshot(co) end as current
    from fluqon_community.proposals cp join fluqon_community.members cm on cm.user_id=cp.author_id left join fluqon_private.offers co on co.id=cp.offer_id
    where cp.status='pending' order by cp.created_at limit 100)x),'[]'),
   'notes',coalesce((select jsonb_agg(x order by x.created_at) from (select t.id,t.offer_id,t.body,t.created_at,cm.handle from fluqon_community.notes t join fluqon_community.members cm on cm.user_id=t.author_id where t.status='pending' order by t.created_at limit 100)x),'[]'),
   'members',case when operator_access or m.role='maintainer' then coalesce((select jsonb_agg(jsonb_build_object('handle',x.handle,'role',x.role,'blocked',x.blocked)) from (select * from fluqon_community.members order by created_at desc limit 100)x),'[]') else '[]'::jsonb end);
 elsif operation='member' then
  if not operator_access then return jsonb_build_object('error','Owner key required to change contributor access.','status',403);end if;
  if payload->>'role' not in ('contributor','reviewer','maintainer') or jsonb_typeof(payload->'blocked')<>'boolean' then return jsonb_build_object('error','Choose valid access settings.','status',400);end if;
  update fluqon_community.members set role=payload->>'role',blocked=(payload->>'blocked')::boolean where handle=payload->>'handle';
  if not found then return jsonb_build_object('error','Contributor not found.','status',404);end if;
  insert into fluqon_private.audit_log(event,entity,details) values('community_access_changed',payload->>'handle',payload);
  return jsonb_build_object('ok',true,'message','Contributor access updated.');
 elsif operation='moderate_note' then
  if payload->>'status' not in ('approved','hidden') then return jsonb_build_object('error','Choose a valid decision.','status',400);end if;
  update fluqon_community.notes set status=payload->>'status' where id=(payload->>'id')::uuid;
  if not found then return jsonb_build_object('error','Note not found.','status',404);end if;
  insert into fluqon_private.audit_log(event,entity,details) values('community_note_reviewed',payload->>'id',jsonb_build_object('decision',payload->>'status','reviewer',label));
  return jsonb_build_object('ok',true,'message','Discussion review saved.');
 elsif operation='redact' then
  if not (operator_access or m.role='maintainer') then return jsonb_build_object('error','Maintainer access required.','status',403);end if;
  if length(coalesce(payload->>'reason',''))<10 then return jsonb_build_object('error','Record a private reason.','status',400);end if;
  update fluqon_community.revisions set redacted=true where offer_id=payload->>'id' and revision=(payload->>'revision')::integer;
  if not found then return jsonb_build_object('error','Revision not found.','status',404);end if;
  update fluqon_private.offers set status='paused',checked_at=null where id=payload->>'id' and revision=(payload->>'revision')::integer;
  insert into fluqon_private.audit_log(event,entity,details) values('community_revision_redacted',payload->>'id',jsonb_build_object('revision',payload->'revision','reason',payload->>'reason','reviewer',label));
  return jsonb_build_object('ok',true,'message','Revision removed from public history. Current matching offer paused.');
 elsif operation='review' then
  select * into p from fluqon_community.proposals where id=(payload->>'id')::uuid for update;
  if not found then return jsonb_build_object('error','Contribution not found.','status',404);end if;
  if p.status<>'pending' then return jsonb_build_object('error','This contribution has already been reviewed.','status',409);end if;
  if length(coalesce(payload->>'review_note','')) not between 10 and 1000 then return jsonb_build_object('error','Add a useful review note.','status',400);end if;
  if payload->>'decision'='reject' then
   update fluqon_community.proposals set status='rejected',review_note=payload->>'review_note',reviewer=label,reviewed_at=now() where id=p.id;
   return jsonb_build_object('ok',true,'message','Contribution rejected. The live offer is unchanged.');
  end if;
  if payload->>'decision'<>'approve' then return jsonb_build_object('error','Choose approve or reject.','status',400);end if;
  if not operator_access and p.author_id=actor_id then return jsonb_build_object('error','Another reviewer must check your contribution.','status',403);end if;
  if exists(select 1 from fluqon_community.members where user_id=p.author_id and blocked) then return jsonb_build_object('error','This contributor is blocked. Reject or investigate the proposal.','status',403);end if;
  perform pg_advisory_xact_lock(hashtextextended('community:'||p.offer_id,0));
  select * into o from fluqon_private.offers where id=p.offer_id for update;
  current_revision:=coalesce(o.revision,0);
  if current_revision<>p.base_revision then return jsonb_build_object('error','Revision conflict. This proposal must be rebased and resubmitted.','status',409);end if;
  if not operator_access and m.role<>'maintainer' and
   ((p.snapshot->>'merchant_url') is distinct from o.merchant_url or
    (p.snapshot->>'referral_beneficiary') is distinct from coalesce((select beneficiary from fluqon_community.referrals where offer_id=p.offer_id),'') or
    (p.snapshot->>'referral_reward') is distinct from coalesce((select reward from fluqon_community.referrals where offer_id=p.offer_id),'')) then
   return jsonb_build_object('error','A maintainer must review retailer or referral-link changes.','status',403);end if;
  if payload->>'method' not in ('merchant','checkout') or length(coalesce(payload->>'evidence','')) not between 15 and 2500 or (payload->>'source_url')!~'^https://[^[:space:]]+$' then return jsonb_build_object('error','Record the actual source, method and evidence.','status',400);end if;
  if (p.snapshot->>'expires_at')::timestamptz<=now() then return jsonb_build_object('error','This offer has expired.','status',400);end if;
  if (p.snapshot->>'glitch')::boolean and payload->>'method'<>'checkout' then return jsonb_build_object('error','Glitches require a checkout check.','status',400);end if;
  -- Any failure raises inside this transaction: no partial accepted edit or invalid published offer.
  result:=public.fluqon_gateway(gateway_hash,'save_offer',p.snapshot-'referral_beneficiary'-'referral_reward','');
  if result ? 'error' then raise exception using message=result->>'error',errcode='P0001';end if;
  insert into fluqon_community.referrals(offer_id,beneficiary,reward) values(p.offer_id,p.snapshot->>'referral_beneficiary',p.snapshot->>'referral_reward')
   on conflict(offer_id) do update set beneficiary=excluded.beneficiary,reward=excluded.reward;
  result:=public.fluqon_gateway(gateway_hash,'check_offer',jsonb_build_object('id',p.offer_id,'result','working','method',payload->>'method','source_url',payload->>'source_url','evidence',payload->>'evidence','reviewer',label),'');
  if result ? 'error' then raise exception using message=result->>'error',errcode='P0001';end if;
  result:=public.fluqon_gateway(gateway_hash,'publish_offer',jsonb_build_object('id',p.offer_id),'');
  if result ? 'error' then raise exception using message=result->>'error',errcode='P0001';end if;
  select * into o from fluqon_private.offers where id=p.offer_id;
  insert into fluqon_community.revisions(offer_id,revision,parent_revision,snapshot,source_url,author_handle,summary,check_method,checked_at)
   values(o.id,o.revision,p.base_revision,fluqon_community.snapshot(o),payload->>'source_url',(select handle from fluqon_community.members where user_id=p.author_id),p.summary,o.check_method,o.checked_at)
   on conflict(offer_id,revision) do update set parent_revision=excluded.parent_revision,snapshot=excluded.snapshot,source_url=excluded.source_url,author_handle=excluded.author_handle,summary=excluded.summary,check_method=excluded.check_method,checked_at=excluded.checked_at;
  update fluqon_community.proposals set status='approved',review_note=payload->>'review_note',reviewer=label,reviewed_at=now() where id=p.id;
  return jsonb_build_object('ok',true,'message','Checked revision published.','revision',o.revision);
 end if;
 return jsonb_build_object('error','Unknown community operation.','status',400);
exception when unique_violation then return jsonb_build_object('error','This public name or revision is already in use.','status',409);
 when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format or numeric_value_out_of_range or foreign_key_violation then return jsonb_build_object('error','Check the contribution fields.','status',400);
 when sqlstate 'P0001' then return jsonb_build_object('error',sqlerrm,'status',400);
end;$function$;

commit;
