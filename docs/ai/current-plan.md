# Current Plan — Per-session MCP tool-schema injection scoping (forked opencode engine)

**Date:** 2026-06-25
**Branch:** `feature/agent-scheduler` (stack all work here — draft PR, do NOT merge)
**Supersedes:** the per-directory "3c" design in
`docs/ai/decisions/2026-06-25-per-session-mcp-scoping-investigation.md`.
That investigation's *problem statement and source facts remain valid*; its
*chosen mechanism* (reconcile via connect/disconnect keyed on per-profile cwd)
is **rejected** in favor of an owned engine patch that filters schema injection
per session.

---

## Intent + Constraints

1. **Goal (one sentence).** A "lite" Rhythm agent session must not pay the token
   weight of MCP tool schemas outside its Agent Profile's allowlist — by patching
   a vendored opencode fork so a session injects *only* its profile's allowlisted
   MCP tool schemas into the model context, while all MCP servers stay connected
   at engine startup as today.

2. **In scope.**
   - Vendor `sst/opencode` as a git subtree at `apps/opencode_fork`.
   - Minimal engine patch: add `mcpAllowlist?: string[]` to `Session.Info` +
     `CreateInput`; gate the `resolveTools` MCP loop on it.
   - Build the forked engine binary in CI and bundle it with the macOS app.
   - api_server wiring: expand `.mcp-roles/*.mcp.json` → flat sanitized
     `<server>_<tool>` id list → pass as `mcpAllowlist` on `createSession`,
     on **both** the interactive (`ws_gateway`) and scheduled (`agent_runner`)
     paths; remove the no-op log.
   - Allowlist-expansion unit + tests (sanitize rule, inherit-all behavior).
   - Verification: a Secretary session's injected MCP tool/token count drops to
     its profile allowlist.

3. **Out of scope (explicit non-goals — v1).**
   - Lazy / ref-counted MCP connection manager (servers stay eagerly connected;
     memory-only, no token cost — that is the whole premise).
   - Per-session dedicated MCP connections for per-session credentials. Role
     files use `inherit:true`; shared credentials are acceptable for v1.
   - Per-turn re-scoping. Allowlist is fixed at session creation (matches the
     existing `mcpRoleConfig` model that is already resolved at `createSession`).
   - Upstreaming the patch to sst/opencode. We carry it as a vendored fork.
   - Changing `mcp/index.ts`, the MCP connection lifecycle, or the tool registry.

4. **Hard constraints.**
   - Feature branch + PR only; never merge to `main` (CLAUDE.md / AGENTS.md).
   - `dart format`, `flutter analyze --no-fatal-infos`, `tsc --noEmit`, and
     `npm test` (vitest) must pass before PR.
   - Hand-written `apps/api_server/src/@types/opencode-ai-sdk.d.ts` has
     historically drifted from the real SDK and produced false-green bugs. Any
     new `createSession` field must be reflected without breaking
     `opc_sdk_boundary_regression.test.ts` / `opc_sdk_surface_guard.test.ts`.
   - Engine patch must match the MCP tool-id shape exactly:
     `<sanitizedServer>_<sanitizedTool>`, `sanitize = s.replace(/[^a-zA-Z0-9_-]/g,"_")`.
   - No app-sandbox; the engine binary is spawned as a child process.

5. **Design tensions.**
   - *Minimal surface area* vs *durable upstream-syncable fork*: the patch is two
     tiny edits, but vendoring an entire Bun monorepo as a subtree is heavyweight.
     Mitigation: keep the patch isolated to two files + one fork-side test, and
     document the subtree pull/rebase procedure so upstream syncs stay mechanical.
   - *SDK-type fidelity* vs *least-effort wiring*: extending the HTTP POST body
     directly is simplest (the forked engine reads `mcpAllowlist` off `CreateInput`
     regardless of the typed SDK), but it leaves the typed `.d.ts` lying. See the
     SDK-type decision in Issue 4 and Known Ambiguities.
   - *Ship now* vs *bundling reality*: today the engine binary is **not bundled**
     at all — it is resolved from PATH (see "Cheapest end-to-end path"). Building
     and bundling the fork is the largest single chunk of new work; it must not
     block the engine-patch + wiring proof.

