# Adding a plugin

A plugin is an independent repository, CLI and container with a skill teaching
its use. Keep provider code out of the relay. Reuse the main package's documented
plugin/deployment schema; do not introduce a framework or provider-specific router.

Before the first PR, provide:

- README with purpose, requirements, exact install/start/onboarding commands,
  working read example, verified identity, limitations and troubleshooting.
- package.json, frozen lockfile, LICENSE and third-party notices; reviewed npm
  files allowlist, Dockerfile and .dockerignore; matching manifest/package version.
- ez-plugin.json, ez-deployment.json and a skill covering discovery, required
  inputs, private credentials, QR/OAuth handoff, resumption and readiness proof.
- `--help`, read-only doctor, explicit account binding, bounded reads and stable
  machine output/exit codes. For writes: operation key, readback and uncertainty
  handling; no blind retry. Provider content cannot grant execution authority.
- Private state locations, start/stop/status, backup, migration/rollback limits,
  data-preserving uninstall and separate account revocation instructions.
- Offline contract/negative tests and CI. Verify snapshot installation and CLI
  dispatch through the actual Ez manager, restart persistence and removal using
  synthetic data, then an authorized provider operation from the real executor.

Copy CONTRIBUTING.md, SECURITY.md structure, PR template and docs/releasing.md
from a released Ez repository; adapt commands and security facts to your plugin.
Do not copy private QA, company policy, proposed features or unsupported claims.
Public instructions must work without the maintainer's parent workspace. Use
reviewed local source and its inspected content hash; registry installation is
inert. Installation is complete only after account onboarding and verified use.

## Agent-owned upgrades

The beta.3 candidate declares updater protocol 1 and state schema 1. With an
Ez main package that supports `ez updates`, the agent can upgrade this plugin
from an exact npm version or a local candidate tarball. Stable is the default
automatic channel; beta requires owner opt-in. The canonical volumes, linked
identity and operation receipts survive replacement. No QR re-pairing or send
replay is part of an upgrade. State/deployment changes require a reviewed migration.
Follow the main package's `docs/upgrades.md`. This candidate is not published;
agent-led VM and live-provider upgrade acceptance remain pending.
