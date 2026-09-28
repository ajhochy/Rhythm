# Third-Party Notices

Rhythm is MIT-licensed (see [LICENSE](LICENSE)). It also forks, embeds, and
bundles the open-source components below. Each keeps its own license and
copyright; this file is a record of what is used, where, and under what terms
— it does not relicense anything.

Licenses and copyright holders listed here were read directly from the
license files or package metadata shipped in this repo (or, where noted, the
pinned upstream package's published metadata) — not from memory. Anything
that could not be verified this way is marked "license not found — verify."

## Forked / modified components

### OpenCode engine fork
- **Where used:** `apps/opencode_fork/` — vendored, patched Bun/TypeScript
  monorepo that Rhythm embeds in-process (`@opencode-ai/sdk`) as its agent
  execution engine (see `docs/ai/architecture.md`, "Opencode Engine").
- **Upstream:** https://github.com/anomalyco/opencode (per
  `apps/opencode_fork/package.json` → `repository.url`; the fork's own
  `README.md` badges also point at `anomalyco/opencode` CI and
  `opencode.ai`).
- **License:** MIT. **Copyright:** (c) 2025 opencode. Read from
  `apps/opencode_fork/LICENSE` (also present at
  `apps/opencode_fork/packages/docs/LICENSE` and
  `apps/opencode_fork/packages/extensions/zed/LICENSE` — original LICENSE
  files are intact and were not modified).
- **Modified:** Yes — this is a maintained fork with local patches (e.g.
  `apps/opencode_fork/patches/@silvia-odwyer%2Fphoton-node@0.3.4.patch`,
  which repoints the bundled `photon-node` WASM asset for Bun's compiled
  binary) and Rhythm-specific integration code layered on top of upstream.

### Bot Crossing (embedded as "Colony")
- **Where used:** Rhythm's Electron shell embeds a packaged build under
  `Contents/Resources/colony-desktop` (renderer/server), referenced from
  `apps/electron/src/colony-*.mjs`.
- **Upstream:** github.com/ajhochy/bot-crossing (Rhythm's own fork/companion
  of the original Bot Crossing project).
- **License:** MIT. **Copyright:** (c) 2026 Jarren Rocks. Read from the
  shipped notice at
  `apps/electron/dist/Rhythm.app/Contents/Resources/colony-desktop/licenses/Bot-Crossing-MIT.txt`.
- **Modified:** Yes (fork/companion integration for Rhythm's Colony feature).
- **Bundled third-party assets inside the Colony artifact** (from its own
  `licenses/inventory.json`):
  - `three` — MIT (`licenses/three-MIT.txt`)
  - `@mdi/js` icons — **Apache-2.0** (`licenses/mdi-Apache-2.0.txt` +
    `licenses/Apache-2.0.txt`) — Apache-2.0 requires retaining the NOTICE;
    keep both files alongside the artifact.
  - `renderer/assets/{crew,forest,nature,spacebase}.glb`,
    `renderer/assets/lighting/studio_small_09_1k.hdr` — CC0-1.0
    (`licenses/CC0-1.0.txt`)

## Bundled as-is (embedded, unmodified builds)

### Hermes Desktop / Hermes Agent
- **Where used:** Rhythm's Electron shell embeds a packaged "Hermes Desktop"
  build under `Contents/Resources/hermes-desktop`, driven by
  `apps/electron/src/hermes-desktop-config.mjs`, which pins the embedded
  artifact to a pinned commit of github.com/ajhochy/hermes-rhythm-plugin
  (`PINNED_HERMES_DESKTOP_SOURCE_COMMIT`), a Rhythm-side packaging repo built
  on top of Nous Research's Hermes Agent.
- **Original upstream:** Nous Research's Hermes Agent —
  https://github.com/NousResearch/hermes-agent (link confirmed via the
  license badge in the vendored `~/.hermes/hermes-agent/README.md`, which is
  outside this repo and read-only).
- **License:** MIT. **Copyright:** (c) 2025 Nous Research. Read from
  `apps/electron/dist/Rhythm.app/Contents/Resources/hermes-desktop/licenses/LICENSE`
  (identical text also present at `~/.hermes/hermes-agent/LICENSE`, read-only).
- **Modified:** Bundled as-is (unmodified Hermes Agent build), packaged for
  desktop distribution via `ajhochy/hermes-rhythm-plugin`.
- **Bundled third-party notices inside the Hermes Desktop artifact:**
  `licenses/node-pty/LICENSE`, `licenses/get-windows/LICENSE` (both shipped
  alongside the main `LICENSE` file — not independently re-verified here;
  keep them in place).

