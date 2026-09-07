# Changelog

## 0.1.0-beta.2 — npm distribution

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
