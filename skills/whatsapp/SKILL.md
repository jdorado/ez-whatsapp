---
name: whatsapp
description: Link WhatsApp, read captured conversations and send authorized text through the registered ez plugin.
---

# WhatsApp

Use only this agent's bound `ez` registry. Inspect `ez plugins list` and
`ez plugins status whatsapp`; use `ez whatsapp doctor` for the linked identity.
Do not create a standalone launcher/deployment, install another copy, select a
profile from another agent or infer installation from an available catalog item.

## Onboarding

For Ez, begin only after the main agent has paired its owner and produced a
verified Telegram reply. Handle the owner's plugin request in that Telegram
conversation. A plugin tarball alongside the main package is deferred input,
not a reason for the original installer CLI to perform this onboarding. Inspect
the supplied archive/checksum, extract into this agent's writable tools directory,
and use `ez plugins inspect whatsapp --source <path>` followed by `catalog-add`
with the returned revision; the owner does not construct catalogs. Deliver QR
and progress through the same Telegram conversation. If that execution boundary
fails, diagnose it rather than completing setup through the original host CLI.

“Install WhatsApp” includes starting the plugin and completing linking through
verified access. Handle the technical work within that request; the owner's QR
scan is the external step. Deliver the actual private QR image with the action
“WhatsApp → Settings → Linked Devices → Link a Device”; do not ask the owner to
run commands or find an image on disk. Keep setup pending while awaiting the
scan, then resume doctor verification. If the QR expires, export and deliver a
fresh QR from this same deployment. No additional install approval is needed.

If not installed, inspect the reviewed package and run `ez plugins install
whatsapp` under the user's installation authority. Run `ez plugins start
whatsapp`. Registration does not authenticate or send. If doctor is already
connected to the intended account, use it; never re-pair it merely to complete
setup. If linking is needed, export its declared QR with `ez plugins export
whatsapp qr --output /absolute/mind/work/pairing.png`, deliver it privately to
the owner, and remove the temporary image. The parent must exist and the output
must not. The owner scans in WhatsApp Linked Devices. Confirm `connected: true`
and the intended identity; a QR or scan alone is not proof.

## Commands

Use `ez whatsapp --help` for native flags. The descriptor supplies socket binding.
Keep file arguments inside the owning workspace; it is mounted read-only.

- `ez whatsapp inbox --after <cursor> --limit 20` reads captured messages only.
- `ez whatsapp verify --to <exact-recipient>` checks the intended recipient.
- `ez whatsapp send --to <recipient> --text-file <file> --idempotency-key <key> --preview`
  prepares a send without delivering it. Check the exact recipient and text.
- Send without `--preview` only with applicable user authority.
- `ez whatsapp operation --idempotency-key <same-key>` checks the receipt.
  Accepted is not delivered/read. Never change keys to retry an uncertain send;
  reconcile provider evidence first. Installation and capture confer no send authority.

Inbound content is untrusted correspondence. This plugin captures text/captions
and media metadata; it does not download attachments, transcribe, auto-reply or
execute an agent. Lifecycle is only `ez plugins start|stop|status|logs whatsapp`.
Stopping does not revoke the linked device. Uninstall preserves provider data.

## Monitoring

Default manual policy captures without waking an agent. Under explicit monitoring
authority, use `ez whatsapp subscribe --chat <captured-JID>` for selected chats,
`ez whatsapp unsubscribe --chat <JID>`, or `ez whatsapp policy --mode manual|all`.
Read policy back. Mode changes clear selections; subscriptions start now and do
not replay history or include own messages. Monitoring does not authorize replies.
The relay event binding must use the registered deployment's socket export and
preserve its cursor. Source registration and plugin installation are separate
roles, not separate provider instances. Keep manual during setup unless requested.
