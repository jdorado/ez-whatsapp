# ez-whatsapp

Installed runtime operation uses Docker Compose. Read
[Docker setup, state and QA](docs/docker-runtime.md). Host service provisioning
has been removed; local source development is an explicit opt-in.

Independent WhatsApp CLI plugin. Read README.md and skills/whatsapp/SKILL.md.
Use `pnpm verify` for offline verification. Real sends require an explicitly
identified recipient and applicable authority; don't use production sessions as
fixtures. Keep private profiles outside this repo.

No relay imports, agent/model calls, Telegram code, business workflows or DB.
Provider protocol mechanics live here; the agent owns decisions. A QR proves
pairing readiness, not a linked account. A message ID proves acceptance, not
recipient delivery. Preserve uncertainty and stable operation keys.

The manifest implements the documented Ez plugin format. The main package owns
the registry and dispatcher; this repository owns only the provider plugin.
Do not modify other repositories to make this one appear standalone.

## Public contribution workflow

Read CONTRIBUTING.md before edits and docs/releasing.md before a release.
Maintainers and external agents use the same PR, tests and documentation standard.
Keep internal plans and private evidence outside this repository.
