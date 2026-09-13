# Changelog

## Unreleased

- Add explicit account/chat-scoped `history` requests using a captured message
  boundary, plus `history-status`. Persist only matching bounded on-demand
  responses without agent wakeups; preserve partial coverage and uncertainty.
  Remove the blanket history-sync rejection so native identity mapping and
  requested responses can be processed. Live phone history retrieval is unverified.

- Remove the forced 60-second QR rotation override. Keep Baileys' first-QR and
  replacement-QR timing, report remaining time, and reject expired QR exports.
  Previously, a replacement QR could still be offered after the provider's
  normal 20-second rotation window. Real successful pairing remains a live QA gate.

- Link named WhatsApp accounts for distinct purposes in one registered plugin.
  Keep existing data as default and isolate profiles, QR images, inboxes, policies,
  source sockets and receipts. Require explicit account selection for operational
  commands once multiple accounts exist.
- Allow socket-only setup inspection and account-scoped private QR export.
- Verify account boundaries and Docker crash/restart using synthetic providers;
  live multiple-phone pairing and delivery remain unverified.

## 0.1.0-beta.15

- Adopt the corrected shared publisher main-CI selection. Preserve the reviewed WhatsApp runtime and earlier immutable unpublished candidates.
- Testing beta; previously documented live-provider and fresh-host acceptance limits remain.

## 0.1.0-beta.14

- Prepare a fresh immutable candidate from the reviewed latest-tag publisher
  migration; beta.13 remains an unpublished draft and is not overwritten.
- Publish approved betas to npm `latest` through the shared OIDC publisher,
  retaining SemVer and GitHub prerelease status and stable-only update policies.
- Include beta.13's revoked-session repair, individual task capture/sending,
  group JIDs and incoming-only watches. Runtime code and dependencies are
  unchanged from that reviewed candidate.
- Live account onboarding, group-recipient, fresh-host/reboot and agent-led
  upgrade acceptance remain deferred; automated fixtures do not prove delivery.

## 0.1.0-beta.13 — unpublished draft

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
