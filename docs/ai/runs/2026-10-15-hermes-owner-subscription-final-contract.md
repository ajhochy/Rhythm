---
date: 2026-10-15
repo: Rhythm
branch: feat/hermes-shipping-rollout-20261014
pr: 1617
issues: [NOTIFY-HERMES]
status: READY_OWNER_SUBSCRIPTION_FINAL_CONTRACT
tags: [run, Rhythm]
---

## Scope / approvals

Explicit parent specialist handoff; frozen HEAD
`12b6521ec2758b377fef5c318a6a90f426b8f6ee` plus existing caf source preserved.
Own ONLY ninth test in `apps/api_server/src/__tests__/hermes_cloud_owner_auth.test.ts`,
qualification paragraph in `docs/ai/guides/hermes-owner-mcp-subscriptions.md`, and
this new note. All five untracked Mac files and all existing dirty source retained.
No API/MCP/CLI core/native/helper/transport/metadata/RoleGroup/Cached_Source_Widget
edits. No live4001/4096, actual app/UI, credentials, provider Internet, Pi/SSH,
enrollment, live cards, dependency installation, artifact build/sign/notary,
commit/push, deployment or destructive cleanup. Canonical disposable sandbox
build/up/status/down only. Existing approval remains resolved, no scope expansion.

## Phase 0 — complete

Loaded acceptance-contract first, coding-agent second. Read old Cloud auth run,
subscription4898 and project-fixture reports, AGENTS, project-state/current-plan
and regression registry. Parent independent34996 evidence is supplied evidence,
not this implementer's independent verification: actual aggregate/MCP114/source/
SSE/native/Chromium/source-visible ACK PASS; regression gate failed old count2.

WAIVED: no new product behavior; test/doc reconciliation only. Nevertheless
reproduced the exact old ninth-test AST predicate before editing:

```sh
python3 -B -c "import ast,pathlib,collections; s=pathlib.Path('tools/dev/hermes_fixture_provision.py').read_text(); t=ast.parse(s); calls=[n for n in ast.walk(t) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='api_call' and len(n.args)>1 and isinstance(n.args[1],ast.Constant) and n.args[1].value=='/hermes-notify/identity']; print('actual identity calls:',len(calls)); assert len(calls)==2"
```

**RED exit1:** `actual identity calls: 4`, `AssertionError`. No candidate product
revert or mocked SUT needed. Original failing full-regression evidence is also
parent34996; this RED is the unchanged AST predicate, not a claimed full9 run.
Mandate: preserve the first eight tests and actual Python transport assertion;
strengthen only stale AST count into exact contexts and direct owner subscripts.
Named checks: exactly4 identity calls; Counter attach_owned_source1,
execute_fixture1, main2; each immediate parent indexes ownerUserId and each call
has exactly args + endpoint/no keywords; no other direct api_call ownerUserId
lookups; no /auth/me anywhere. Reject in-memory fifth call and wrong owner key.
Parent independently verifies final test fix/guide before commit; read-only
source suffices, generated builds/disposable fixtures require writes.

## Phase 1 — complete

GitNexus upstream impact for the exact test path with includeTests returned
UNKNOWN/target not found. No indexed callers/processes available; not proof of
zero risk. Reviewed entire auth test, guide, aggregate, compatibility runner,
CLI four literal identity call sites and API-call argument shape. Only test
and doc changes; risk is accidental assertion weakening or overclaimed proof.
Mitigation: exact fixed Counter, parent AST checks, negative mutations, unchanged
first8/transport byte comparisons and actual auth9/9 plus aggregate rerun.
Historical compatibility helper hardcodes112 before reaching auth tests; source
now legitimately114. Helper edits are excluded. Use its unchanged canonical
lifecycle/auth/build sections in memory, excluding ONLY historical MCP discovery
block; unchanged aggregate independently asserts114. Not a full unmodified
compatibility-runner PASS claim, and no auth assertion is skipped/modified.

## Files

- Auth test: only ninth body; exact AST checks and two in-memory negative cases.
  Python request_json still contacts real source HTTP and asserts version1/owner2;
  stdout still exactly `minimal identity transport PASS`.
- Guide: replaced old5598 STOP paragraph with canonical4898 source proof, exact
  selected-event limits, pending114 source versus installed112, conditional
  cookie-enabled STOP, no dispatch/enrollment/live activation claims.
- This note. No product bug found or product bytes changed.

## Checks — complete

