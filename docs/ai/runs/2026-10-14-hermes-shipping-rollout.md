---
date: 2026-10-14
repo: Rhythm
branch: feat/hermes-shipping-rollout-20261014
pr: null
issues: [NOTIFY-HERMES, HERMES-APPROVALS]
status: BLOCKED_FULL_ACCEPTANCE
tags: [run, rhythm]
---

## Scope / approvals

Parent specialist handoff; acceptance-contract loaded first, coding-agent second.
Only source writer in this new shipping worktree, clean c74f4392a6df61979fbe33e620a0077ebb6e0b4b.
Read AGENTS.md, project-state.md and current-plan.md. Prior integration is read-only
candidate evidence, not the shipping baseline. No cherry-pick/checkout, commits,
pushes, merges, live4001/4096 requests or process management. Preserve all shipping
security, workflow-kind/cache/coordinator guards, renderer/launcher/Flutter/mobile/
fork/release configuration. Native Pi outputs already installed: no new code,
install or restart. Staged complete-app local signing is approved; no credential
export/read, notarization upload, /Applications writes or app launch. Parent must
ask AJ fresh restart permission before any replacement/relaunch. Prior Pi restart
permission is spent. No live data/config/cache deletion or direct DB provisioning.

## Phase 0 contract

First executable behavioral checks: tools/dev/hermes_shipping_acceptance.mjs.
Against canonical sandbox real API+engine, both unauthenticated notification run
events and relay approvals must return401 (not missing-route404). Env-gated; health
and owned sandbox PID are prerequisites, not acceptance failures. Mandate: make
named checks pass without editing assertions. Additional provisioning/current
attempt/native receipt checks must have their own RED before implementation.
Independent verifier: parent; node --test can run read-only against the artifact.
Full completion additionally requires real runner creation/dispatch, immutable
chat/revocation/foreign denial, native browser+ACK and protected operator CLI,
strict API/MCP builds and baseline inventory+3, complete signed staged app with
renderer/launcher hashes preserved. These are NOTRUN until recorded below.

### Phase 0 actual RED (complete for first slice)

`npm ci --offline --ignore-scripts --no-audit --no-fund` in each private API/MCP
package:185/142 packages installed into this worktree's private hoisted root
node_modules; no symlink/shared dependency install or lock/source changes.
`npm run build` unchanged shipping API:exit0.
Runtime preparation first failed absent build/Release addon, then rejected the
existing unsigned npm prebuild vs signed installed addon byte mismatch. Two
preparation repairs: do not replace npm addon; query actual private in-memory
SQLite using copied installed Node. Third preparation invocation PASS.
`node tools/dev/hermes_shipping_runtime.mjs`: full installed codesign verification
and copied engine verification exit0; private Node SQLite select1 exit0.
Private engine SHA256 d60f5a42930ddb824184242da36dd4a4fffd6d8f4460ff5faf03e0dc09afa072;
private Node SHA256 f4138f62bc2f24b896232afc646fd0a1e75bd3ab1e626c4f3f8ef73b41c6a732.
Shipping fork tree0e287fcc7ca170bdf45be720863be77265cdf4eb differs from old
integration948442aa: old binary NOT reused. Installed exact signed engine copied
to private scratch, unchanged bytes, sandbox skip-build supported flag used.
`bash tools/dev/hermes_shipping_checks.sh up`:exit0, ready API4898/engine4897.
`bash tools/dev/hermes_shipping_checks.sh status`:exit0 API21338/engine21500,
gateway4899=21338. Startup bounded initial curl refusal resolved by readiness.
`bash tools/dev/hermes_shipping_checks.sh acceptance`:exit1;2 tests,0 pass,2 fail,
both actual404 vs expected401, prerequisites real API and engine health200.
No product implementation occurred before this behavioral RED.

## Phase 1 bounded impact review

Reviewed complete candidate notification service/router, relay controller/security/
MCP tools, shipping approval repository+consume+continuation, shipping app mount,
server init/shutdown and MCP index. Add only these feature files and additive
composition/consume checks; no wholesale replacement of existing shipping files.
Graph indexed primary Rhythm, not this c74 worktree; findings are dependency hints.
createApp LOW0 direct; server main LOW1; MCP index LOW0; security class LOW2 direct,
4 total with member edges; consumeApproval LOW1 direct(controller.consume),3 total
via approvals route/app,1 module. API impact agent_approvals_routes LOW1 consumer
per indexed /taint and /consume; existing human middleware remains unchanged.
HermesNotifyService UNKNOWN/not found, not a zero-risk result. Manually traced
new hub subscriber, workflow/session repositories, run authority and routing.
No HIGH result in changed first-slice surface. Existing coordinator continuation
fingerprint/live-map/last-await guards stay untouched. Existing start/get/cancel
workflow routes deliberately skip auth in agent-local mode, so token alone does
not populate owner; runner.start persists entry but dispatcher binds the actual
session later. Provisioning/preengine hook needs a separate RED before changing
these paths. Workflow pendingApprovalId currently is an occurrence id, not an
agent_approvals card; do not falsely label it a canonical approval card.
Signed pipeline reviewed: fixed apps/electron/dist/Rhythm.app, nested Mach-O,
runtime entitlements, special approval/Dayflow identifiers, integrity refresh,
sign-only avoids notary upload. Staging/signing NOTRUN at this point.

