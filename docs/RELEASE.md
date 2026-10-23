# Release and recovery

## Source release acceptance

1. Preserve the current live source, deployment identity and a restricted database backup. The working candidate is isolated from production.
2. Install locked dependencies without lifecycle scripts, run tests and build both static pages and the Pages worker.
3. Check contributor submission, mobile review/diff, conflict refusal, owner role control, public attribution, discussion moderation, redaction and restore-as-new-proposal in the loopback fixture preview. Do not call simulated authentication real email acceptance.
4. Public source release under AGPL-3.0-only / CC BY-SA 4.0 with reserved brand rights was approved on 23 October 2026. GitHub account access is verified as valavaiau. Preserve these notices and run the public source checks before publication. Contributor registration and production rollout remain separate gates.

## Production integration — not executed by preparation

Use the existing Cloudflare Pages/Supabase project; no upgrade or new paid environment is authorised. Read the latest production metadata before deployment to avoid overwriting a newer release.

The existing foundation migrations must already exist. Apply database/community.sql once using the project’s controlled migration procedure after a fresh backup. Do not apply it over an existing community schema. Review the actual schema and security advisors first. Its public RPC is executable only by service_role and checks the gateway hash; do not grant anonymous table/RPC access.

Deploy server/edge.ts with the existing gateway authentication intact. Preserve its service-role secret and the existing API_GATEWAY_KEY. Build the Pages worker from all four source modules; do not hand-edit only dist/_worker.js.

Set BACKEND_URL, SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY for the actual project. Preserve ADMIN_KEY_HASH, Turnstile bindings and existing mail settings. PUBLIC_ORIGIN is the canonical URL; PREVIEW_ORIGIN, if used, is an explicitly approved exact origin. No broad wildcard origins.

Keep COMMUNITY_ENABLED, COMMUNITY_AUTH_ENABLED and COMMUNITY_LICENCE_ACCEPTED false until the corresponding acceptance is complete. Final contributor terms must be published before setting licence acceptance true. Configure Supabase’s email-code template and existing permitted sending service, redirect/site settings and provider rate limits; complete a real sign-in, refresh, logout and blocked-account test. Do not assume the free default email sender supports public onboarding. A sending-service limitation is a launch blocker for sign-in, not permission to buy an upgrade.

Before opening the pilot: test the real gateway identity, denied direct database access, origin checks, Turnstile, secure cookies, expiry, replay/rate handling, actual contributor identity and owner-key moderation. Public history must exclude private drafts, evidence, emails and subscriber data. Test referral disclosures in feed and detail pages. Test a stale/conflicting edit and restore. Marketing flags remain separate and closed until their independent lifecycle passes.

Require protected code review/status checks and an isolated preview for repository contributions. No deployment secrets in pull-request jobs. CODEOWNERS names @valavaiau. The public repository is https://github.com/valavaiau/fluqon-qpon; creating it does not deploy the community editor. Record actual branch-protection and CI acceptance in the release receipt before claiming those controls are active.

The prepared workflow skips private repositories. Do not enable billable runners, paid security features, metered preview services or automatic deployment. No purchase or upgrade is authorised.

## Recovery

First close COMMUNITY_ENABLED and COMMUNITY_AUTH_ENABLED to stop new community activity without stopping the existing offer feed. Preserve reports and edits for investigation. Restore the previous Pages/Edge versions if needed. Do not drop the community schema as a default rollback: accepted revisions, attribution and moderation records must be preserved. A database restore requires a fresh copy of the current state and an owner-approved recovery plan.

Record the actual migration/deployment identities, acceptance results and restore exercise privately. No full live restore or production rollout has yet been performed for this candidate.
