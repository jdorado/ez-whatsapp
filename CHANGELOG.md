# Changelog

## 0.1.0-beta.13

- Repair explicitly revoked (401) authentication while preserving the pinned
  identity, captured records, watches and uncertain operation receipts.
- Use the reviewed shared OIDC publisher for exact-artifact beta publication.

- Support exact group JIDs and persistent incoming-only conversation watches
  with revocation, preserving core-owned authorization and uncertain receipts.
- Make verified shipping proactive and agent-owned. Synthetic transport tests
  pass; live group-recipient and final fresh-host/reboot acceptance remain pending.

- Support core message-v1 task capture and sending for individual contacts, with
  expected-account checks and idempotent bound receipts. Declare command exposure.

## 0.1.0-beta.12 — self-upgrade beta

- Declare updater protocol 1 and state-schema compatibility for main-managed upgrades.
- Require verified main Telegram onboarding before plugin installation and QR linking.
- Document retained accounts, migration boundaries and isolated contributor worktrees.
- Provider implementation/dependencies are unchanged. Automated and synthetic Docker
  checks cover the plugin; live account/VM upgrade acceptance remains pending.

Private QA versions beta.3 through beta.11 were not public releases; some were
deliberately broken rollback fixtures and must never be published.

## 0.1.0-beta.2 — distribution preparation (not published)

- Publish under `@jc_stack/ez-whatsapp`; GitHub remains `jdorado/ez-whatsapp`.
- Document pinned npm downloads and retain the beta-only distribution channel.
- Runtime behavior and dependencies are unchanged from beta.1. Live account and
  reboot acceptance remain deferred.

## 0.1.0-beta.1 — initial public beta

- Independent Docker WhatsApp linked-device CLI and agent skill.
- QR onboarding and identity check, text sends with operation keys and receipts,
  bounded captured inbox and explicit subscription policy for host attention.
- Private profile persistence, data-preserving removal and synthetic tests.
- Public contribution, security, packaging and release instructions.

Limits: unofficial Baileys integration; captured history only, no media download
or transcription. Acceptance is not delivery; uncertain sends are not retried.
The provider dependency stack includes GPL-3.0 libsignal (see notices).

Beta acceptance: automated tests, packed installs and Docker fixtures only. Live
provider onboarding and reboot verification are deferred, not marked passed.