6. **Cheapest version that proves the idea (smallest end-to-end path).**
   Build the forked engine binary locally, point `OpencodeClientService` at it
   (via PATH / `~/.opencode/bin`), wire `mcpAllowlist` through `createSession`
   on the interactive path only, and open a Secretary session in the Debug app.
   If the injected tool count drops to the profile allowlist, the mechanism is
   proven before any CI/bundling work. Issues are ordered so this path is
   reachable after Issues 1, 2, 4, 5 — CI bundling (Issue 3) and the scheduled
   path can follow.

---

## Clarification interview

`AskUserQuestion` is unavailable in this dispatch (subagent context), and the
brief locked the major decisions (delivery = subtree, branch, local issues,
non-goals). The interview is therefore recorded as **deferred to Known
Ambiguities** below rather than skipped silently — the three genuine
under-specified points (binary bundling mechanism, SDK-type approach, the
"7-server" empirical count) are surfaced there for the user to resolve before or
during implementation.

---

## Critical correction to the brief — build pipeline reality

The brief assumed `desktop_release.yml` "downloads the upstream binary" and that
we would "replace the upstream binary download." **That download does not
exist.** Verified facts in this checkout:

- The engine runs **in-process via the npm SDK** `@opencode-ai/sdk` (^1.14.49),
  imported dynamically in `opencode_client_service.ts:295` (`createOpencode()`).
- `createOpencode()` spawns `opencode serve` as a **child process** on port 4096
  (`OPENCODE_ENGINE_PORT = 4096`, line 48), resolving the `opencode` binary from
  **PATH** — `augmentPathForOpencode()` (line 203) prepends `~/.opencode/bin`,
  `/opt/homebrew/bin`, `/usr/local/bin`. The binary is the user's
  separately-installed opencode (1.14.40 today), **not** a Rhythm-bundled file.
- `desktop_release.yml` bundles only `apps/api_server` (`dist/`, `scripts/`,
  `package.json`, `node_modules`) into `Rhythm.app/Contents/Resources/api_server`
  (lines 95-125). It does **not** fetch, build, or bundle any opencode binary.
  The single `opencode` reference at line 186 is just a capability-key string.

**Consequence for Issue 3:** the work is not "swap a download URL." It is
"build the forked Bun project into a standalone binary in CI, place it where
`createOpencode()` will spawn it, and make the api_server prefer the bundled
fork over a PATH opencode." This is the riskiest issue and is called out as such.

---

## Prior Art

