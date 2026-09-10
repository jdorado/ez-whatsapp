# Releasing

Use the same checks for maintainer and external changes. Each repository versions
independently with SemVer: patch for compatible fixes, minor for new capabilities;
before 1.0, breaking CLI/state changes require a minor bump and migration notes.
No automatic dependency updates, release bot or credentials in pull-request CI.

1. In an isolated release worktree/PR, finalize package version and CHANGELOG.md;
   update plugin manifest version when present. After lockfile changes, copy
   `pnpm-lock.yaml` to `docker/pnpm-lock.yaml` (npm omits the root lockfile; CI
   checks this shipping copy is identical). Never overwrite a published version.
2. Run `pnpm install --frozen-lockfile`, `pnpm verify`, `npm run release:check`,
   `git diff --check`. Review `npm audit --omit=dev` and dependency licenses.
   Record accepted risks with a reason; never run an unreviewed audit fix.
3. Build both Docker targets from a clean checkout:
   `docker build --target test -t ez-release-tests .` and
   `docker build --target runtime -t ez-release-runtime .`.
   Main: `EZ_RELAY_IMAGE=ez-release-runtime node docker/smoke.mjs`.
   WhatsApp: `EZ_WHATSAPP_IMAGE=ez-release-runtime node docker/smoke.mjs`.
4. Create an artifact with `npm pack --ignore-scripts`. Inspect its file list,
   hash it, extract into a fresh directory, copy `docker/pnpm-lock.yaml` to
   `pnpm-lock.yaml`, and run `pnpm install --frozen-lockfile`.
   Repeat CLI help and runtime build there. GitHub publication includes the Git
   tree/history; npm's files list does not sanitize Git history. Review both.
5. For initial release or onboarding changes, install the exact candidate on a
   disposable clean host. Follow setup without sibling checkouts or personal
   state. Verify owner pairing, real reply, service restart/boot and the first
   plugin through the actual executor. A fixture proves plumbing only. Use an
   authorized test account, record receipts privately, publish only a sanitized
   result. Document any unsupported platform/executor explicitly.
6. Confirm repository owner/URLs, package-name availability and publisher access;
   fill package.json repository, homepage and bugs with the actual public URLs.
   Enable GitHub private vulnerability reporting; verify the route. Protect main
   with CI and independent PR review. Maintainers use the same process.
7. Record independent review and green CI for the final release PR, then obtain
   maintainer merge/release authorization for the exact commit, tarball SHA-256,
   license/third-party obligations and known limits. Merge the release PR and
   verify its tree matches the reviewed source before tagging `v<version>` and
   publishing that tarball:
   `npm publish /absolute/candidate.tgz --access public --tag latest --registry https://registry.npmjs.org/`
   for approved prereleases as well; latest is the default distribution tag,
   not a stable-version claim.
   For unattended beta publication, use the shared OIDC procedure below.
   Interactive publication uses npm authentication with 2FA; never paste tokens
   into CI or docs.
8. Create the GitHub release from CHANGELOG.md, attach artifact/checksum, and
   install the registry version on a clean host. Verify metadata and the same
   onboarding path before posting launch copy. Stop rollout on failure; publish
   a new patch or deprecate the bad version, never silently replace an artifact.

Container images are built locally in this initial release. Public image
publication is a separate decision and requires the corresponding source and
third-party notices. Back up private state before upgrades. Uninstall is not
credential revocation; do not delete volumes as a routine rollback.

## Beta channel

Use SemVer prereleases (`0.1.0-beta.1`), GitHub's prerelease flag and npm's
`--tag latest`; keep SemVer and GitHub prerelease status. For this first beta the maintainer
explicitly deferred real account/reboot acceptance. Keep that limitation in the
README and release notes. Source/tarball publication is permitted after the
automated gates; deferred live checks remain required for stable release.
GitHub repositories use `jdorado`; npm packages use `jc_stack`. Verify
`npm whoami --registry https://registry.npmjs.org/` returns `jc_stack` before
publishing. Never infer npm scope ownership from a GitHub login. After publishing,
read back `npm view @jc_stack/ez-whatsapp@0.1.0-beta.14 name version dist-tags --json`
(using the release being published), download it with `npm pack`, and verify its
contents/checksum against the reviewed artifact. Keep the npm artifact and
GitHub tag on the same reviewed commit. Do not create a new token to bypass 2FA.

## Agent-owned upgrades

This beta declares updater protocol 1 and state schema 1. With an
Ez main package that supports `ez updates`, the agent can upgrade this plugin
from an exact npm version or a local candidate tarball. Stable is the default
automatic channel; beta requires owner opt-in. The canonical volumes, linked
identity and operation receipts survive replacement. No QR re-pairing or send
replay is part of an upgrade. State/deployment changes require a reviewed migration.
Follow the main package's `docs/upgrades.md`. Agent-led VM and live-provider
plugin upgrade acceptance remain pending for this beta.

## Shared OIDC beta publication

`.github/workflows/publish-beta.yml` is generated from the reviewed shared
publisher in `jdorado/ez-agents`. Follow its
[canonical publishing procedure](https://github.com/jdorado/ez-agents/blob/main/docs/trusted-publishing.md)
for staging, receipt fields, dispatch and failure reconciliation. Keep the
reusable workflow reference and `publisher-sha` pinned to the same reviewed full
commit. Regenerate through a PR; never copy publishing implementation here.
The caller requires the four `test (OS, NODE)` matrix checks for Ubuntu/macOS
and Node 22/24, plus `docker`, from this repository's `ci.yml` push to `main`.

After the checks and independent review above, stage the exact tested bytes as
`candidate.tgz` and a sanitized `release-receipt.json` on draft prerelease
`vVERSION`. Its tag must identify the tested current `main` commit. The receipt
binds `jdorado/ez-whatsapp`, `@jc_stack/ez-whatsapp`, version, full source SHA,
SHA-256 and public independent-review/test evidence URLs. Dispatch the caller
on `main` with the draft's numeric release ID, version, source SHA and verified
artifact SHA-256. Actions publishes those bytes without rebuilding. Only
`X.Y.Z-beta.N` versions published to the `latest` dist-tag are supported.

The npm package owner separately authenticates and enrolls repository
`jdorado/ez-whatsapp`, caller filename `publish-beta.yml`, direct publication
enabled and no environment (the shared job currently declares none). npm
validates the calling workflow identity. Verify through npm settings or
`npm trust list @jc_stack/ez-whatsapp`. Workflow merge does not establish trust;
never supply npm tokens or private profiles to these jobs.

Retain the Actions registry readback and verified digest before completing and
reading back the public GitHub prerelease and required installation QA. Inspect
registry state after uncertain publication before retrying. Never publish merely
to test authentication. Existing release and repair work
retains its own branch, candidate and accepted QA limitations.

Approved beta publication updates latest automatically through the shared OIDC
publisher. No second tag write or local login is needed for enrolled packages.
The legacy beta tag is not advanced. Versions/GitHub releases remain prereleases;
stable-only deployment policies remain unchanged. Older Ez updaters need an
exact-version core update containing latest-aware discovery. This policy change
does not republish existing versions; prepare a new version for changed metadata.
