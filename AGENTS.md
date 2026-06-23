# Rhythm — Codex Agent Instructions

## Project logging (canonical: `docs/ai/`)

Logging lives in **`docs/ai/`** — the single source of truth, surfaced in Obsidian via the `ai-*` symlinks under `Projects/rhythm/`.

After significant work, log to `docs/ai/` (never to one growing file):

- **Current state** → overwrite `docs/ai/project-state.md` (lean snapshot: focus · branch/PR · in progress · risks · test status · next step). No log accumulates here.
- **This run/session** → create `docs/ai/runs/YYYY-MM-DD-<slug>.md` — frontmatter `date, repo, branch, pr, issues, status, tags: [run, <repo>]`; body = Files / Checks / Notes.
- **Each durable decision** → create `docs/ai/decisions/YYYY-MM-DD-<slug>.md` — frontmatter `tags: [decision, <repo>]`; Context / Decision / Alternatives / Consequences.

Do **not** write session logs to the Obsidian vault note via `obsidian_post_file` — that path is retired; it created a second, divergent log. The vault note is now a read-only index that links to these `docs/ai/` files.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Rhythm** (14334 symbols, 30363 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

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