The prior-art swarm was not re-dispatched: the upstream landscape was already
surveyed in the investigation decision doc (sst/opencode #5373, #3756, #3612,
#2888, #1101 — all open, no merged fix) and the brief supplies **first-hand
source facts from a real clone of v1.14.49 / v1.14.40**, which supersede any
second-hand web summary. Key borrowed/avoided patterns:

- **Borrow:** opencode's own `tools: {[id]: boolean}` per-turn map already filters
  by the exact `<server>_<tool>` id shape — our allowlist reuses that id grammar,
  so the engine gate is a one-line `continue` in the same loop that builds it.
- **Borrow:** git-subtree vendoring is the conventional way to carry a patched
  upstream inside a monorepo while keeping `git subtree pull` for syncs.
- **Avoid (anti-pattern):** the rejected 3a path (`tools`/`permission` config) —
  confirmed upstream to gate *execution only*, never schema injection (#5373).
  Do not reintroduce it as the scoping mechanism.
- **Avoid:** an external MCP aggregator/proxy (3b) — large new failure surface,
  out of scope; the fork patch is strictly smaller and profile-aware.

---

## Confirmed source facts (from the brief — baked in, do not re-verify)

Inspected `sst/opencode` v1.14.49 (commit `1a47578…`); v1.14.40 MCP logic
byte-identical, only line numbers differ.

| Fact | Location (v1.14.49 / v1.14.40) |
|---|---|
| MCP injection loop iterates *every* connected server's tools, adds each unconditionally | `packages/opencode/src/session/prompt.ts:608-693` / `458-542` |
| Tools record consumed by the model | `prompt.ts:1755` |
| #5373 confirmed: per-call `tools` map → Permission.Ruleset at *execution* only, no pre-injection filter | `prompt.ts:1607-1614`, `ctx.ask` at `625` |
| `Session.Info` has `permission` (line 223), no mcp/tools field | `session/session.ts:206-225` |
| `CreateInput` accepts `permission` | `session.ts:241` |
| `session.permission` already flows into `resolveTools` via `Permission.merge(...)` | `prompt.ts:560` |
| MCP tool-id shape `<sanitizedServer>_<sanitizedTool>`; `sanitize = s.replace(/[^a-zA-Z0-9_-]/g,"_")` | `mcp/index.ts:111`, built at `MCP.tools()` `index.ts:684` / `657` |
| The `:`-separated path at `index.ts:210` does NOT feed model injection — ignore | `mcp/index.ts:210` |

**Smallest engine patch (confirmed minimal):**
(a) add `mcpAllowlist?: string[]` to `Session.Info` (`session.ts:206`) and
`CreateInput` (`session.ts:241`);
(b) gate the `resolveTools` loop:
`if (input.session.mcpAllowlist && !input.session.mcpAllowlist.includes(key)) continue;`
No changes to `mcp/index.ts` or the tool registry.

---

## Rhythm-side facts (baked in)

- `opencode_client_service.ts:478-513` — `createSession(title, directory?, mcpRoleConfig?)`
  accepts `mcpRoleConfig` but only `logger.info`s it; SDK body is `{ title }` +
  optional `{ directory }` query. **This is the sink to wire.**
- `agent_profile_scope.resolveProfileScope` resolves a profile's allowlist into
  `mcpRoleConfig` (`{ role, mcpServers, allowedToolsJson }`).
- `createSession` call sites: `ws_gateway.ts:442,478` (interactive),
  `agent_runner.ts:606` (scheduled), `agent_sessions_controller.ts:478,897`.
  Both ws_gateway and agent_runner already thread `mcpRoleConfig` (today no-op).
- Allowlist SOURCE = `.mcp-roles/*.mcp.json` (repo root). Each file:
  `mcpServers.<server>.allowedTools: string[]` (+ `inherit:true`) and
  `disabledMcpServers: string[]`. The api_server must **expand** this into the
  flat sanitized `<server>_<tool>` id list. When a server has no/empty
  `allowedTools` (inherit-all), include all of that server's tool ids.
- SDK discipline: boundary tests `opc_sdk_boundary_regression.test.ts`,
  `opc_sdk_surface_guard.test.ts` guard the hand-written
  `@types/opencode-ai-sdk.d.ts` against drift.

---

## Issue table

| Order | Title | Goal | Likely files | Tests / evaluation | Dependencies |
|---|---|---|---|---|---|
| 1 | Vendor sst/opencode as `apps/opencode_fork` git subtree | Add the fork at a chosen base tag; document subtree pull/rebase for upstream syncs | `apps/opencode_fork/**` (new), `docs/ai/decisions/2026-06-25-opencode-fork-vendoring.md` (new), `.gitignore`, root `README`/`AGENTS.md` note | `git subtree` add succeeds; `bun install && bun run typecheck` (or fork's check) in `apps/opencode_fork` passes on a clean clone | none |
| 2 | Engine patch: per-session `mcpAllowlist` schema gate + fork-side test | Add `mcpAllowlist?: string[]` to `Session.Info` + `CreateInput`; gate the `resolveTools` MCP loop; prove non-allowlisted schemas are omitted | `apps/opencode_fork/packages/opencode/src/session/session.ts` (206, 241), `.../session/prompt.ts` (608-693 loop), new test under the fork's test dir | Fork unit test: with `mcpAllowlist=['srvA_tool1']` set, `resolveTools` output contains `srvA_tool1` and omits `srvA_tool2`/`srvB_*`; with allowlist unset, all tools present (no behavior change) | 1 |
| 3 | CI: build forked engine binary + bundle in macOS app | Build the Bun fork to a standalone binary in CI; place it where `createOpencode()` spawns it; api_server prefers bundled fork over PATH opencode | `.github/workflows/desktop_release.yml` (new build step + bundle step), `apps/opencode_fork` build script, `opencode_client_service.ts` (`augmentPathForOpencode`/spawn path → prefer bundled binary), `tools/release/sign_and_notarize_macos.sh` (sign the new binary) | CI builds the binary; `desktop_release.yml` "Verify bundled payload" step asserts the binary exists + is executable + signed; smoke step spawns it and hits `/health` | 1, 2 |
| 4 | api_server: pass `mcpAllowlist` on `createSession` (both paths) | Replace the no-op log with a real `mcpAllowlist` on the createSession HTTP body; thread it from `mcpRoleConfig` on interactive + scheduled paths; record SDK-type decision | `opencode_client_service.ts:478-513`, `ws_gateway.ts:442,478`, `agent_runner.ts:606`, `@types/opencode-ai-sdk.d.ts` (per SDK decision), `agent_sessions_controller.ts` if needed | vitest: `createSession` issues a body carrying `mcpAllowlist` when `mcpRoleConfig` present; absent when not; both ws_gateway + agent_runner paths covered; `opc_sdk_boundary_regression` + `opc_sdk_surface_guard` still pass | 5 (needs the expander); 2 (engine must accept the field for end-to-end) |
| 5 | Allowlist expansion unit: role JSON → flat sanitized `<server>_<tool>` ids | Pure function: `.mcp-roles` config → id list, applying `sanitize()` and inherit-all; consumed by Issue 4 | new `apps/api_server/src/services/mcp_allowlist_expander.ts`, new test, possibly `agent_profile_scope.ts` (call site) | vitest: librarian → exactly obsidian_* + rhythm_* ids; sanitize maps `gmail-work`→`gmail-work` (hyphen preserved), dots/colons→`_`; server with empty `allowedTools` → all that server's tool ids (needs a tool-id source — see Open Q); `disabledMcpServers` excluded | none (can build before 4) |
| 6 | Verification + acceptance measurement | Confirm a Secretary session's injected MCP tool/token count drops to its profile allowlist; document how injected tool count is measured | `docs/ai/testing-guide.md` (new smoke entry), `docs/ai/runs/2026-06-25-*.md` | Manual smoke in Debug app: open Secretary session, measure injected tool count (method: engine debug log of `resolveTools` size, or context-usage hint); assert it equals the expanded Secretary allowlist count, down from ~all-servers | 2, 3, 4, 5 |

### Dependency order (topological)

```
1 (vendor subtree)
├─ 2 (engine patch + fork test)      ──┐
│   └─ 3 (CI build + bundle)           │
5 (allowlist expander + tests)         │
└─ 4 (api_server wiring) ──────────────┤
                                       └─ 6 (verification / acceptance)
```

Recommended implementation sequence: **1 → 2 → 5 → 4 → (local proof) → 3 → 6.**
Issue 5 has no dependencies and can be built in parallel with 1/2. The local
end-to-end proof (cheapest path) is reachable after 4 using a locally-built fork
binary on PATH, before CI bundling (3) is finished.

**Progress (2026-06-25):** Issues 1, 2, 3, 4, 5 are DONE. Next: Issue 6 (verification + acceptance measurement).

---

## Per-issue acceptance criteria (concrete)

**Issue 1 — Vendor subtree.**
- *Outcome:* `apps/opencode_fork/` exists as a git-subtree import of `sst/opencode`
  at a single pinned base tag; a decision doc records the tag, the
  `git subtree add`/`pull` commands, and the rebase-on-upstream procedure.
- *Recommended base tag:* **v1.14.49** — it matches the installed SDK
  (`@opencode-ai/sdk ^1.14.49`) the api_server is typed against, the brief's spike
  found MCP logic byte-identical to v1.14.40, and aligning the engine to the SDK
  version removes the existing 1.14.40↔1.14.49 drift noted in the investigation
  doc. (Justification belongs in the decision doc.)
- *Boundary:* a clean checkout + the fork's own install/typecheck succeeds.
- *Done:* subtree present, decision doc written, fork builds.

**Issue 2 — Engine patch.**
- *Outcome:* when a session is created with `mcpAllowlist`, `resolveTools` injects
  only MCP tool ids in that list; when unset, behavior is identical to upstream.
- *Trigger:* session creation carrying `mcpAllowlist` on `CreateInput`.
- *Boundary:* empty array ⇒ no MCP tools injected; `undefined` ⇒ all injected
  (back-compat); an id in the list that no server exposes ⇒ silently absent (no throw).
- *Done:* fork-side test passes proving inclusion + omission against the exact
  `<server>_<tool>` id shape.

**Issue 3 — CI build + bundle.**
- *Outcome:* the release DMG contains the forked engine binary; the running app
  spawns the bundled fork (not a PATH opencode); the binary is signed + notarized.
- *Trigger:* `workflow_dispatch` on `desktop_release.yml`.
- *Boundary:* if the bundled binary is missing/unsigned, the verify step fails the
  build (no silent fallback to a stale PATH opencode in release).
- *Done:* verify + smoke steps pass in CI; local `flutter run` spawns the fork.

**Issue 4 — api_server wiring.**
- *Outcome:* `createSession` sends `mcpAllowlist` on the POST body whenever a
  profile allowlist is resolved, on interactive and scheduled paths; the no-op
  log is removed.
- *Trigger:* session creation from ws_gateway and from agent_runner.
- *Boundary:* no profile / no allowlist ⇒ no `mcpAllowlist` field sent (engine
  injects all — back-compat); invalid role JSON ⇒ field omitted, warn logged.
- *Done:* vitest covers both paths + the SDK boundary tests still pass.

**Issue 5 — Allowlist expander.**
- *Outcome:* given a `.mcp-roles` config object, returns the exact flat list of
  sanitized `<server>_<tool>` ids the engine gate expects.
- *Trigger:* called during profile-scope resolution / createSession.
- *Boundary:* empty `allowedTools` ⇒ inherit-all (all of that server's tool ids);
  `disabledMcpServers` entries excluded; sanitize applied to BOTH server and tool
  segments; hyphens preserved, other specials → `_`.
- *Done:* vitest covers librarian (obsidian+rhythm only), a hyphenated server
  name, inherit-all, and exclusion.

**Issue 6 — Verification.**
- *Outcome:* a Secretary session's injected MCP tool/token count equals its
  expanded profile allowlist, measurably lower than the unscoped baseline.
- *Trigger:* open a Secretary session in the Debug app after a fork-bundled build.
- *Boundary:* a profile with no allowlist still loads all tools (control case).
- *Done:* measured count matches the expander's output for Secretary; recorded in
  a run log + testing-guide smoke entry.

---

## Known Ambiguities (surface to user before/at implementation)

1. **W4 — inherit-all tool-id source.** When a role lists a server with empty
   `allowedTools` (inherit-all), the expander needs *that server's full tool-id
   set* to produce a concrete `mcpAllowlist`. Options: (a) query the live engine
   (`MCP.tools()` / a `/mcp` tools endpoint) at createSession to enumerate ids;
   (b) treat inherit-all as "engine injects all of that server's tools" — i.e.
   the gate should not constrain a server present-but-unlisted. **Recommendation:**
   change the engine gate to operate at *server* granularity for inherit-all and
   *tool* granularity only when `allowedTools` is non-empty — OR have the engine
   accept an `mcpAllowlist` of mixed `<server>` and `<server>_<tool>` entries.
   This affects the exact `continue` predicate in Issue 2 and must be resolved
   with the user (the brief's predicate `!includes(key)` assumes a complete flat
   id list, which inherit-all cannot produce without enumerating live tools).

2. **SDK-type decision (Issue 4).** Two options:
   (a) **Extend the HTTP POST body directly** — simplest; the forked engine reads
   `mcpAllowlist` off `CreateInput` regardless of the typed SDK. The hand-written
   `.d.ts` `session.create` body type stays as-is (a known but contained lie),
   guarded by an added boundary test asserting the body actually carries the field.
   (b) **Extend the `.d.ts`** to add `mcpAllowlist?: string[]` to the create body
   so the type matches reality. **Recommendation:** (a) for the field plumbing
   plus a minimal `.d.ts` annotation comment, because the SDK is consumed via an
   untyped dynamic `import()` and the body is passed through; choose (b) only if
   the boundary tests can be extended to assert the typed shape. User to confirm.

3. **"7-server" empirical gate vs role-file contents.** The brief's acceptance
   gate says Secretary drops to a "7-server allowlist," but `secretary.mcp.json`
   lists **6** `mcpServers` entries (rhythm, gmail-work, gmail-personal, calendar,
   obsidian, pdf-tools) and a `disabledMcpServers` of 4 builtins. Need the user to
   confirm whether the target count is 6 servers, 7 (e.g. counting a builtin or an
   implicit server), or a *tool* count. Issue 6's assertion must use the expander's
   actual output, not a hard-coded "7."

---

## Open Questions — RESOLVED (orchestrator, 2026-06-25)

The four open questions from the original "Known Ambiguities" section are now
resolved. Issue files in `docs/ai/generated-issues/mcp-scope-*.md` incorporate
these resolutions. Coding-agent must not re-open them.

**R1 — Binary provisioning (shapes Issue 03, the riskiest).**
There is no upstream binary download in `desktop_release.yml` to swap. The `@opencode-ai/sdk`
`createOpencodeServer` spawns `opencode serve` resolved from PATH (confirmed in
`node_modules/@opencode-ai/sdk/dist/server.js`). Issue 03 = (a) compile the fork
to a standalone binary in CI using `bun build --compile` for macOS arm64 + x64;
(b) bundle that binary into the .app at `Rhythm.app/Contents/Resources/opencode`
via `desktop_release.yml`; (c) add the binary to `tools/release/sign_and_notarize_macos.sh`
sign list; (d) make `api_server` prepend the bundled binary's directory to
`process.env.PATH` before `createOpencode()` so `opencode` resolves to the fork,
with fallback to PATH for local dev (WARN log when fallback fires). No SDK fork needed.
Acceptance must include: app spawns the bundled fork (assert version/marker), not
the user's `~/.opencode/bin/opencode`.

**R2 — Inherit-all servers (shapes Issue 02 + Issue 05).**
The allowlist is structured: `mcpAllowlist?: { servers: string[]; tools: string[] }`
on `Session.Info` and `CreateInput`. `servers[]` = fully-allowed server names
(inherit-all — emitted when a role's `allowedTools` is empty/missing).
`tools[]` = explicit sanitized `<server>_<tool>` ids (emitted when `allowedTools`
is non-empty). The engine builds a `composedKey → serverName` index from
`MCP.tools()` data (where `clientName` is in scope at `mcp/index.ts:684`) and
exposes it so the `resolveTools` predicate is unambiguous — NO string-splitting.
Gate predicate: `if (mcpAllowlist && !(mcpAllowlist.tools.includes(key) || mcpAllowlist.servers.includes(ix))) continue;`
`mcpAllowlist === undefined` → no filtering (back-compat preserved). Builtins
(bash/computer/editor/filesystem) are native tools, not MCP — out of scope for
the MCP filter (future native-permission concern, not a v1 blocker).

**R3 — SDK types (shapes Issue 04).**
Extend the HTTP POST body directly in `opencode_client_service.ts:478-513`. The
forked engine reads `mcpAllowlist` off `CreateInput` regardless of the typed SDK.
Leave the hand-written `apps/api_server/src/@types/opencode-ai-sdk.d.ts` as-is.
Add/extend a boundary test (`opc_sdk_boundary_regression.test.ts` or
`opc_sdk_surface_guard.test.ts`) asserting the `createSession` body carries
`mcpAllowlist`. Wire BOTH interactive path (`ws_gateway.ts`) and scheduled path
(`agent_runner.ts`); remove the no-op `logger.info`.

**R4 — Acceptance count (shapes Issue 06).**
`secretary.mcp.json` has **6 servers** (rhythm, gmail-work, gmail-personal,
calendar, obsidian, pdf-tools), not 7. Issue 06 asserts the injected MCP tool
count equals `expandMcpAllowlist(secretaryConfig).tools.length` (dynamic —
computed at test time, not hard-coded). How injected-tool count is measured:
`resolveToolsCount` DEBUG log emitted by the fork's `resolveTools` function on
every prompt invocation.

---

## Data-safety / risk notes

- **No secrets in the subtree.** `sst/opencode` is public; confirm the import
  carries no credentials and respects existing `.gitignore` for build artifacts
  (`node_modules`, Bun caches). The `.mcp-roles/*.mcp.json` files contain no
  secrets (allowlists only) — safe to read.
- **Release signing.** The new engine binary must be added to
  `tools/release/sign_and_notarize_macos.sh`; an unsigned/unnotarized binary
  breaks Gatekeeper on non-App-Store distribution (no app-sandbox).
- **Back-compat invariant.** `mcpAllowlist` unset MUST preserve today's behavior
  (all tools injected) so a profile-less / legacy session is unaffected.
- **SDK drift discipline.** Do not let the `.d.ts` change cause a false-green;
  keep/extend `opc_sdk_boundary_regression.test.ts`.
- **GitNexus.** Run `impact` before editing `createSession`/`resolveProfileScope`
  and `detect_changes({scope:"compare", base_ref:"main"})` before committing.
- **Binary provenance.** Issue 3 changes how the engine binary is obtained (PATH
  → bundled fork). Ensure dev (`flutter run`) and release both resolve the fork
  deterministically; avoid a silent fallback to a stale PATH opencode that would
  mask whether the patch is active.

---

## Next in chain

Hand off to `issue-writer` to convert this table into GitHub-ready issue Markdown
under `docs/ai/generated-issues/` (local files only — no remote GitHub issues).