## Files / first-slice implementation

Existing shipping product files changed additively only:
- apps/api_server/src/app.ts: local SQLite/non-relay notify mount.
- apps/api_server/src/server.ts: initialize/start after DB ready, stop in existing shutdown.
- apps/api_server/src/routes/agent_approvals_routes.ts: three separate requireAuth relay routes; original human capability/signature routes untouched.
- apps/api_server/src/services/external_content_security_service.ts: extra receipt-integrity check before existing atomic consumption; all shipping guards retained.
- apps/mcp_server/src/index.ts: import/register the three relay tools; every original registrar retained.

New product files copied verbatim from read-only e659 source:
- apps/api_server/src/controllers/relay_approvals_controller.ts
- apps/api_server/src/security/relay_approval_security.ts
- apps/api_server/src/routes/hermes_notify_routes.ts
- apps/api_server/src/services/hermes_notify_service.ts
- apps/mcp_server/src/tools/relayApprovals.ts

Tests:
- apps/api_server/src/__tests__/hermes_approvals.test.ts: qualified unmocked SQLite card tests copied verbatim.
- apps/mcp_server/src/__tests__/mcp_capabilities_and_tool_registration.test.ts: additive registrar, tool names and exact109+3 count; no shipping registration removed.
- apps/mcp_server/src/security/__tests__/external_content_role_graph.test.ts: additive chat-attestation classification, preserves existing protected-write classifications.

Tools added:
- tools/dev/hermes_shipping_acceptance.mjs (frozen RED/GREEN assertions)
- tools/dev/hermes_shipping_checks.sh (four fixed paths+ports, canonical lifecycle only)
- tools/dev/hermes_shipping_runtime.mjs (private copies of verified installed Node/engine)
- tools/dev/hermes_shipping_mcp.mjs (actual stdio catalog and invalid-token read denial)
- tools/release/stage_hermes_shipping.py (one-shot full app clone/stage; never install/launch)
- tools/release/verify_hermes_shipping.py (read-only artifact verification; optional exclusive archive)
- this run note. No project-state overwrite to falsely call the full feature done.

Generated outputs: private package node_modules, dist, apps/electron/dist complete
app/archive/receipt; tools/dev/.hermes-shipping-runtime private copied binaries
remain untracked scratch, NEVER include them in a source commit. No commit made.
No Electron/renderer/launcher/Flutter/mobile/fork/release-env source edits.

## Checks / actual first-slice GREEN

- API `npm run build`: strict exit0; existing postbuild advisory copy exit0.
- MCP `npm run typecheck && ../../node_modules/.bin/tsc -p tsconfig.json`: strict exit0 before package-private dependency correction.
- Original initial workspace npm ci hoisted dependencies privately, but the second
  workspace ci replaced the first workspace's test runner; attempted root vitest
  command returned executable missing (NOT a passing test). Repair1: per-package
  `npm ci --workspaces=false --offline --ignore-scripts --no-audit --no-fund`:
  API180, MCP142, Electron74 packages, each private, exit0, no scripts or source edits.
- API `./node_modules/.bin/vitest run src/__tests__/human_approval_signature.test.ts src/__tests__/expired_approval_decide.test.ts src/__tests__/coordinator_goal_approval_resume.test.ts src/__tests__/approval_not_required_on_clean_session.test.ts --no-file-parallelism`:4 files,82 tests PASS,17.41s. Unit security only; no live desktop signing/decision.
- API `./node_modules/.bin/vitest run src/__tests__/hermes_approvals.test.ts --no-file-parallelism`:1 file,5 tests PASS,1.12s.
- API `./node_modules/.bin/vitest run src/__tests__/issue_1134_external_content_security.test.ts --no-file-parallelism`:1 file,17 tests PASS,5.61s.
- MCP first focused run:7 PASS/2 FAIL: missing new registrar mirror and new tool
  classification. Repair1 added qualified additive test mirror/classification,
  without changing frozen acceptance. Both test files impact UNKNOWN/unindexed;
  reviewed as test-only import/mirror/classification additions (not zero-risk).
