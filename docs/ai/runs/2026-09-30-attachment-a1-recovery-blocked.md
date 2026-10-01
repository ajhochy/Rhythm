---
date: 2026-09-30
repo: Rhythm
branch: opencode/delivery-attachments-20261001
pr: 1598
issues: [A1]
status: BLOCKED
tags: [run, Rhythm, attachments, acceptance-contract]
---

## Ownership / baseline

- Root: `/Users/ajhochhalter/.local/share/opencode/worktree/a4784d9c54aa2929a09fdab2213ff827a3cb60a5/delivery-attachments-20261001` (all commands used explicit workdir here or its packages; every edit used an absolute path here).
- Branch: `opencode/delivery-attachments-20261001`; HEAD `c1b7e023fbd85774fe447078cfe410f228dee539`; initial `git status --short` empty.
- Recovery of parent-reported idle child `93bb037a-656f-40d7-8879-2a79b8a581dc`; its blank final was not accepted as evidence. No peer dispatched or owner adopted.
- Read root AGENTS, owned project-state/current-plan, planner `docs/ai/current-plan.md` and `docs/ai/handoffs/2026-09-30-regressions-delivery-context.md`. Initial handoff lookup under planner-root `handoffs/` was absent; corrected to canonical `docs/ai/handoffs/`.
- Main, mobile, M completion/repository paths, C scheduler, shared manifests, protected cleanup worktree and foreign runtimes were not edited. No reset/stash/stage/commit/push/PR/merge/deploy. Protected byte-identical hash proof was not collected; preservation claim is limited to no commands/edits targeting them.
- `ls -ld` confirmed owned web/API/fork dependency roots and web Playwright/TypeScript packages are real directories, not main symlinks. No npm install/build through main. Browser dependency downloaded only to owned web `node_modules/a1-browsers`.

## Phase 0 — partial red contracts, NOT COMPLETE for all A1

Invoked acceptance-contract first. No waiver. Added native Chromium test executing the actual production private resolver via TypeScript AST extraction/transpilation and actual compression source, not a copied implementation or fake FileReader. This is a unit boundary check, NOT composing UI, WS, SDK or model proof.

- Browser synthetic workbook byte sample is deliberately a transport sample, NOT claimed to be valid XLSX. Expected data URL bytes exactly `UEsDBAD/EQA=` with workbook MIME, filename and size preserved; fake filesystem reference prohibited.
- JPEG/PNG fixtures generated using native canvas, passed through real production resolver/compression and decoded with native `createImageBitmap`. These test native byte usability, not visual model recognition.
- Read contract generates a real minimal OOXML ZIP using installed ZIP writer, invokes real Read tool in its existing Effect/instance harness. Two ordered sheets, inline string, number, explicit blank, boolean, formula and cached value included. Existing permission callback follows baseline test harness; it is not cross-user authorization proof. Actual refusal captured; explicit success assertion fails. Remaining row/type/security/limits cases are explicitly UNVERIFIED in contract; no claim that substring checks satisfy them.
- Contract JSON: `docs/ai/contracts/attachment-a1-recovery.json`. Ten criterion IDs; two red reproductions, eight incomplete/unverified criteria. No full live test exists yet. The three browser cases plus one workbook test are executable evidence only, not a complete acceptance gate.

## Checks / exact commands

Commands below used the explicit package workdir, not `cd`.

### Root baseline

`git status --short && git branch --show-current && git rev-parse HEAD` → clean; branch and SHA above.

`ls -ld apps/web/node_modules apps/web/node_modules/@playwright/test apps/web/node_modules/typescript apps/api_server/node_modules apps/opencode_fork/node_modules` → five owned directory entries, no symlink entries.

### Web

1. `node --test tests/contract/attachment-picker-bytes.test.mjs` → initial harness error: installed Playwright expected Chromium1234 absent. This was NOT counted as acceptance failure.
2. `PLAYWRIGHT_BROWSERS_PATH="/Users/ajhochhalter/.local/share/opencode/worktree/a4784d9c54aa2929a09fdab2213ff827a3cb60a5/delivery-attachments-20261001/apps/web/node_modules/a1-browsers" ./node_modules/.bin/playwright install chromium` → success; Chromium/headless1234 and FFmpeg1011 downloaded exclusively to that owned dependency directory.
3. `PLAYWRIGHT_BROWSERS_PATH="/Users/ajhochhalter/.local/share/opencode/worktree/a4784d9c54aa2929a09fdab2213ff827a3cb60a5/delivery-attachments-20261001/apps/web/node_modules/a1-browsers" node --test tests/contract/attachment-picker-bytes.test.mjs` → **2 pass / 1 fail**. Real assertion: actual `dataUrl` undefined, expected `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,UEsDBAD/EQA=`. JPEG and PNG decoding passed. Browser closed in finally; no app server started.

