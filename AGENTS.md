# Rhythm — Codex Agent Instructions

Read this file first, before any other file, when opening this repo cold.

## Monorepo layout

```
apps/
├── desktop_flutter/  ← macOS desktop app (Flutter) — THE SHIPPING CLIENT
├── mobile/           ← Rhythm Agents iOS app (Expo/React Native) — INCOMPLETE PROTOTYPE
├── api_server/       ← Node.js/Express + TypeScript backend (spawned locally by Flutter on :4001)
├── mcp_server/        ← Rhythm's own MCP server (tool definitions for agent sessions)
├── opencode_fork/     ← vendored subtree of the opencode engine — see dedicated section below
├── web/               ← React/Vite UI — design reference / prototype, NOT shipping
└── electron/          ← Electron wrapper — prototype, NOT shipping
```

See `docs/ai/repo-map.md` for the full file-level breakdown and `docs/ai/architecture.md` for data flow. New to the shorthand (`OPC-Mx-y` tags, local/sdk session IDs, the dual-server split)? Read `docs/ai/CONTEXT.md` first — it decodes it all in one page.

## Database

Production is **Postgres**, hosted on a Synology NAS, reached over a Cloudflare
tunnel (see `docs/release/hosted_deployment_synology_cloudflare.md`). Local dev
defaults to SQLite (`DB_CLIENT` env var; `env.dbClient` in `apps/api_server/src/config/env.ts`).
Several services intentionally no-op under `dbClient === 'postgres'` (e.g. the
local-only opencode agent-file projection) — check for that gate before assuming
a fix needs to run in both environments. See [[project_postgres_sqlite_schema_drift]]
patterns: a new column needs an explicit backfill in the Postgres bootstrap path,
not just a SQLite migration.

## Key integrations

- **Planning Center Online (PCO)** — `pco-services` MCP tools; OAuth-based, per-user connection tracked via `IntegrationsService`.
- **ProPresenter** — `propresenter` MCP tools.
- **Gmail** (work + personal) — `gmail-work` / `gmail-personal` MCP tools.
- **Rhythm MCP server** (`apps/mcp_server`) — Rhythm's own domain tools (tasks, rhythms, projects, PCO bridge, memory, delegation, etc).

Never edit `apps/mcp_server/src/index.ts` without updating the tool count in the PR description — several docs/config files (this one included, via the GitNexus block below) reference an approximate tool/symbol count.

## Production posture

Rhythm has 10–15 active daily users (church staff) on the production API. No
untested changes land on `main` directly:

- Work on a feature branch off `main`.
- Push and open a **draft PR** — do not merge.
- A human merges after manual smoke testing (see `docs/testing/manual-smoke.md`).
- Prefer additive changes. Flag anything that looks like a destructive
  migration (dropping/altering a column with data loss potential, deleting rows
  in a live table) as requiring manual review before it runs against production.

## Before any Flutter commit

```bash
cd apps/desktop_flutter
dart format . --set-exit-if-changed   # CI fails on format violations
flutter analyze --no-fatal-infos      # must exit 0 (infos are pre-existing, not new)
```

See `docs/ai/testing-guide.md` for the full command set (api_server tests, opencode fork tests, manual smoke checklist).

## Behavioral verification gate (required before "done")

Unit tests prove the code is there. They do **not** prove the behavior works
end-to-end against the real engine. A feature can pass `tsc`, pass all unit
tests, and pass GitNexus impact analysis — and still be completely broken at
runtime because of a cache layer, a stale process, or a wiring gap the unit
test mocked away. This happened on #948: the unit test passed, but the live
behavior was broken until a three-cache invalidation bug was found and fixed.

**Rule:** before claiming any backend feature is "done" (in a PR description,
a project-state update, a handoff message, or a commit), you must:

