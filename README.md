# fluqon.qpon community edition

Fluke on Coupon. Australian offers, clear conditions and an accountable edit history.

This is the public source for fluqon.qpon and its community contribution release candidate. The community editor is not yet deployed to the existing site. Contributor sign-in stays closed until real authentication and deployment checks pass. No production secrets, customer records or private reports belong in this repository.

Code contributions are welcome through [pull requests](https://github.com/valavaiau/fluqon-qpon/pulls). The maintainer reviews changes before merging; repository contributions never deploy themselves.

Software is licensed under **AGPL-3.0-only** (LICENSE). Eligible original offer contributions use **CC BY-SA 4.0** (CONTENT-LICENSE). Brand artwork and names have separate reserved rights in BRAND-RIGHTS.md. See LICENSE-DECISION.md for the scope; third-party rights stay with their holders.

## Run it locally

Use Node 24, Python 3 and pnpm 11.25.0:

    pnpm install --frozen-lockfile --ignore-scripts
    pnpm test
    python3 scripts/build-community-pages.py
    python3 server/build.py
    pnpm preview

Open the printed loopback URL. The preview uses disposable PostgreSQL-in-WebAssembly, fake contributor identities and clearly labelled fixture offers. It makes no provider calls and sends no emails. Its fixture key is for that local process only. Never deploy scripts/preview.mjs or its simulated identity adapter. Dependencies and preview support are development-only.

## Contribute without changing the live offer

1. Sign in and select a public name (real provider authentication is disabled until configured).
2. Add an offer or load its latest accepted revision.
3. Supply the merchant source, conditions, expiry and change summary. Disclose every referral beneficiary and reward.
4. A reviewer compares fields and records an actual merchant or checkout check.
5. Acceptance publishes a new revision atomically. Conflicts must be resubmitted against the latest revision.

Public history shows accepted content, sources, pseudonyms and recorded check methods. It never exposes subscriber records, private verification evidence, emails or network identifiers. Historical prices are not current offers. Restoring an earlier revision creates a new reviewed proposal.

Reading, copying codes and local saves remain account-free. Contributor sessions use Secure, HttpOnly, SameSite cookies. Roles are assigned server-side; ordinary contributors cannot publish, grant access or read private queues. The owner can use the existing operator key in tab memory. The review desk locks after 15 minutes idle.

## Layout

- `dist/`: static interface and generated Pages worker; community, review, history and rules pages.
- `server/community-policy.mjs`: input boundaries and field comparisons.
- `server/community.mjs`: same-origin gateway, real email-code authentication and session handling.
- `server/worker.mjs`, `server/brevo.mjs`: existing checked-feed/report/mail gateway sources.
- `server/edge.ts`: Supabase Edge gateway; service credentials stay in its environment.
- `database/community.sql`: staged private schema/RPC extension; deliberately not applied to production.
- `supabase/migrations/`: previous foundation migrations. Do not recreate populated production schemas.
- `tests/`: real local PostgreSQL workflow tests and gateway/provider contract tests.
- `docs/`: configuration, security boundaries, release and restore procedure.

Run `pnpm check:release` before packaging and `node scripts/check-release.mjs --public` before public publication. Public source release is approved; production contributor authentication and deployment remain separate gates. The package is marked private to avoid accidental registry publication. Regenerating prebuilt icons is optional and requires a separately pinned local `sharp` installation; normal operation/tests do not need it.

See CONTRIBUTING.md, SECURITY.md and docs/RELEASE.md. Preserve the separate wordmark/f icon, referral disclosure and no-tracking brand. Keep marketing collection closed until its independent acceptance tests pass.
