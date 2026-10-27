# Configuration boundaries

Use .env.example as a list of names, never as live values. The public app talks only to its same-origin Pages gateway. The browser receives no Supabase bearer tokens or private keys. Auth access/refresh tokens are held in Secure, HttpOnly, SameSite cookies; logout clears both, with provider logout attempted when connected.

The community frontend needs no external application library. Supabase’s actual email-code API validates contributor identity; the server reads the user from the provider and requires a confirmed, non-anonymous account. Public handles and roles live in the private community schema. Browser-submitted role, actor ID, status and verification flags are not trusted.

COMMUNITY_ENABLED and COMMUNITY_LICENCE_ACCEPTED must both be true before community API access opens. COMMUNITY_AUTH_ENABLED additionally controls contributor email authentication. The default is closed. Marketing SIGNUP_ENABLED and EMAIL_DELIVERY_TESTED are entirely separate; never enable them as a side effect of contributor login.

When contributor sign-in is open, Supabase authenticates contributors and the configured Brevo SMTP sender delivers their requested email codes. Use the numeric-code email template and check actual delivery, sign-in, refresh, logout and blocked-account behaviour before opening it. Account requests and private contribution retention use the restricted manual procedure in [COMMUNITY-PRIVACY.md](COMMUNITY-PRIVACY.md); do not assume deleting an Auth user removes community records.

Brevo per-contact pixel-tracking consent is enabled with unknown consent treated as No. Do not request tracking consent as part of contributor sign-in. This turns personal open/click tracking off by default; it does not promise that supplier-inserted measurement images or rewritten links are absent. Brevo still holds delivery records and may perform aggregate delivery measurement. Check actual delivered message content as well as the account settings; see [supplier email measurement](COMMUNITY-PRIVACY.md#supplier-email-measurement).

The existing owner key authenticates the review desk. Its hash is ADMIN_KEY_HASH; the original value stays in the owner’s private configuration. No key is stored in frontend storage or this repository.

API_GATEWAY_KEY identifies the Pages-to-Edge boundary. The Edge function retains its Supabase service role in its own environment and verifies gateway authorisation. Its SQL community RPC also checks the gateway hash and has EXECUTE revoked from PUBLIC, anon and authenticated. A verified contributor identity and the accepted token's session ID are attached server-side. Reserved `_session_id` payload metadata is overwritten by Edge, checked against the private Auth session and removed before contribution/audit handling. No Auth session-table access is granted to the browser. The SQL function’s privileged execution is deliberate and narrowly restricted; do not make it a browser API. This prepared guard needs the controlled replacement and deployed checks in [SESSION-SECURITY.md](SESSION-SECURITY.md) before it can be described as live protection.

No submitted URL is fetched by the community feature. HTTPS syntax and public-host forms are validated, while reviewers inspect sources separately. Any future automated fetching needs its own DNS/IP/redirect controls and bounded response handling; do not treat a syntax check as SSRF protection for a future fetcher.

Production secrets are not needed by CI or the local fixture preview. Do not share the loopback preview on a public tunnel: it deliberately simulates identities for integration testing.
