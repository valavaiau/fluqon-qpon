# Contributor privacy operations

This is a restricted operator procedure, not a public deletion endpoint. It grants no database access and performs no deletion. Use the existing private systems; never put request details, emails, account identifiers or private contribution records in GitHub issues, pull requests or CI logs.

## Account and removal requests

1. Receive requests through the published contact address. Confirm control of the contributor's email through the existing authentication or correspondence process. Never ask for a password or sign-in code. Collect only enough information to establish what the person wants and which account is theirs.
2. Record a private case reference, requested scope and verification outcome. Check for unresolved moderation, complaints or legal obligations before deciding what must be retained. Explain any necessary retention and the reason to the requester.
3. For account closure, use the owner controls to block contributions and revoke the account's Supabase sessions before removing its Auth account. Confirm that further authenticated contribution requests fail. Blocking contributions alone is not account deletion.
4. Review the account's community profile, proposals and notes, and any related private verification or moderation material. Remove private records that are no longer needed. Retain only what is needed for the agreed purpose, such as an unresolved complaint or accepted contribution attribution, with the reason recorded privately. Do not assume that deleting an Auth user cascades: community members have separate identifiers, and proposals and notes reference the community member.
5. Review accepted public attribution separately from private account data. Accepted contributions and their licence history remain part of the service where needed; public copies made by others may remain. Remove or suppress personal or harmful material when appropriate. The existing revision-redaction control also pauses a matching live offer, so verify the resulting offer state. Do not replace attribution or erase contribution history without reviewing the specific request and the applicable licence.
6. Verify the agreed outcome in the private account and contribution records. Check that removed material no longer appears through the public history, and that ordinary visitors and contributors still cannot read private records. Record only the minimum completion evidence and tell the requester what was removed, what remains and why.

## Retention review

During maintenance, review inactive accounts and private drafts, rejected or withdrawn proposals, hidden notes and moderation records. Keep them only while needed to run the contribution service, resolve a complaint or meet a legal obligation. Review retained exceptions again when that purpose ends. This candidate does not automatically purge community records; do not describe its existing report-retention job as a community-account deletion service.

Accepted public attribution and edit history are retained while the contribution remains part of the service, subject to removal of private or harmful material. Existing report, subscriber and short-lived abuse-control retention rules remain separate.

Provider logs and backups follow the providers' actual retention arrangements. Check those arrangements when handling a request; do not promise immediate removal from every provider backup or from copies made by others. Never copy live backups into the public repository.

## Supplier email measurement

Brevo's per-contact tracking-consent control is enabled, with unknown consent set to No. Personal open/click tracking is off by default, and contributor sign-in does not request tracking consent. The supplier still holds delivery records and may carry out aggregate delivery measurement. A delivered SMTP message can still contain a measurement image or rewritten link; the setting alone is not evidence that an email contains neither.

Brevo's [tracking documentation](https://help.brevo.com/hc/en-us/articles/37114679474706-About-email-tracking-pixels-and-the-CNIL-recommendation-in-Brevo) distinguishes per-contact engagement from delivery measurement. It also says a contact's last-open date can update for delivery purposes without tracking consent. Do not promise that the supplier keeps no recipient-level operational records or that its inserted pixels are absent. The website's statement about no advertising pixels or tracking cookies applies to the website, not to everything an email supplier adds to a message.

When changing sending settings or templates, check both the saved consent default and a real delivered message. Keep requested sign-in codes separate from marketing and do not add tracking-consent forms as part of account access.

## Release check

Before opening contributor sign-in, verify the actual Supabase and Brevo configuration, requested-code delivery and applicable overseas processing disclosures. Keep marketing collection closed. Verify the existing contact mailbox provider before changing the provider named in the public privacy page; do not infer it from the sending address.