All commands below ran from the shipping worktree, sequential lifecycles.

### Unchanged aggregate — EXIT0

```sh
env -i PATH=/usr/bin:/bin:/opt/homebrew/bin RHYTHM_LIVE_E2E=1 tools/dev/.hermes-shipping-runtime/node/bin/node tools/dev/hermes_owner_subscription_checks.mjs
```

Canonical4898/4897/4899 up/status/down, same four explicit path vars in unchanged
runner; sqlite/shadow/PURE/monitor-off, Node22.23.0, cached engine
`d60f5a42930ddb824184242da36dd4a4fffd6d8f4460ff5faf03e0dc09afa072`.
Strict API build, MCP build/strict emit PASS. API35, MCP4, CLI1 unique (invoked
twice, not2), inventory114 PASS. Actual source `099f1816-a8eb-4310-a427-bb25c2ba64ac`,
native `ba082de96b6c`, selected event `c18d3260-a917-4ae0-969c-cfd3d920a3c2`.
NativeBrowserACKtrue, actualRenameEventtrue, DOM732x24.5 unobscured, receipt1,
foreign/obscured denials PASS, provider effect1/source model0/busyDuplicateReopentrue.
Four revocations + unsubscribe =5 existing SSE closures; retained rows and foreign
control unchanged. Capability read attempts0, registrar/projection/delegationHTTP0,
audited owner MCP requests2, Bridge jobs0. Real project201/FK check PASS.
Evidence `/private/tmp/hermes-owner-subscription-4898-20261015-fixture/owner-native-okoj5el_`;
screenshot SHA256 `e9e2a8e5a4e9be648eb74b82470227ba7a7aa543e00d32361497941f0bc04405`.
Stock teardown retained `.evidence.4v3lWQ`; sandbox removed. Initial curl refusal
was readiness polling, followed by successful up/status and full EXIT0.

### Auth-only compatibility lifecycle — EXIT0, local9 + hosted9

Exact executed command (in-memory extraction, no helper file writes):

```sh
env -i PATH=/usr/bin:/bin:/opt/homebrew/bin RHYTHM_LIVE_E2E=1 tools/dev/.hermes-shipping-runtime/node/bin/node --input-type=module -e 'import {readFileSync} from "node:fs"; import assert from "node:assert/strict"; let s=readFileSync("tools/dev/hermes_cloud_owner_compatibility_checks.mjs","utf8"); const start=s.indexOf("const require=createRequire"), end=s.indexOf("const testEnv=",start); assert.ok(start>0 && end>start); s=s.slice(0,start)+s.slice(end); s=s.replace("resolve(import.meta.dirname,\u0027../..\u0027)","process.cwd()"); assert.ok(s.includes("const root = process.cwd()")); console.log("AUTH-ONLY extraction: unchanged canonical lifecycle, local/hosted9 and strict builds; historical inventory112 excluded, aggregate114 separately verified"); await import("data:text/javascript;base64,"+Buffer.from(s).toString("base64"));'
```

One invocation typo correction: initial extraction searched three-space-indented
markers, failed its preflight assertion BEFORE sandbox startup/tests; corrected
to exact unindented markers above. No failed product/auth check, no test-contract
repair after execution. Pre-execution Python mutation string uses chr(10) to
avoid TypeScript template newline escaping. No second repair attempt needed.

Canonical5498/5497/5499 up/status/down used identical env from helper lines28–34,
all four fixture paths, cached engine SHA above, safe sqlite/shadow/PURE flags.
Fixture `/private/tmp/hermes-auth-compatibility-20261014-fixture`, sandbox
`/private/tmp/hermes-auth-compatibility-20261014-sandbox` (not a new manual server).
Source HTTP tests use sandbox HOME/TMPDIR, :memory: DB and controlled pre-import
loopback Cloud fixture; real auth/resolver/handlers/Python transport are NOT mocked.
No remote Cloud defaults. Canonical full-server health/engine200, local identity
exact version1/owner1, missing bearer401. Cloud UID9001→local2 source HTTP tests
and hosted no-fallback semantics unchanged. Strict API/MCP emit exit0; model0.
Receipt `compatibility-receipt-a0e0e2b8-ab82-4b26-a3cf-cc45dc550c98.json` in fixture
root records7 command exits all0; local report
`local-07818fc0-e3cf-4789-ac8c-06e704161d8f.json`9 PASS, hosted report
`hosted-daf6b85d-6cd3-4f86-8239-627f4540ef43.json`9 PASS. Both negative AST
mutations execute inside ninth check in both modes, and original stdout PASS.
Counts overlap other suites; no inflated aggregate total or extra broad suite.

