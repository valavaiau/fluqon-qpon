create schema subscriber_private;
revoke all on schema subscriber_private from public, anon, authenticated;
grant usage on schema subscriber_private to service_role;
create table subscriber_private.subscribers (
 id uuid primary key default gen_random_uuid(),
 email text not null unique check(email = lower(btrim(email)) and length(email) between 3 and 254 and position('@' in email)>1),
 status text not null default 'pending' check(status in ('pending','active','unsubscribed')),
 created_at timestamptz not null default now(),
 consent_at timestamptz not null,
 consent_version text not null,
 confirmed_at timestamptz,
 unsubscribed_at timestamptz,
 check(status <> 'active' or confirmed_at is not null),
 check(status <> 'unsubscribed' or unsubscribed_at is not null)
);
create table subscriber_private.consent_events (
 id uuid primary key default gen_random_uuid(),
 subscriber_id uuid not null references subscriber_private.subscribers(id) on delete cascade,
 event text not null check(event in ('requested','confirmed','unsubscribed')),
 consent_version text not null,
 consent_text text not null,
 occurred_at timestamptz not null default now()
);
create index consent_events_subscriber_time_idx on subscriber_private.consent_events(subscriber_id, occurred_at);
create table subscriber_private.subscription_tokens (
 token_hash text primary key check(token_hash ~ '^[0-9a-f]{64}$'),
 subscriber_id uuid not null references subscriber_private.subscribers(id) on delete cascade,
 purpose text not null check(purpose in ('confirm','unsubscribe')),
 created_at timestamptz not null default now(),
 expires_at timestamptz,
 consumed_at timestamptz,
 check(purpose <> 'confirm' or expires_at is not null),
 check(expires_at is null or expires_at > created_at)
);
create index subscription_tokens_subscriber_idx on subscriber_private.subscription_tokens(subscriber_id);
alter table subscriber_private.subscribers enable row level security;
alter table subscriber_private.consent_events enable row level security;
alter table subscriber_private.subscription_tokens enable row level security;
revoke all on all tables in schema subscriber_private from public, anon, authenticated;
grant select,insert,update,delete on all tables in schema subscriber_private to service_role;
alter default privileges in schema subscriber_private revoke all on tables from public, anon, authenticated;
comment on schema subscriber_private is 'Private alert subscriber data. No browser or authenticated-user access. Server-only; not a Data API schema.';

