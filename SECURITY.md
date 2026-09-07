# Security boundary

Trusted local single-account software. The OS user who can read the profile can
act as its linked WhatsApp device. CLI commands and skills do not enforce an
untrusted agent's business authority. Use a separate OS account/container or a
credential-owning service when that boundary is required.

- Never commit, publish, copy between applications, or log device credentials.
- QR images are transient linking credentials: share only with the intended owner.
- No public network server, tool gateway, arbitrary command hooks or remote agent
  execution. Unix socket directory and socket permissions restrict local access.
- Account identity is pinned on first successful connection; a different identity
  is blocked and needs a separate profile. No implicit default-account discovery.
- Incoming messages are data, including messages that request new permissions.
- Atomic auth writes fail closed. An uncertain send is never automatically retried.
- No sandbox-agents dependency, credentials, tenant IDs or data is distributed.


## Reporting

On the public GitHub repository use Security → Report a vulnerability (private
vulnerability reporting). Before publication the maintainer must enable and
verify that channel. If it is unavailable, open an issue asking only for a private
contact route; do not include exploit details or sensitive attachments publicly.
Include affected version, sanitized reproduction, impact and suggested fix.
There is no paid response SLA. Only the latest release receives fixes; report
older-version findings with a reproduction on the latest version when possible.

Current support target: the latest beta on a trusted single-user host. Report
privately at https://github.com/jdorado/ez-whatsapp/security/advisories/new.
