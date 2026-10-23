---
date: 2026-10-14
repo: Rhythm
branch: feat/hermes-shipping-rollout-20261014
pr: null
issues: [HERMES-APPROVALS]
status: READY_SECURITY_AUTH_FIXTURE
tags: [run, rhythm]
---

## Scope / approved exclusions
Explicit specialist handoff; acceptance-contract loaded first, coding-agent second.
Write only new tools/dev/hermes_shipping_auth_checks.mjs, its private
hermes_shipping_auth_test_helper/ folder and this note. TESTSETUPONLY: external
Cloud-auth fixture, not a production endpoint. No API/native/core-MCP, existing
test bodies, source predicates, CLI/provisioning/release edits; no peer dispatch,
commits/pushes, real providers, live databases, physical desktop, Keychain,
actual app restart, deployment, real cards or private signatures. Same scope
remains approved on resumption. Peer4898/4998 are excluded; own5198/5197/5199
only via stock sandbox. Parent owns final freeze, independent verification and
qualification; signed candidates are stale until that freeze. Actual restart
requires separate AJ authorization, not granted here.

## Phase 0: frozen executable contract / RED
Read shipping AGENTS, memory snapshots, prior67d shipping approval-engine run,
regression registry, five complete supplemental tests, crypto helper, Cloud
contract and identity service before implementation. Original criteria: all
five selected files (33 tests) pass unchanged; unknown bearer ->401 from an
available rejecting Cloud fixture; unchanged Cloud control retains offline
503 AUTH_UNAVAILABLE; no source/test mutation, remote auth, credentials in
fixture evidence, native desktop or Keychain. Parent independently reruns the
runner without editing tests/source. Mandate: make existing assertions pass,
never change them.

RED command (API package):
```bash
env -i PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin HOME=/private/tmp/hermes-shipping-approval-engine-20261014-fixture DB_CLIENT=sqlite RHYTHM_OPENCODE_ENGINE_PORT=5197 RHYTHM_AGENT_URL=http://127.0.0.1:5198 RHYTHM_API_BASE=http://127.0.0.1:5198 RHYTHM_CLOUD_API_URL=http://127.0.0.1:5198 PROD_API_URL=http://127.0.0.1:5198 RHYTHM_OPTIMIZER_MODE=shadow ../../tools/dev/.hermes-shipping-runtime/node/bin/node node_modules/vitest/vitest.mjs run src/__tests__/hermes_approvals.test.ts src/__tests__/human_approval_signature.test.ts src/__tests__/expired_approval_decide.test.ts src/__tests__/approval_not_required_on_clean_session.test.ts src/__tests__/issue_1134_external_content_security.test.ts --no-file-parallelism
```
Actual exit1,8.23s:32 PASS/1 FAIL. Line147 expected401, received503;
actual AUTH_UNAVAILABLE PATCH in the real createApp/in-memory fixture. This is
the intended environmental RED, not a missing import or weakened product guard.
Baseline SHA256s (whole files, stronger than body-only preservation):
- hermes_approvals: f6fc0dfc56a78c08783e58b0324270456eae9c841cabb6181bf12b63d6f8dfa0
- human_approval_signature: 1c8ae61daba815940e85edb61db9c0eb1cee233499db6fc73a65f354ae43eb6c
- expired_approval_decide: c008369b739d69e33b3f10189de20bbfcec32f72d7b0d9d044bac68a219d80fa
- approval_not_required_on_clean_session: 66e5e3ee774c7b993ea9672994a6f7e94756307da258588a90be604b83213aa6
- issue_1134_external_content_security: eb3fdc4e2a730b82f0d108ec1eb9f2906cfc8e619dde41204e5e0fdfeb07cfe3
- local_agent_cloud_token_auth control: f23c0d3077e5e5868f79da6f82a33a10287e3853cd64126103ec3ca79ba0cd13

## Phase 1 complete: bounded impact / safety review
GitNexus upstream impact for new hermes_shipping_auth_checks.mjs -> target not
found, UNKNOWN (no indexed caller/process data, not a zero-risk claim). No
existing symbol edited. Reviewed whole intended helper surface: canonical
synthetic builder, sandbox runtime environment/build/start/down ownership,
P-256 and trusted-MCP test credentials, in-memory repositories, actual unit HTTP
server, Cloud identity constructor and control hooks. Both Cloud URL variables
must be set before child initialization. Exact Cloud GET /auth/me401 only;
headers/tokens never inspected, bodies never read, no cookies or forwarding.
Invalid method400, other request targets404; bounded HTTP timeouts. Child
loopback transport guard refuses remote/Unix transports and live/peer ports;
proxies removed. Source/binary snapshots qualify only this bounded run, not the
dirty worktree. Normal memory-generated crypto signatures are unit coverage,
not a physical desktop or actual human decision qualification.

## Files / implementation
New runner uses fresh canonical source-builder fixture root, read-only0400 DB
and safe local MCP config corrected to5198, private sandbox HOME, PURE/models
fetch disabled, pinned Node/binary, stock up/status/down. Separate metadata-only
local provider GET models fixture can never emit an LLM completion. Supplemental
actual API/owner/signature/security paths remain unmocked. Existing Cloud
contract hooks retain their own Cloud fetch fixture and thrown offline failure;
forcing HTTP503 would NOT test AUTH_UNAVAILABLE (service treats non-ok as a
known rejection). This is intentionally not changed.

