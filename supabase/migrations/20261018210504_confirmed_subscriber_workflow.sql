create or replace function fluqon_private.subscription_action(operation text,payload jsonb,client_bucket text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s subscriber_private.subscribers;t subscriber_private.subscription_tokens;v_email text;v_token text;v_hash text;v_count integer;
begin
 if operation='email_sync_failed' then
  insert into fluqon_private.email_sync_failures(email) values(payload->>'email') on conflict(email) do update set resolved_at=null;return jsonb_build_object('ok',true);
 elsif operation='provider_unsubscribe' then
  update subscriber_private.subscribers set status='unsubscribed',unsubscribed_at=now() where email=lower(payload->>'email') returning * into s;
  if found then insert into subscriber_private.consent_events(subscriber_id,event,consent_version,consent_text) values(s.id,'unsubscribed',s.consent_version,'Unsubscribed through the email provider.');end if;
  return jsonb_build_object('ok',true);
 elsif operation='subscribe' then
  v_email:=lower(btrim(payload->>'email'));
  if payload->>'consent'<>'true' or payload->>'consent_version'<>'2026-10-19' or v_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(v_email)>254 or client_bucket!~'^[a-f0-9]{64}$' then return jsonb_build_object('error','Add a valid email and confirm your consent.');end if;
  delete from fluqon_private.request_limits where window_at<now()-interval '48 hours';
  insert into fluqon_private.request_limits(bucket,kind,window_at,total) values(client_bucket,'subscribe',date_trunc('hour',now()),1) on conflict(bucket,kind,window_at) do update set total=fluqon_private.request_limits.total+1 returning total into v_count;
  if v_count>3 then return jsonb_build_object('error','Try again later.','status',429);end if;
  perform pg_advisory_xact_lock(hashtextextended(v_email,0));
  select * into s from subscriber_private.subscribers where email=v_email for update;
  if found and (s.status='active' or s.consent_at>now()-interval '10 minutes') then return jsonb_build_object('ok',true,'message','If confirmation is needed, check your inbox. No alerts until you confirm.');end if;
  insert into subscriber_private.subscribers(email,consent_at,consent_version) values(v_email,now(),'2026-10-19') on conflict(email) do update set status='pending',consent_at=now(),consent_version=excluded.consent_version,confirmed_at=null,unsubscribed_at=null returning * into s;
  insert into subscriber_private.consent_events(subscriber_id,event,consent_version,consent_text) values(s.id,'requested','2026-10-19','Email me Australian deals from fluqon.qpon. I can unsubscribe at any time.');
  delete from subscriber_private.subscription_tokens where subscriber_id=s.id and purpose='confirm';
  v_token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  v_hash:=encode(sha256(convert_to(v_token,'UTF8')),'hex');
  insert into subscriber_private.subscription_tokens(token_hash,subscriber_id,purpose,expires_at) values(v_hash,s.id,'confirm',now()+interval '24 hours');
  return jsonb_build_object('ok',true,'confirmToken',v_token);
 elsif operation in ('confirm','unsubscribe') then
  if payload->>'token'!~'^[a-f0-9]{64}$' then return jsonb_build_object('error','This link is invalid.');end if;
  v_hash:=encode(sha256(convert_to(payload->>'token','UTF8')),'hex');
  select * into t from subscriber_private.subscription_tokens where token_hash=v_hash and purpose=operation for update;
  if not found or (t.expires_at is not null and t.expires_at<now()) then return jsonb_build_object('error','This link has expired. Request a fresh one.');end if;
  select * into s from subscriber_private.subscribers where id=t.subscriber_id for update;
  if operation='confirm' then
   if s.status='unsubscribed' or (t.consumed_at is not null and s.status<>'active') then return jsonb_build_object('error','This confirmation is no longer current.');end if;
   if t.consumed_at is null then
    update subscriber_private.subscribers set status='active',confirmed_at=now(),unsubscribed_at=null where id=s.id;
    update subscriber_private.subscription_tokens set consumed_at=now() where token_hash=v_hash;
    insert into subscriber_private.consent_events(subscriber_id,event,consent_version,consent_text) values(s.id,'confirmed',s.consent_version,'Email address confirmed through a single-use confirmation link.');
   end if;
   return jsonb_build_object('ok',true,'email',s.email);
  else
   if s.status<>'unsubscribed' then
    update subscriber_private.subscribers set status='unsubscribed',unsubscribed_at=now() where id=s.id;
    insert into subscriber_private.consent_events(subscriber_id,event,consent_version,consent_text) values(s.id,'unsubscribed',s.consent_version,'Unsubscribed through an email link.');
   end if;
   update subscriber_private.subscription_tokens set consumed_at=coalesce(consumed_at,now()) where token_hash=v_hash;
   return jsonb_build_object('ok',true,'email',s.email);
  end if;
 end if;
 return jsonb_build_object('error','Unknown operation');
end; $$;
revoke all on function fluqon_private.subscription_action(text,jsonb,text) from public,anon,authenticated,service_role;
