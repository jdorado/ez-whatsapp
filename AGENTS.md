# ez-whatsapp

Installed runtime operation uses Docker Compose. Read
[Docker setup, state and QA](docs/docker-runtime.md). Host service provisioning
has been removed; local source development is an explicit opt-in.

Independent WhatsApp CLI plugin. Read README.md and skills/whatsapp/SKILL.md.
For Ez onboarding, first require a working main Telegram owner exchange. Plugin
setup then belongs to the installed agent responding to the owner's request in
Telegram, including artifact/catalog preparation and QR delivery. The original
host installer must not preempt this handoff just because a tarball is supplied.
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

Before edits, follow CONTRIBUTING.md's isolated-work rules: one task per dedicated
worktree/branch/PR, starting from fetched origin/main. Do not switch or mix work in
another task's checkout. Stage only this task's changes. Keep its worktree through
review and QA; independent review and green CI precede an authorized merge.
Never treat task completion as permission to merge or publish.