### Fork

1. `bun test test/tool/read.test.ts --test-name-pattern "A1 selected workbook" --timeout 30000` → **0 pass / 1 fail / 40 filtered**, production `Cannot read binary file: <temporary-fixture>/synthetic.xlsx` at read.ts252. Test then tightened to assert real Effect exit success explicitly rather than leave an uncaught production refusal.
2. Same command → **0 pass / 1 fail / 40 filtered**, `Expected: true; Received: false` at test177. This is a genuine outcome assertion failure, not import/build/harness failure.
3. `bun test test/tool/read.test.ts --timeout 30000` → **40 pass / 1 fail**, 87 assertions. Only new A1 case red. Scoped synthetic fixture cleanup uses existing tmpdir/dispose lifecycle.

### API

`./node_modules/.bin/vitest run src/__tests__/opc_m4_1_file_attachments.test.ts src/__tests__/attachment_hosting.test.ts src/__tests__/media_artifact_store.test.ts src/__tests__/relay_artifacts_contract.test.ts --maxWorkers=1` → **4 files / 28 tests PASS**. Existing unit/contract evidence only; not real-engine acceptance.

No product implementation/repair attempts, build, typecheck, real-provider probe, gated live test, installed Electron or native/mobile smoke performed. No delivery claim.

## Phase 1 — HIGH gates / exact manager handoff

Repo `Rhythm`, indexed main path `/Users/ajhochhalter/Documents/Rhythm`, index commit `b846fdccf107d55fdef2b9208024f8cf6486e6d5` (two commits stale). Editing worktree remains branch/root/baseline above. Symbol-only graph results undercount namespace/Effect wiring; source caller cross-check is necessary.

**BLOCKED 1:** UID `File:apps/opencode_fork/packages/opencode/src/session/message-v2.ts`; file of the same path. Intended attachment-only scope: `toModelMessages`/model attachment output conversion, preserve native byte content, do not send hosted display references as provider-fetchable URLs, preserve capability errors and stripMedia behavior. Upstream depth3 analysis: **HIGH**, 161 nodes (d1=29, d2=58, d3=74), 29 direct dependents, zero graph-reported execution processes/modules. Zero reported processes is NOT proof of runtime isolation. No matching AJ exact-symbol/scope approval in supplied manager handoff. No edits to this file.

Direct graph dependents (all file imports, confidence1; paths relative to `apps/opencode_fork/packages/`):

- `web/src/components/{Share.tsx,share/part.tsx}`
- `opencode/src/tool/{tool,task,plan}.ts`
- `opencode/src/share/share-next.ts`
- `opencode/src/session/{summary,session,session.sql,run-state,revert,retry,prompt,projectors,processor,overflow,llm,instruction,compaction}.ts`
- `opencode/src/server/projectors.ts`
- `opencode/src/image/image.ts`, `opencode/src/acp/agent.ts`
- `opencode/src/plugin/github-copilot/copilot.ts`
- `opencode/src/cli/cmd/{import,export,github}.ts`, `opencode/src/cli/cmd/debug/agent.ts`
- `opencode/src/server/routes/instance/httpapi/{groups,handlers}/session.ts`

Source cross-check inspected actual conversion callers: prompt.ts394 (title), prompt.ts2204 (active model turn), compaction.ts276 (token estimate) and compaction.ts441 (stripMedia summary). Broader blast radius includes schemas/persistence/import/share/tool interfaces, not only visual prompt turns; some imports are type-only. No compaction edits authorized or performed.

Cypher direct IMPORTS query independently returned 55 file edges including test imports; filtering tests agrees with the 29 production dependents listed above.

**BLOCKED 2:** UID `File:apps/opencode_fork/packages/opencode/src/session/prompt.ts`; file of the same path. Intended attachment-only scope: `createUserMessage`/`resolveUserPart` owned binary staging and format-aware Read/error delivery, preserving original identity/replay and not fabricating paths or bypassing trust boundaries. Upstream depth3 analysis: **HIGH**, 103 nodes (d1=8, d2=24, d3=71), 8 direct dependents, zero graph-reported execution processes/modules. Depth1 drilldown reports MEDIUM because depth was reduced; this does NOT supersede HIGH depth3 assessment. No matching AJ exact-symbol/scope approval. No edits to this file.

