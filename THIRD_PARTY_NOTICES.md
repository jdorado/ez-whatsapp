# License and third-party software

The beta is distributed under GPL-3.0-only (LICENSE), copyright 2026
Ez WhatsApp contributors. LICENSE-MIT preserves the notice on pre-beta source;
those existing MIT grants are not revoked. It is not an additional license for
this beta as a whole. Contributions to the beta use GPL-3.0-only.

Baileys 7.0.0-rc14 is MIT but its libsignal dependency declares GPL-3.0. Using GPLv3
for the plugin distribution keeps that dependency's copyleft requirements explicit.
The main Ez relay is separately MIT; the two are independent processes/CLIs.

Other direct dependencies: pino 9.14.0 (MIT), qrcode 1.5.4 (MIT). Preserve their
installed notices. Platform-specific sharp/libvips binaries include LGPL-3.0-or-later
code; retain notices and meet applicable source/relinking requirements when
redistributing those binaries. The lockfile identifies exact dependency versions.

This beta publishes our preferred source, build scripts and npm source tarball,
not a bundled node_modules tree or prebuilt container image. Users build locally.
Any future binary/container distribution must provide corresponding source for
all covered components and their build scripts, plus required notices; linking
to this wrapper repository alone is not sufficient for upstream dependencies.

Upstream license: https://github.com/WhiskeySockets/libsignal-node/blob/master/LICENSE
WhatsApp access and service terms are separate from the software license. This
is an unofficial integration and is not affiliated with Meta or WhatsApp.
