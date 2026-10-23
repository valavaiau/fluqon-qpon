create extension if not exists pg_cron with schema pg_catalog;
create or replace function fluqon_private.maintain() returns void language plpgsql security definer set search_path='' as $$
begin
 delete from fluqon_private.request_limits where window_at<now()-interval '48 hours';
 delete from fluqon_private.reports where status in ('resolved','dismissed') and resolved_at<now()-interval '90 days';
 delete from subscriber_private.subscription_tokens where purpose='confirm' and expires_at<now()-interval '7 days';
 delete from subscriber_private.subscribers where status='pending' and consent_at<now()-interval '30 days';
end;$$;
revoke all on function fluqon_private.maintain() from public,anon,authenticated,service_role;
select cron.schedule('fluqon-data-retention','17 * * * *','select fluqon_private.maintain();');
