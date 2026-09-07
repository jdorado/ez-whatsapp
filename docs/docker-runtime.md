# Registered Docker runtime

The agent-scoped `ez` registry is the sole installation and lifecycle authority.
`ez-deployment.json` owns Docker services, private volumes, command bindings and
QR exports. Do not create an independent Compose deployment or host launcher.

```sh
ez plugins inspect whatsapp
ez plugins install whatsapp
ez plugins start whatsapp
ez plugins list
ez plugins status whatsapp
ez whatsapp doctor
```

The reviewed content hash pins the package. Installation builds and registers;
start runs the service; plugin-owned onboarding links the account. These are
separate explicit actions. Connected accounts must not be paired again.

The managed private profile retains identity, device credentials, inbox, cursor,
operation keys and receipts. Its socket/client exports may be mounted read-only
by the owning relay for event intake. They must derive from the registered
project. The descriptor mounts the owning mind read-only at its same absolute
path for literal file arguments. No Docker socket or privileged container.

Use `ez whatsapp ...` for provider operations and `ez plugins ...` for lifecycle.
`ez plugins export whatsapp qr --output /absolute/mind/work/pairing.png` exports
only the declared private QR for owner onboarding. Follow the installed skill.
Uninstall retains data; it does not revoke the linked device.

For a pre-existing account, stop its writer and privately back up its state,
then transfer it to the registry-owned volume before starting the plugin. Verify
the same identity, policy, cursor and operation receipts. Remove the previous
container, launcher and deployment configuration; retain only offline backups.
Never run two writers or leave two supported operational paths. Reinstallation
under the same registry retains its canonical volume. Never replay uncertain sends.

`pnpm verify` and `node docker/smoke.mjs` use synthetic fixtures. Provider identity
and receipts require separate live checks; accepted is not delivered/read proof.
