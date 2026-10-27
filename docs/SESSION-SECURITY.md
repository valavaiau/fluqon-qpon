# Contributor session guard

This is a prepared source change. No production migration, Edge deployment, Pages deployment, account creation, provider email test or feature-flag opening is included. Keep the pilot closed until the complete deployed application passes acceptance and the owner approves release.

## Trust boundary

Pages sends the exact access-cookie token to Supabase Auth. Only after Auth accepts it and confirms a non-anonymous email account does Pages decode its top-level claims. The subject must match the returned user UUID, and session_id must be a canonical UUID. Decoding is not signature validation; a decoded token alone never authenticates a request. User metadata and submitted actor/session/role fields do not provide authority.

The authenticated Pages-to-Edge envelope carries the verified user UUID and session ID separately from contribution fields. Edge overwrites `_session_id` in the payload supplied to the existing six-argument SQL RPC, even if a nested field already exists. No new public API or service credential is introduced.

After the existing public auth-limit, referral and history branches, the SQL gateway normalises operator_access to an explicit boolean. Every non-operator protected operation requires a canonical session UUID and an auth.sessions row whose id and user_id match. A non-null not_after must be later than clock_timestamp() when the guard evaluates. Missing, malformed, revoked, mismatched or expired sessions return 401 before private member reads or contribution mutations. Lookup failures fail closed through the existing generic service error. The reserved field is then removed so session IDs do not enter contribution content or audit payloads.

The owner key remains a separate privileged path. Its existing self-review exception and maintainer/owner referral permissions have not changed. Public history remains a deliberately restricted public projection. No browser role receives Auth table access or privileged RPC execution.

## Prepared replacement

`database/community.sql` is the updated fresh-environment foundation, not an upgrade script for an existing schema. `database/community-session-guard.sql` is the separate incremental replacement prepared from the exact 27 October live function beforeimage. It preserves all existing function body logic apart from the session guard and metadata removal, and preserves the six-argument signature.

The replacement is transactional. Before changing the function it requires the reviewed definition fingerprint, expected postgres ownership, exact service-only function ACL, expected private session column types/nullability, and existing function-owner SELECT access. It changes no table, stored row, Auth setting, role, owner or grant. If any preflight differs, stop and review the current schema/function; do not loosen the preflight or add grants to make it run.

This SQL artifact has not been registered in migration history. The local Supabase CLI was unavailable during preparation; no CLI installation was made. At an approved release, inspect the installed CLI's migration help, create its generated migration entry, and use this reviewed SQL without inventing a filename or replaying earlier migrations. Reconcile existing production migration history first. Do not run a blanket database push.

Keep all community flags false while coordinating the matching Pages, Edge and SQL versions. At an approved release, apply the guarded SQL before the matching Edge bridge and Pages source, then verify the whole chain before opening. Older Pages or Edge versions do not provide the new metadata and will fail closed after the guarded SQL is applied. No compatibility fallback accepts an actor without a checked session.

Retain the exact private function beforeimage and backed-up source/configuration before any approved deployment. A rollback that removes the guard also removes its replay protection: keep the pilot closed and record the decision. Source backups are not evidence that a full live database restore has passed.

## Acceptance boundaries

Local tests use synthetic Auth responses and a private fixture session table. They check all protected route envelopes, forged and malformed claims, same-token replay after a fixture session is deleted, session ownership, expiry during an open transaction, denied direct access, unchanged public/owner paths and failed lookups. They do not prove actual JWT signature validation, provider sign-out behaviour, hosted database privileges or application deployment.

Before opening, test through the actual approved Pages origin with its real Turnstile, secure cookies and gateway. Verify that the same unexpired access token is refused after successful local sign-out, its refresh token cannot renew, and an expired or blocked account cannot contribute. Observe status and session existence without retaining token values, codes or email bodies. Confirm the actual function owner, private Auth schema contract and service-only execution after the approved replacement. Exercise normal contribution, moderation and conflict handling alongside the role and public-history checks in RELEASE.md.

The guard refuses a session missing or expired when its database lookup evaluates and is visible to that transaction. It does not cancel requests already authorised, reverse committed work, or guarantee that a concurrent request cannot finish across sign-out. It checks the stored not_after value; it does not implement paid inactivity or single-session policies. Provider failure during logout still needs its truthful local-only sign-out warning.

Primary references: [Supabase sessions](https://supabase.com/docs/guides/auth/sessions) and [sign-out](https://supabase.com/docs/reference/javascript/auth-signout).
