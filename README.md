# Rhythm

Rhythm is a desktop productivity and AI-agent workspace for church staff. It
manages tasks, recurring rhythms, projects, messaging, and facility
reservations, and gives staff a native surface for running AI coding/agent
sessions (Claude, Codex, Hermes) against their own work.

## Clients

Rhythm ships two desktop client implementations; see
[docs/ai/project-state.md](docs/ai/project-state.md) for the current status
of active work.

- **`apps/desktop_flutter/`** — the Flutter macOS desktop client. Historically
  the primary shipping client (signed, notarized, released via
  `.github/workflows/desktop_release.yml`).
- **`apps/electron/`** — an Electron shell that embeds the same API server
  and adds native Hermes/Bot Crossing integration. Under active development
  on the `mega/2026-09-18-mobile-electron-hermes` branch as a candidate for
  the shipping desktop client; packaged locally with `npm run package:mac`
  and `npm run sign:mac`, released via `.github/workflows/electron_release.yml`.
  Check `docs/ai/project-state.md` before assuming either client is
  production-ready — do not assume this file is current on that point.

Both clients talk to the same backend and share the same feature set below.

- **`apps/mobile/`** — the iOS companion app (`opencode-mobile`, Expo/React
  Native), distributed via TestFlight. Lets a phone view and drive agent
  sessions running on a paired Mac through the Cloud Gateway relay (see
  `docs/ai/architecture.md`, "Remote access").

## Key features

- Tasks, recurring rhythms, and project templates with scheduled steps
- Weekly planning workflow
- Messaging (threads and messages) and facility reservations
- AI agent sessions (Claude/Codex/Hermes) with skills, MCP servers, and
  per-user profiles/permissions
- Research projects and a live-artifact gallery, rendered in a sandboxed
  WKWebView bridge on desktop
- A memory vault surfaced through Obsidian
- Mobile relay: pair a phone to a Mac and drive agent sessions remotely

## Monorepo layout

```
apps/
  desktop_flutter/   Flutter macOS desktop client
  electron/          Electron desktop shell (embeds Hermes + Bot Crossing/Colony)
  api_server/         Node.js/TypeScript Express API (SQLite locally, Postgres in production)
  web/                React/Vite UI — team-weaver design reference + prototype
  mobile/             iOS companion app (Expo/React Native, TestFlight)
  mcp_server/         Rhythm's own MCP server (@ajhochy/rhythm-mcp-server)
  opencode_fork/      Vendored, patched fork of the OpenCode agent engine
packages/
  rhythm-workspace-ui/ Host-neutral shared-agent workspace UI, used by web + Electron
docs/ai/              Project state, architecture, decisions, and run logs
.github/workflows/     CI and release workflows
```

## Architecture summary

`View -> Controller -> Service -> Repository -> Data Source / External API`

Controllers coordinate request/response and UI intent only; business rules
live in services; repositories isolate persistence and remote API details.
See [docs/ai/architecture.md](docs/ai/architecture.md) for the full picture,
including the dual-server model (hosted production API vs. the local agent
server), the Cloud Gateway relay, and the embedded OpenCode engine.

## Local development

```bash
# API server (dev)
cd apps/api_server && npm run dev        # http://localhost:4000 by default

# Flutter desktop client
cd apps/desktop_flutter && flutter pub get && flutter run -d macos

# Electron desktop client
cd apps/electron && npm run package:mac   # build a local candidate .app

# React web prototype (design reference)
cd apps/web && npm run dev                # http://localhost:5173

# iOS mobile app
cd apps/mobile && npm start

# Rhythm's MCP server
cd apps/mcp_server && npm run dev
```

Each app's `package.json` has additional `test`/`typecheck`/`lint` scripts —
check there before assuming a command exists.

## Building, signing, and releasing

- **Flutter:** `.github/workflows/desktop_release.yml` (`workflow_dispatch`)
  builds, signs, notarizes, and publishes a GitHub Release.
- **Electron:** `apps/electron/package.json` has `package:mac` (build) and
  `sign:mac` (Developer ID sign; set `RHYTHM_SIGN_ONLY=1` for a sign-only
  pass over an existing local build). `.github/workflows/electron_release.yml`
  runs the same pipeline in CI.
- **API server:** published as a container image via
  `.github/workflows/api_deploy_synology.yml`; the Synology deployment step is
  manual (see `docs/release/`).
- **MCP server:** published to npm via
  `.github/workflows/mcp_server_publish.yml`.

## License

Rhythm's own code is licensed under the [MIT License](LICENSE),
Copyright (c) 2026 AJ Hochhalter.

## Acknowledgements / third-party software

Rhythm forks, embeds, and bundles several open-source projects — full
details, upstream links, and license texts are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). In short:

- **OpenCode** (`apps/opencode_fork/`) — Rhythm's agent execution engine is a
  patched fork of the [opencode](https://github.com/anomalyco/opencode)
  project (MIT).
- **Hermes Agent** (embedded as "Hermes Desktop") — built by
  [Nous Research](https://github.com/NousResearch/hermes-agent) (MIT),
  packaged for Rhythm via `ajhochy/hermes-rhythm-plugin`.
- **Bot Crossing** (embedded as "Colony") — a Rhythm fork/companion of the
  original Bot Crossing project by Jarren Rocks (MIT).
- **OpenMontage** — an optional, separately-installed MCP integration
  licensed **AGPL-3.0**, materially different from the rest of this repo's
  license terms; see THIRD_PARTY_NOTICES.md before distributing a build that
  includes it.
- Electron, Node.js, better-sqlite3, Expo/React Native, and Flutter/Dart are
  also bundled or depended on; see THIRD_PARTY_NOTICES.md for versions and
  license notes.