- MCP `./node_modules/.bin/vitest run src/__tests__/mcp_capabilities_and_tool_registration.test.ts src/security/__tests__/external_content_role_graph.test.ts && npm run typecheck && ./node_modules/.bin/tsc -p tsconfig.json`:2 files,9 tests PASS,554ms; strict check+emit exit0. Expected scanner-denial diagnostics exercised. Actual shipping inventory109+3=112,28 registrars, not old106.
- After baseline down, `bash tools/dev/hermes_shipping_checks.sh up && bash tools/dev/hermes_shipping_checks.sh status && bash tools/dev/hermes_shipping_checks.sh acceptance`:exit0; real API77074/engine77251/gateway4899=77074;2 acceptance tests PASS,0fail,106.78ms. Both new routes401, actual API+engine health200. No assertion repair.
- `env RHYTHM_LIVE_E2E=1 tools/dev/.hermes-shipping-runtime/node/bin/node tools/dev/hermes_shipping_mcp.mjs`:exit0,
  actual112 unique tools,3 additive names, actual unauthorized MCP list read denied,
 0 decisions/0 provider requests. No owner credential or card contents read.
- `git diff --no-index` candidate service/security/tools vs old integration each
  exit0; `bash -n tools/dev/hermes_shipping_checks.sh` and `git diff --check` exit0.
- Final canonical `bash tools/dev/hermes_shipping_checks.sh down`:exit0; only owned
  sandbox stopped/removed. Sanitized candidate diagnostics retained at
  /private/tmp/hermes-shipping-rollout-20261014-sandbox.evidence.Cp4N9l;
  baseline diagnostics .evidence.eAYbgI. No live app/API/engine/Pi stopped.

Total executed focused unit tests:104 API +9 MCP=113 PASS; live frozen surface
contract2 PASS. MCP stdio smoke is additional observable discovery/read denial,
NOT owner decision, workflow dispatch or native browser qualification.

## Complete signed staging (actual; not notarized, not full feature completion)

WAIVED: non-behavioral full-app packaging/signature preservation work only; no
waiver for provisioning, canonical card hooks, preengine origin or native behavior.

Source lock comparison found only installed API hasInstallScript marker and MCP
license metadata differences; all dependency version/resolved/integrity/dependency
maps matched. Original bundled dependencies/native addon/Node/fork retained in
the app clone, no engine downgrade and no native dependency overlay.
Installed outer entitlements exactly match shipping mac.plist dictionary.
Available136Gi vs installed app866MiB; stage is this worktree's ignored
apps/electron/dist/Rhythm.app, NOT /Applications.

Actual command:

```sh
python3 -B tools/release/stage_hermes_shipping.py
env RHYTHM_SIGN_ONLY=1 APPLE_TEAM_ID=56Q69NYP9H \
  APPLE_SIGNING_IDENTITY=CF6C1EF1525E70E6E3324388A322938977779DB7 \
  node apps/electron/scripts/sign-and-notarize-mac.mjs
python3 -B tools/release/verify_hermes_shipping.py --archive
codesign -dv --verbose=2 apps/electron/dist/Rhythm.app
```

All exit0. Existing tested shipping sign-only pipeline signed all discovered nested
Mach-O (NAPI/PTY/helpers/Node/fork/Electron frameworks), preserved approval helper
identifier/no weakened entitlements and upstream Dayflow artifact qualification,
refreshed Hermes/Colony artifact integrity then signed outer app. No secret read,
export, bypass or notary upload; no signing OS prompt/host denial occurred.
Outer team56Q69NYP9H, runtime flag, Developer ID Application Aaron Hochhalter,
timestamp2026-10-14 11:15:42; `codesign --verify --deep --strict` PASS for candidate
AND original. Existing cached stapled ticket is copied from original and is NOT a
new valid notarization claim: actual `spctl --assess` rejected candidate with
`source=Unnotarized Developer ID`. Pipeline truthfully prints sign-only/not notarized.

- Complete staged app: `apps/electron/dist/Rhythm.app` under this worktree.
- Signed ZIP: `apps/electron/dist/Rhythm-hermes-shipping-signed-only.zip`.
- ZIP SHA256: `7c05164b819388367a929d2d74e905bba2f09f015eafc9764183b445cca626e4`.
- 8846 regular-file inventory SHA256: `8fe226136b38e67e66a46d51a1fd4d72b20764b2694a70021fb9b1e7f11a069c` (defined by verifier; not a ZIP hash).
- Stage receipt `apps/electron/dist/hermes-shipping-stage.json`, SHA256
  `db5bb4b7f154c76c7c81f5991b942cc0ed1c0033af397bb78e59d9f55672213b`.
  Its initial UNSIGNED status records pre-sign stage, not current signature state;
  use verifier/this actual signing receipt for current status.
