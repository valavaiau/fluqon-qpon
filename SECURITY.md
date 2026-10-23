# Security reports

Report security issues privately to sayvon@fluqon.qpon. Do not post real credentials, personal records or exploit data in public issues. Include the affected route, impact and a minimal reproduction using your own disposable data. Do not access someone else’s records to demonstrate a fault.

This is a staged candidate. A response-time guarantee, independent penetration test and continuously staffed security service are not claimed.

Backend credentials, subscriber records, raw reports and private verification evidence are never public contribution material. Contributor roles are not accepted from browser fields or editable user metadata. Authentication is verified with the provider before acting as a contributor. Supabase private tables deny direct visitor/authenticated access; the Edge RPC requires a privileged server identity and a separate gateway credential.

Preview fixtures and keys are disposable and run on loopback only. The preview adapter must not be deployed. CI receives no application secrets for untrusted changes. Do not enable `pull_request_target` with untrusted checkout/build code. Store production secrets only in the host’s encrypted bindings.
