# Release and recovery

## Source release acceptance

1. Preserve the current live source, deployment identity and a restricted database backup. The working candidate is isolated from production.
2. Install locked dependencies without lifecycle scripts, run tests and build both static pages and the Pages worker.
3. Check contributor submission, mobile review/diff, conflict refusal, owner role control, public attribution, discussion moderation, redaction and restore-as-new-proposal in the loopback fixture preview. Do not call simulated authentication real email acceptance.
4. Public source release under AGPL-3.0-only / CC BY-SA 4.0 with reserved brand rights was approved on 23 October 2026. GitHub account access is verified as valavaiau. Preserve these notices and run the public source checks before publication. Contributor registration and production rollout remain separate gates.

## Production integration — confirm existing state before changes

Use the existing Cloudflare Pages/Supabase project; no upgrade or new paid environment is authorised. Read the latest production metadata before deployment to avoid overwriting a newer release.

The existing operating record reports community_pilot migration 20261023183300 applied and Edge gateway version 2 deployed. Preserve that completed work; verify the actual current schema/version before changing it. Do not reapply database/community.sql over the existing community schema. A genuinely new environment needs the foundation migrations and a controlled, backed-up migration; this continuation does not authorise another production migration. Review the actual schema and security advisors before any later change. Its public RPC is executable only by service_role and checks the gateway hash; do not grant anonymous table/RPC access.

Deploy server/edge.ts with the existing gateway authentication intact. Preserve its service-role secret and the existing API_GATEWAY_KEY. Build the Pages worker from all four source modules; do not hand-edit only dist/_worker.js.

Set BACKEND_URL, SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY for the actual project. Preserve ADMIN_KEY_HASH, Turnstile bindings and existing mail settings. PUBLIC_ORIGIN is the canonical URL; PREVIEW_ORIGIN, if used, is an explicitly approved exact origin. No broad wildcard origins.

Keep COMMUNITY_ENABLED, COMMUNITY_AUTH_ENABLED and COMMUNITY_LICENCE_ACCEPTED false until the corresponding acceptance is complete. Final contributor terms must be published before setting licence acceptance true. The 24 October operating record reports the dedicated Brevo SMTP sender and numeric-code templates configured, with provider delivery, code verification, refresh and logout passed. Preserve existing keys and resolved account access; do not recreate them because an older task list still says pending. Recheck current nonsecret settings, exact site/redirect origins and provider limits before further changes. The deployed Pages gateway, secure-cookie/session path, blocked-account and complete application acceptance remain open; the restricted provider check does not establish them. A sending-service limitation is a launch blocker for sign-in, not permission to buy an upgrade.

Verify the provider and overseas-processing statements on the privacy page against the actual pilot configuration. Use the restricted manual [account and retention procedure](COMMUNITY-PRIVACY.md) for contributor privacy requests. It is separate from the existing automatic report/subscriber cleanup and does not claim automatic community-account deletion.

Before opening the pilot: test the real gateway identity, denied direct database access, origin checks, Turnstile, secure cookies, expiry, replay/rate handling, actual contributor identity and owner-key moderation. Public history must exclude private drafts, evidence, emails and subscriber data. Test referral disclosures in feed and detail pages. Test a stale/conflicting edit and restore. Marketing flags remain separate and closed until their independent lifecycle passes.

Require protected code review/status checks and an isolated preview for repository contributions. No deployment secrets in pull-request jobs. CODEOWNERS names @valavaiau. The public repository is https://github.com/valavaiau/fluqon-qpon; creating it does not deploy the community editor. Record actual branch-protection and CI acceptance in the release receipt before claiming those controls are active.

The prepared workflow skips private repositories. Do not enable billable runners, paid security features, metered preview services or automatic deployment. No purchase or upgrade is authorised.

## Session and review acceptance

Local regression tests cover active, expired-access and refresh-only sign-out, provider refusal/outage, cookie clearing and an authenticated visitor who has not created a contributor profile. They use synthetic transport and do not replace the real Pages acceptance above. A confirmed cookie-clearing response removes the local signed-in interface even if provider revocation failed; a network failure does not claim that the browser session ended.

Supabase sign-out revokes the refresh session; an already issued access JWT can remain valid until expiry. The current gateway validates the user through the Auth service but does not explicitly compare the token's session_id with auth.sessions. Do not claim immediate replay denial from a successful logout response. Test the real session after revocation and expiry before opening the pilot; if the required denial is not enforced, keep the pilot closed until a session-bound check is implemented and verified. See the [Supabase session guide](https://supabase.com/docs/guides/auth/sessions) and [sign-out reference](https://supabase.com/docs/reference/javascript/auth-signout).

Keep approval claims precise: contributor/reviewer sessions cannot approve their own proposals, while the privileged owner-key path bypasses that actor comparison. Current SQL permits a maintainer or the owner-key path to approve merchant/referral changes. These are existing access rules, not a new role grant or an owner-only referral guarantee. Include both cases in deployed role acceptance. GitHub's independent protected-review requirements remain separate and cannot be bypassed.

## Recovery

First close COMMUNITY_ENABLED and COMMUNITY_AUTH_ENABLED to stop new community activity without stopping the existing offer feed. Preserve reports and edits for investigation. Restore the previous Pages/Edge versions if needed. Do not drop the community schema as a default rollback: accepted revisions, attribution and moderation records must be preserved. A database restore requires a fresh copy of the current state and an owner-approved recovery plan.

Record the actual migration/deployment identities, acceptance results and restore exercise privately. No full live restore or accepted website/community rollout has been established for this candidate. Backend preparation and provider-only checks remain distinct from application acceptance.