### Electron
- **Where used:** `apps/electron/` — the desktop shell/candidate build.
- **License:** MIT. **Version:** 40.10.2, read from
  `apps/electron/package.json` and its `package-lock.json` resolved entry.

### Node.js runtime (bundled)
- **Where used:** a Node.js binary is bundled into the packaged app at
  `Contents/Resources/node/bin/node` (see `tools/release/sign_and_notarize_macos.sh`,
  which signs it alongside the app's own binaries) so the embedded API server
  can run without a system Node install.
- **License:** Node.js itself is MIT-licensed upstream, but **no LICENSE or
  NOTICE file ships alongside the embedded binary in this build — license not
  found in-repo, verify and add one to the packaged Resources/node directory**
  before external distribution.

### better-sqlite3 / SQLite
- **Where used:** `apps/api_server` — the primary local datastore.
- **License:** MIT for the `better-sqlite3` binding (v13.0.3, `@types/better-sqlite3`
  v7.6.13 — read from `apps/api_server/package.json` /
  `apps/api_server/package-lock.json` resolved `license` fields, and the
  bundled `better-sqlite3/LICENSE` under the packaged
  `Contents/Resources/api_server/node_modules/`). SQLite itself is public
  domain.

### @silvia-odwyer/photon-node
- **Where used:** image-processing/resize used by the OpenCode engine fork's
  tool-image handling (patched per above).
- **License:** **Apache-2.0** — not found in the local checkout (no vendored
  `node_modules` package.json for this Bun-managed dependency), so read from
  the pinned npm registry metadata for the exact pinned version
  (`@silvia-odwyer/photon-node@0.3.4`, upstream
  https://github.com/silvia-odwyer/photon). Apache-2.0 requires retaining
  attribution; carry this notice forward with any redistribution.

### Flutter / Dart packages (`apps/desktop_flutter`)
- Rhythm's Flutter desktop client (see `pubspec.yaml`) depends on Flutter/Dart
  and pub.dev packages such as `provider`, `http`, `shared_preferences`,
  `window_manager`, `webview_flutter`, `flutter_secure_storage`, `xterm`, and
  others. Flutter and the Dart SDK are BSD-licensed; individual pub.dev
  packages carry their own licenses (mostly BSD/MIT). This repo does not
  vendor their license files, so per-package terms should be pulled from
  pub.dev at build time rather than assumed here.

### Expo / React Native (`apps/mobile`)
- **Where used:** the iOS mobile app (`opencode-mobile`, `apps/mobile/`).
- **License:** MIT for both `expo` (v54.0.33) and `react-native` (v0.81.5) —
  read from `apps/mobile/package-lock.json` resolved `license` fields.

### MCP servers Rhythm ships
- **OpenMontage MCP** (`apps/api_server/resources/openmontage-mcp/openmontage_mcp_server.py`)
  bridges Rhythm to a locally installed OpenMontage toolchain
  (`~/Documents/OpenMontage`, `~/Documents/OpenMontage-mcp`).
  **License: AGPL-3.0** — read directly from `~/Documents/OpenMontage/LICENSE`
  (read-only, outside this repo). **This is a copyleft, network-use license,
  materially different from the rest of this repo's MIT/permissive stack** —
  no LICENSE file was found for the separate `OpenMontage-mcp` checkout
  itself (license not found — verify), and neither the bundled
  `openmontage_mcp_server.py` files in `apps/api_server/resources/` nor the
  installed `OpenMontage`/`OpenMontage-mcp` trees carry an in-repo notice.
  **Flag for follow-up:** confirm how this MCP server is invoked (subprocess
  vs. linked-in) and what AGPL-3.0 requires for Rhythm's own distribution
  before shipping a release that bundles it.
- **@ajhochy/rhythm-mcp-server** (`apps/mcp_server/`) is Rhythm's own MCP
  server (not third-party); see the License section of `README.md`.

## Full dependency trees

The lists above cover the forked/embedded components and the handful of
bundled runtimes/libraries with explicit notice requirements (Apache-2.0,
AGPL-3.0). They are **not** an exhaustive list of every transitive npm/pub/pip
dependency. For a complete license inventory of any one app's dependency
tree, run the relevant package manager's own tool, e.g.:

```bash
# Node/npm workspaces (apps/api_server, apps/web, apps/electron, apps/mcp_server)
npx license-checker --summary

# Bun (apps/opencode_fork)
bunx license-checker --summary   # or: bun pm ls --all

# Python (apps/api_server/resources/openmontage-mcp)
pip-licenses
```