Direct dependents: `opencode/src/tool/task.ts`, `effect/app-runtime.ts`, `control-plane/workspace.ts`, `cli/cmd/github.ts`, `server/routes/instance/httpapi/{server.ts,groups/session.ts,handlers/session.ts}`; plus `opencode/specs/effect/todo.md` (confidence0.8). All paths under fork packages. Intended scope is attachment resolution only, NOT whole prompt execution, schemas or permission changes.

Other pre-edit analyses (no product edits followed): `toModelMessages` symbol LOW0; `handleInputFrame` LOW5, direct controller prompt/enqueueInputFrame/current, one top-level affected process entry representing four prompt flows; `hostPartAttachments` LOW4, direct backfill rewriteMessage and message repository upsertPart; `MediaArtifactStore` MEDIUM68/direct11; `createUserMessage` LOW0; prompt Function UID MEDIUM33/direct1; ReadTool LOW0; Read file MEDIUM43/direct3; WS file MEDIUM38/direct7; sendLiveInput Function LOW0. Ambiguous prompt/sendLiveInput resolved by exact UID. Initial Read file name lookup UNKNOWN/not-found corrected to exact File UID. These do not waive the HIGH file gates. No API handler modifications, hence no handler api_impact gate consumed.

## Mobile part contract — existing only, not new stable implementation

Current canonical upload input: `{type:"file", mime:<actual MIME>, filename:<selected filename>, url:"data:<actual MIME>;base64,<actual bytes>"}` alongside `{type:"text",text:<prompt>}`. Browser/mobile-local paths and `file:<name>` are not server filesystem authority. web store.tsx984–993 consumes `dataUrl` into this file part; current Composer binary branch instead produces fake `file:<name>`. Fork prompt.ts1497–1515 already stages binary data URLs into its own session attachment temp tree. Read currently rejects valid XLSX there.

Hosted transcript `{url:"/artifacts/<id>",artifactId,artifactProject,...}` is display identity, NOT a native Read pathname or arbitrary provider URL. Trusted user/project/session normalization and referenced lifetime remain unimplemented/unverified. M must not treat this receipt as a stable new artifact resolver API; no mobile change is authorized by this partial evidence. No new upload endpoint introduced.

## Sandbox receipt / C1 transfer

`lsof -nP -iTCP:4097 -iTCP:4098 -iTCP:4099 -sTCP:LISTEN` from owned root → no listener output at this probe (not a reservation). Read-only glob `/private/tmp/rhythm*delivery*sandbox*/**/*receipt*` found no receipts; this alone does NOT prove no prior runtime directory exists. No sandbox adopted or started; no fixture DB/config generated/copied; no credentials read or copied; no foreign port/runtime touched.

No assigned runtime directories, PIDs, HOME, four-variable fixture environment, up/status/down or provider receipts exist from this recovery. Therefore **no runnable sandbox/env transfer for C1** is claimed. C1 must receive a separate newly generated read-only synthetic fixture and owned runtime receipt after its owner rechecks ports and existing directories; use `tools/dev/sandbox.sh` only. This stopped-before-runtime result is intentional under HIGH gate, not a live-test pass. Browser processes were closed; there is no owned API/engine sandbox to stop.

## Handoff / remaining gates

Return **BLOCKED**, not READY_FOR_VERIFICATION. Both HIGH file UIDs and scopes above require the manager's recorded AJ informed approval before their edits. Continue only within approved exact scope after fresh impact/source checks; renewed scope needs renewed approval. Independent red reproductions are retained; no partial picker-only implementation shipped around a blocked end-to-end boundary.

Full Phase0 remains incomplete for security/authorization, model bytes/capability, staging lifecycle/replay and actual API/engine matrices. Add those executable failing contracts before product work; keep provider synthetic evidence labeled. `task-attachment-a1-c10` manual target NOT RUN: full browser rendered selection/send and installed Electron JPEG/PNG/XLSX/error/replay journey. No human/delivery/native acceptance passed.

## Final scope check

`git diff --check` passed; `git status --short` contains only the existing Read test modification and three new owned test/contract/run files. `git diff --numstat` reports Read test +40/-0; explicit `git diff --no-index --numstat /dev/null <path>` reports browser test +64/-0 and contract +87/-0 (no-index exits1 for expected new content). No product, manifest or lock diff.

`gitnexus_detect_changes(scope:"all",base_ref:"c1b7e023fbd85774fe447078cfe410f228dee539",worktree:<owned root>,repo:"Rhythm")` → LOW, changed_files1/changed_count1, no affected processes. Graph attributed the inserted test hunk to nearby `FIXTURES_DIR`; it does not index new untracked test/docs files or precisely identify the new test. Git status/diff, not that incomplete attribution, is the scope authority. No commit created.