## Frozen bytes / teardown / handoff

Before/after SHA256 across sorted unique git cached+untracked nonignored regular
files, excluding ONLY the3 assigned paths:12082 files,
`227c9646aa63d31b8f4339e29704890a083e7bdbd28918e68868f2fb4feca001`, identical.
Digest input per file: path UTF8 + NUL + SHA256(file bytes). This covers all
nonassigned product sources/helpers/native pins and five untracked Mac files.
Explicit HEAD comparison confirmed test prefix before ninth and suffix from
`p = runpy.run_path(sys.argv[1])` through EOF byte-identical. `git diff --check`0.

Final assigned hashes:
- Auth test `9d6fecee9294175d4c00979f239fa6141213291b4963c04e2f750e39a92c8b8c`.
- Guide `2e19bce4b3140f10b500204971cbf41e6ec0505d1555cca5864f0c47c42256ad`.
- This log is new; no self-referential hash recorded inside it.

Both fixture DB/config pairs remain0400; both owned sandbox directories absent.
Final lsof checked4898/4897/4899 and5498/5497/5499: exit1/no listeners for each.
No live app/source/provider/credential action; no commit/push or release.
Selected-event provider1 proof is not all-source-event delivery or native-process
restart proof (both NOT RUN). Snapshot107+patch7 overlap union110; fixed V2 native
receiver untouched. Parent reports114 in PR1617; source commit/CI/future0.18.79
qualification and artifact-specific restart approval remain parent-owned.

**READY_OWNER_SUBSCRIPTION_FINAL_CONTRACT / READY_FOR_VERIFICATION.** Parent must
independently exercise this exact test fix and qualify the guide before commit;
prior34996 native proof remains valid for unchanged product bytes. No renewed
scope approval, product rewrite, new login, enrollment or activation is implied.

## Parent final independent gate and release preparation

Verifiercc3d262a-b9c2-40b1-8af7-4e7679a2f5c8 returned
**PASS_OWNER_MCP_SUBSCRIPTION_FINAL** on the complete current scripts, without
extracted/omitted blocks: full Cloud compatibility local9/hosted9 and real114
inventory; real approval engine4pass/8signed calls/1task/1consumption/7downstream
HTTP refusals; complete owner aggregate API35/MCP4/CLI1unique plus actual native
Chromium/source ACK; and shipping MCP smoke114/unauthorized read denied.
These stages overlap; counts are not a summed unique total.

Independent external probes confirmed immutable saved SID409, profile/body-owner/
callback400, missing bearer401, foreign admin404, repeated disable200 without
reactivation, and independently manageable source. Bridge and Recipe children
could not be reclassified through agent_session subscriptions, including after
revocation; original origins remained intact. Four source revocations and disable
closed five established SSE readers; journal/source rows remained retained.

Fresh selected source5609e38d-8dc3-4999-a173-6380e6a5ee0b, nativeSID9e33a7801142,
event654bf925-6293-4cbc-a478-305f157f1a23: provider1/source-model0/Bridgejobs0,
visible receipt and tombstone2 after reopen. Screenshot inspected normal unobscured
reply732x24.5; screenshotSHA e9e2a8e5a4e9be648eb74b82470227ba7a7aa543e00d32361497941f0bc04405.
Evidence:/private/tmp/hermes-owner-subscription-4898-20261015-fixture/owner-native-d7muhy78.
No capability files or registrar/projection/delegation routes were accessed.

All12086 nonignored regular file identities matched before/after, manifestSHA
4271ee7c282d8b1fbb5cf1d4ebac9b9ad509de011923a780d06c59cb02f4827c.
Source DB/config0400 preserved; all stock sandboxes removed and owned ports free.
No source edits by verifier. This documentation append is a subsequent parent
checkpoint, not part of that prior freeze fingerprint.

Parent next: commit/push this tested implementation, report112+2=114 tools on
PR1617, dispatch qualification-only0.18.79 on the exact completion SHA. No merge,
tag, release publication, app replacement or restart authorized by this gate.
Running0.18.78 lacks these new subscription tools; live4001/operator deployment,
all-source event delivery and native-process restart are NOTRUN. Native receiver
and client schema stayed unchanged; this is source/fixture proof, not live Pi
activation. Existing approval/engine action boundaries remain intact.