1. **Write a live behavioral test** that drives the desired behavior through
   the real API surface (HTTP routes, WebSocket gateway, MCP tools — whatever
   the feature's entry point is). The test must exercise the actual engine +
   api_server, not a mock. Gate it behind an env flag (e.g.
   `RHYTHM_LIVE_E2E=1`) so it skips in the normal `vitest run` suite.

2. **Run it against the running backend — inside the dev sandbox.** Build the
   fork binary (`cd apps/opencode_fork/packages/opencode && bun run build
   --single`), build the api_server (`npm run build`), then bring up the
   sandbox and run the test against it:

   ```bash
   tools/dev/sandbox.sh up       # API 4098 + engine 4097, temp HOME, copied DB
   tools/dev/sandbox.sh status
   tools/dev/sandbox.sh down
   ```

   See `docs/ai/testing-guide.md` "Isolated dev sandbox" and "Running the fork
   engine in dev" for the launch commands.

   > ⚠️ **Never start a second api_server by hand.** Always go through
   > `tools/dev/sandbox.sh`. An api_server started without
   > `RHYTHM_OPENCODE_ENGINE_PORT` defaults its engine port to **4096 — the
   > desktop app's live engine** — and api_server startup runs stale-port
   > reclamation that SIGTERMs/SIGKILLs whatever holds that port. It will kill
   > the engine you are running inside, mid-turn, orphaning your own session
   > and every sibling subagent (the dispatcher's task cards then spin
   > "working" forever while the children are dead).
   >
   > Setting `PORT`, `HOME`, and `DB_PATH` is **not** enough — the engine port
   > is a separate knob. A hand-rolled `env PORT=4098 …` is still fatal.
   > See `docs/ai/decisions/2026-07-14-dev-sandbox-isolation.md`.

3. **The test must assert the behavior, not the code.** Don't assert "the
   function was called" — assert the observable outcome the user/agent will
   actually experience (e.g. "the edited agent profile appears in
   `listAgents` after refresh", not "reloadConfig was invoked"). If the test
   would pass against a mock, it's not a behavioral test.

4. **Record the result** in the run log (`docs/ai/runs/`) — pass or fail,
   with the exact command and the observed output. A live test that wasn't
   run is not a live test.

**Exceptions:** pure refactors with no behavior change, type-only fixes,
doc-only changes, and dependency bumps don't need a behavioral test. If
you're unsure whether your change qualifies, it does.

## Project logging (canonical: `docs/ai/`)

Logging lives in **`docs/ai/`** — the single source of truth, surfaced in Obsidian via the `ai-*` symlinks under `Projects/rhythm/`.

After significant work, log to `docs/ai/` (never to one growing file):

- **Current state** → overwrite `docs/ai/project-state.md` (lean snapshot: focus · branch/PR · in progress · risks · test status · next step). No log accumulates here.
- **This run/session** → create `docs/ai/runs/YYYY-MM-DD-<slug>.md` — frontmatter `date, repo, branch, pr, issues, status, tags: [run, <repo>]`; body = Files / Checks / Notes.
- **Each durable decision** → create `docs/ai/decisions/YYYY-MM-DD-<slug>.md` — frontmatter `tags: [decision, <repo>]`; Context / Decision / Alternatives / Consequences.

Do **not** write session logs to the Obsidian vault note via `obsidian_post_file` — that path is retired; it created a second, divergent log. The vault note is now a read-only index that links to these `docs/ai/` files.

## Vendored subtree: `apps/opencode_fork`

`apps/opencode_fork/` is a **vendored git subtree** of `github.com/sst/opencode`
at tag **v1.14.49** — NOT a standalone project and NOT part of the api_server
TypeScript build. It exists so Rhythm can carry a minimal patch to the engine's
MCP tool-schema assembly (per-session scoping by Agent Profile) and build a
standalone engine binary from it. Do **not** add `apps/opencode_fork` to
`apps/api_server/tsconfig.json` or any existing build pipeline. Edit it only when
working the `mcp-scope-*` issues; sync it with upstream via `git subtree pull`.
See `docs/ai/decisions/2026-06-25-opencode-fork-vendoring.md` for the import
command, upstream-sync procedure, and rebase-on-upstream steps.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Rhythm** (77189 symbols, 153425 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Rhythm/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Rhythm/clusters` | All functional areas |
| `gitnexus://repo/Rhythm/processes` | All execution flows |
| `gitnexus://repo/Rhythm/process/{name}` | Step-by-step execution trace |

<!-- gitnexus:end -->