- Feature source SHA256 `11d9568a885a6bac712357ef368102116127f936fa270d3fb36304afa573b681`.
- Exactly10 compiled payload files differ from original (5 new,5 changed):
  API app/server/approval routes/consume service +4 new controller/security/notify
  router/service; MCP index+new relay tools. All other compiled shipping payload
  bytes retained. No487-file replacement.
- Stage-only build identity retains sourceRevision=c74 baseline and explicitly adds
  dirty=true/feature/featureSourceSha256; never claims clean committed new source.
- Whole `Resources/app` and `Resources/shared` file maps BYTE IDENTICAL before
  staging, after signing and against still-installed original. Important hashes:
  launcher agent-server.mjs `0560bfaa28a5e9aad4dd9b2b0998b6553202b3cd6b725a4a683719cd1e031cc4`;
  main.mjs `030d9ae8dd97a9e9539465972f975ec9b6762b54b85588afe286de7d2ff45740`;
  rendererJS `5ca3f308c366a3fdbbc36831057578910da5d60c85874ad445ced51386e68a85`;
  rendererCSS `0dafb4fbe1d766ce24a14af946091fb14dae1e6cf974ef0b4640a06fd5b3be8f`.
  Complete map retained in stage receipt. Nested native executable signature bytes
  necessarily changed during re-signing; no claim they remain hash-identical after
  signing. Original engine hash unchanged and verifier checks it.
- Original installed bundle remains intact rollback baseline, strict signature PASS;
  no replacement pointer/install/live sealed overlay or relaunch occurred.

## Full-scope blockers / remaining implementation (NOT READY_FOR_VERIFICATION)

This is meaningful new shipping-base/signed-artifact progress, **not completion**.
Supported protected operator provisioning CLI, automatic preengine origin hook,
canonical agent_approvals card notification hook, real HTTP runner+current attempt
revocation/foreign denial, actual native browser/SSE/visible ACK are UNIMPLEMENTED
or NOTRUN here. No direct DB row forgery, HTTP native link adoption, real current
chat, provider or real approval card was used to disguise those missing outcomes.
Parent-installed native107 source/7 outputs remain untouched; no new Pi code or
restart. This artifact must not be installed as a full completed rollout.

Concrete configuration finding: env.recipeWorkflowsEnabled defaults false unless
RHYTHM_RECIPE_WORKFLOWS_ENABLED=true; stock canonical sandbox sanitizes that flag
away, and shipping Electron launcher does not set it itself (inherited installed
runtime env NOT inspected, so production flag value is UNKNOWN). Actual sandbox
probe (private copied Node --input-type=module, fetch POST4898/agent-workflows,
JSON {recipeId:'disposable-preflight-no-dispatch',input:{}}) returned
`{"status":409,"reason":"disabled","fixtureDispatch":"BLOCKED_DEFAULT_OFF"}`.
Probe expected409 and asserted body.error=disabled; it is a capability blocker
diagnostic, NOT a valid-recipe acceptance RED or a provisioning test. No run/engine
dispatch occurs before this guard. Do not bypass the guard or enable all existing
live recipe runs. A bounded sandbox-only flag pass-through may be necessary within
the existing feature scope; no renewed approval is requested for unchanged source
internals. Any live release-env change remains explicitly excluded by parent.

Also confirmed old notification service projects recipe-workflow registry only;
this does not prove current coordinator coding-workflow projection. Do not claim
coordinator integration merely from generic engine idle or these card tests.

Independent parent can verify current artifact read-only via:
`python3 -B tools/release/verify_hermes_shipping.py` (do NOT rerun one-shot stage or
--archive writer). Recreate canonical sandbox only using exact checked wrapper,
then acceptance/MCP commands above and down. Parent owns source review, remaining
implementation/verification and commit/push. Existing approvals and exclusions
remain durable above; do not ask them again for unchanged scope.

## RESTART_REQUEST — HELD, not executed, not presently release-qualified

Only after FULL feature/provisioning/native verification and production startup
migration review, parent must ask AJ NEW permission for exactly ONE scheduled
full Rhythm quit, complete-app replacement at /Applications/Rhythm.app and relaunch,
API4001/engine4096 unchanged. ALL agent sessions (including parent/current chat and
sibling agents) may be interrupted/orphaned. Electron owns Hermes/Dayflow/Colony
runtime lifecycle too; parent must include the reviewed shutdown effects before
asking. No zero-downtime, automatic rollback restart or extra Pi restart is implied.
This request is held; do not activate the incomplete artifact. Notarization is
unqualified/held as a separate external pipeline action, never inferred from local
signing. Original complete installed app/config/data are preserved; never delete
or migrate live rows to make rollback appear clean. New notify schema is local,
additive, initialized on startup; production startup migration review NOTRUN.