GREEN/verifier command (shipping root):
```bash
tools/dev/.hermes-shipping-runtime/node/bin/node tools/dev/hermes_shipping_auth_checks.mjs
```
Max two test-setup repairs; any product failure is reported, not repaired here.

## Phase 2 complete: actual results / teardown
First implementation run, no setup repair required:
```bash
tools/dev/.hermes-shipping-runtime/node/bin/node --check tools/dev/hermes_shipping_auth_checks.mjs && tools/dev/.hermes-shipping-runtime/node/bin/node tools/dev/hermes_shipping_auth_checks.mjs
```
Exit0. Fresh canonical fixture builder passed; stock API strict tsc/postbuild
and MCP noCheck build passed. Actual sandbox API99692 on5198/gateway5199,
engine99878 on5197; stock status confirmed all three. Runtime uses the same
pinned fork d60f5a42930ddb824184242da36dd4a4fffd6d8f4460ff5faf03e0dc09afa072
with skip-engine-build1, not a newly qualified fork build.

Supplemental JSON report: **33 PASS/0 FAIL/0 pending**, all five selected files:
Hermes5, human signature4, expiry3, clean session4, external security17.
Exactly **one actual GET /auth/me ->401**, no unexpected Cloud requests. That
real external HTTP reply closes the former line147 failure; local owner lookup,
human capability/P-256 signature validation and trusted-MCP guards were not
mocked. Ordinary generated crypto fixtures do NOT prove a native user click.
Existing Cloud contract: **10 PASS/0 FAIL/0 pending**, including c5 known401,
c6 two offline503 AUTH_UNAVAILABLE denials/no cache, c8 env-owned verification
URL, c9 no bearer logging. Control runs in a separate fresh Vitest process with
the same scoped child env; unchanged hooks replace only its Cloud fetch and
its existing engine fixture. It made no request to the HTTP Cloud helper.
No regression waiver, source/assertion weakening or stale32-pass promotion.

Four boundary checks passed before SUT run: exact GET401, other GET404,
unknown query404, POST400, all no Set-Cookie. Counters reset before actual units.
Metadata-only fixture **0 GET/0 completion requests**; it never returned LLM
output. Engine merely loaded the safe declared local provider. PURE/default
plugins disabled/models fetch disabled; no real provider credentials used.
Child env is an allowlisted replacement (no inherited production auth/proxies),
both Cloud URLs set before Vitest imports; HOME/XDG/TMP paths under sandbox,
DB_PATH=:memory:, existing test DBs all in memory. Cloud fixture never reads,
captures or forwards headers/tokens/bodies. External network transport is denied
by private preload; this guard is not an API/auth/signature mock.

Private evidence (retained, not overwritten):
- `/private/tmp/hermes-auth-cloud-20261014-fixture/receipt-1750eebf-8733-472a-bd84-07fd158bf976.json`
- `/private/tmp/hermes-auth-cloud-20261014-fixture/supplemental-29e6eb6b-cdf7-4504-b953-0637325865a1.json`
- `/private/tmp/hermes-auth-cloud-20261014-fixture/control-8f7f0f8d-2a6c-478a-8c1f-3f9d3b28fa56.json`
Receipt records exact internal commands/exit0 counts, 19 source/test fingerprints
before/after and pinned binary before/after; every comparison passed. Separate
post-run `shasum -a 256` on the six frozen test files exactly matched the Phase0
hashes above: entire bodies byte-identical. New runner SHA256
`27f6b8c03276c985755fece0282fc99c01c8be34389af5bf07958e7ca013fa6c`;
private guard SHA256 `d3c23810b3bbec2fbd6c85640b66945a395cef58f7bf6fa35282c6e55e43824c`.

Additional focused check (shipping root):
```bash
tools/dev/.hermes-shipping-runtime/node/bin/node --require ./tools/dev/hermes_shipping_auth_test_helper/loopback.cjs -e "const a=require('node:assert/strict'),n=require('node:net'); for(const o of [{host:'example.invalid',port:443},{path:'/tmp/not-a-fixture.sock'},... [4001,4096,4898,4998].map(port=>({host:'127.0.0.1',port}))]) a.throws(()=>new n.Socket().connect(o),/auth fixture forbids/); console.log('transport guard: 6 forbidden targets rejected before connect');"
git diff --check
/usr/sbin/lsof -nP -iTCP:5198 -iTCP:5197 -iTCP:5199 -sTCP:LISTEN
```
Guard exit0: six forbidden targets rejected **before connect**; diff check exit0.
lsof exit1/no output: all owned ports free. Stock down exit0 removed only the
owned sandbox; ephemeral Cloud and metadata helpers closed. Read-only fixture
DB/config and receipts remain for independent verification. No peer port touched,
physical desktop/native test, Keychain, real approval, app restart or deploy.

## Handoff: READY_SECURITY_AUTH_FIXTURE / READY_FOR_VERIFICATION
Only three new owned files changed. Parent independent verifier runs the GREEN
command above, with tests/product source read-only; runner writes only its owned
private fixture/sandbox and stock canonical generated build outputs. No broad
all-repo/native/live-desktop/release qualification claim. Source fingerprints
are this slice's evidence, not a whole-worktree freeze. Parent must freeze after
peers, independently rerun, then own commit and qualification CI. Actual restart
still needs fresh AJ approval; none inferred from build/test authorization.
