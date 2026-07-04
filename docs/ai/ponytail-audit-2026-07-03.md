# Ponytail Audit — Rhythm (`apps/api_server` + friends)

_Date: 2026-07-03 · Scope: over-engineering & complexity only (correctness / security / perf explicitly out of scope) · Applies nothing — one-shot report._

Audited `apps/api_server/src` (~63k LOC TS, 282 non-test files, 105 services, 34 controllers), `apps/mcp_server/src` (~2.2k LOC), `tools/`, `worker/`, and the two Flutter apps at a structural level.

## Headline

**Lean already, mostly ship.** This is a disciplined codebase: no hand-rolled `groupBy`/`deepClone`/`sleep`/`debounce`, no barrel-file sprawl (one 47-line `cli/index.ts`), thin controllers that correctly delegate to services (proper layering, not a smell), only 5 TODO markers and 4 `as any`/`@ts-ignore` across 63k LOC. The plugin registry in `org_proposal_apply_service.ts` *looks* like YAGNI from its stale doc comment ("none of the generators exist yet") but is in fact fully populated by 6 real generators — not a cut.

The cuttable findings below are small and honest.

## Findings (ranked, biggest cut first)

`stdlib:` **`uuid` dependency — replace with Node's `crypto.randomUUID()`.** All 9 imports are `import { v4 as uuidv4 } from 'uuid'` doing plain v4. Engine is `node >=20 <25`; `randomUUID()` is native. Swap 9 call sites, drop 1 dep. [`apps/api_server/src/repositories/*.ts` — gmail_signals, project_instances, integration_accounts, +6]

`delete:` **`node-pty` in `api_server` dependencies — no `src` import.** Only the vendored `opencode_fork` (own package.json) and desktop use it. `scripts/postinstall.js` `chmod +x`'s its prebuilds, so verify the desktop-spawn path doesn't rely on api_server hoisting it before removing — but as an api_server runtime dep it is dead. [`apps/api_server/package.json`, `scripts/postinstall.js`]

`shrink:` **`@types/pg` is in `dependencies`, not `devDependencies`.** A types-only package shipped as a runtime dep. Move it. [`apps/api_server/package.json`]

`shrink:` **Two exported `applyProposal` functions, different files, same name.** `org_proposal_apply.ts` (auto-apply, LOW-risk path) vs `org_proposal_apply_service.ts` (human-gate queue → per-kind appliers). Both legitimate and both used, but the identical name across the two apply pathways is a readability tax — one should read `applyAutoProposal` / `applyGatedProposal`. Rename, don't merge. [`apps/api_server/src/services/org_proposal_apply*.ts`]

`shrink:` **Scattered ad-hoc date math** (`1000*60*60`, `86400000`, `getTime() ± n`) across ~8 services; a `task_date_status.ts` date helper already exists in the tree. Route the repeated ms-arithmetic through it instead of re-deriving inline. Cosmetic, low priority. [rhythm_signal_generator_service, agentSchedulerService, facilities_booking_service, +5]

## Non-findings (checked, deliberately NOT cut)

- `org_proposal_apply_service.ts` plugin registry — fully wired by 6 generators; the "generators don't exist yet" doc comment is stale, not the code. (Worth a one-line comment fix, not a deletion.)
- `mcp_oauth_engine.ts` (20 lines, 1 export) — composition-root singleton wiring, not a redundant wrapper.
- Thin controllers (`dashboard_controller.ts` 16 lines, etc.) — correct delegation layering.
- Exported `interface`/`type` shapes flagged by the interface grep — TS structural types, not single-impl OO abstractions.

## Net

`net: ~1 dep removable (uuid), 1 dep to verify-then-remove (node-pty), 1 dep misplacement (@types/pg → dev), plus ~2 low-risk readability renames. No structural bloat. Ship.`
