---
date: 2026-10-01
repo: Rhythm
branch: opencode/delivery-electron-approval-queue-20261001
pr: 1598
issues: [E1]
status: BLOCKED
tags: [run, Rhythm]
---

# E1 approval queue — provenance gate BLOCKED

## Files

Only this run note and `docs/ai/contracts/task-e1-approval-queue.json` were added. No product edits, tests added, dependency provisioning, runtime operation, signing, commit, push, PR or bundle mutation.

## Checks

Every shell command used explicit workdir:
`/Users/ajhochhalter/.local/share/opencode/worktree/a4784d9c54aa2929a09fdab2213ff827a3cb60a5/delivery-electron-approval-queue-20261001`.

1. `git status --short --branch && git rev-parse HEAD` (exit 0): clean branch `opencode/delivery-electron-approval-queue-20261001`, HEAD **1870574248c4f48883fd828263615cff6e9e5871**. Dispatch requires **c1b7e023fbd85774fe447078cfe410f228dee539**.
2. `git log -3 --oneline && git diff --stat c1b7e023fbd85774fe447078cfe410f228dee539 HEAD` (exit 0): HEAD `18705742 fix(mobile): simplify chat setup and improve composer layout`; parent `3a8821cd Squash test temp-directory cleanup into mega PR (#1602)`; parent `c1b7e023 docs(ai): record mega consolidation 2026-09-29 (PR #1598)`. Divergence: **22 files, 1438 insertions, 168 deletions**, including mobile, API test setup, fork fixtures and documentation. These are existing committed changes, not this slice's diff.
3. Read `AGENTS.md` first; loaded acceptance-contract as first action. Read project state/current plan/testing guide, parent `2026-09-30-regressions-delivery-context.md`, full installed approvals/trigger attribution handoff, scoped approval gateway/signer/Shell/store hydration/decision block/Transcript banner, and D's `installed-attribution.{mjs,md}` read-only. D files unchanged.
4. Read of owned `apps/web/node_modules` returned file not found. No dependencies installed or borrowed from main. This is a secondary test prerequisite, not evidence a test failed.
5. GitNexus list/query and consolidated upstream impact analysis used index path `/private/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/rhythm-mega-temp-cleanup-integration`, indexed baseline c1b7e023. Index reported one commit behind its current source; results are advisory, not proof of complete runtime coverage.
6. `git diff --check && git status --short && git diff --numstat && git diff --name-only` (exit 0): only the two new documentation files untracked; tracked name/numstat output empty. Git diff does not include untracked documentation; no product changes or tracked changes. This is hygiene evidence only, not acceptance-test validation.

### Consolidated impact disclosure (no edits)

| Exact symbol | File | Risk | Direct dependents | Total blast radius / indexed processes |
|---|---|---|---|---|
| FixtureProvider | apps/web/src/store.tsx | MEDIUM | 6 test harness files: session-retention, issue-1579-strict, electron-e40, electron-e22, electron-e21, directory-picker | 6 / 0 |
| decideApproval | apps/web/src/store.tsx | LOW | 0 indexed; source Shell calls it through context | 0 / 0 |
| Shell | apps/web/src/components/Shell.tsx | LOW | App | 3: App → renderGateway → main.tsx / 0 |
| PendingApprovalBanner | apps/web/src/components/Transcript.tsx | LOW | renderContent | 3: renderContent → Transcript → AgentsWorkspace / 0 |
| createLiveApprovalGateway | apps/web/src/gateway/approvals.ts | LOW | createLiveGateway | 10 across composeGateway/main/test harnesses / 0 |
| humanApprovalCapability | apps/web/src/security/humanApprovalSigner.ts | LOW | 0 indexed; gateway imports/uses it in source | 0 / 0 |
| signApprovalDecision | apps/web/src/security/humanApprovalSigner.ts | LOW | decideApproval | 1 / 0 |

Intended scope remains only approval hydration/decision state, scoped gateway validation/actionable failure reporting, outer Shell discovery/status/retry and shared Transcript association; signer changes only if missing-native failure is reproduced. No demonstrated reason to edit API guards or Electron IPC. No HIGH/CRITICAL findings in this candidate set; no informed HIGH approval invented. Empty graph process lists do not establish no runtime impact.

## Notes / phase status

- **Phase 0 incomplete, not waived:** acceptance supplied and recorded, but no executable behavioral contract written/run. Provenance verification failed before implementation/test setup. There is **no failing behavioral reproduction** and no PASS claim.
- Phase 1 candidate impact assessed; no permission to substitute a different baseline. Phase 2 not started.
- Source confirms one-shot shared hydration and silent non-array-to-empty fallback; independent Transcript catch clears its rows. These are candidate defects, not a reproduced installed root cause. Reload-resistant missing cards still require actual supported GET/frame receipt.
- Original IDs `27db624a-0bb2-4fc7-a177-8988dec76dbe` and `879da510-2ae4-4ee3-b43a-7097b2a73c70` were **not queried**. Their statuses and session association are unverified; persistence loss is not established.
- Native/API/UI/signature/security-negative tests **NOT RUN**. No synthetic approvals created and no decisions sent. No secrets/Keychain/config/DB copied or read. No backend or foreign runtime contacted, started, adopted, restarted or stopped. C1 child724051dd retains sole4098/4097/4099 ownership.
- Installed bundle seal failure is prior read-only investigation evidence, not newly tested here. Existing installed bundle and diagnostic resources untouched. Final replacement-candidate installed smoke remains mandatory and **NOT RUN**; source/mocked tests cannot qualify it.

## Handoff

**BLOCKED — assigned isolated worktree baseline mismatch.** Manager should provide an owned clean worktree at the recorded c1b7e023 SHA, or explicitly hand off the actual newer baseline and corresponding scope/provenance. No reset, checkout, new worktree, merge or baseline substitution was attempted. Then write/run failing behavioral contracts, cross-check source callers against the graph, implement only the reproduced boundary, and run focused checks. Real API/native runtime execution still requires the manager's serial runtime transfer and a final qualified replacement candidate. No question or peer dispatch performed.

## Resume — manager provenance correction (supersedes previous blocked handoff)

Manager explicitly verified PR1598 OPEN/DRAFT/MERGEABLE with six CI successes at Mega head **1870574248c4f48883fd828263615cff6e9e5871** and authorized E1 on that baseline. `git status --short && git branch --show-current && git rev-parse HEAD` confirmed this owned branch/HEAD with only the two previous untracked receipts. Legitimate mobile18705742 and cleanup3a8821cd remain intact; no reset/rebase/main changes. Older slices require parent integration reconciliation. No final packaged qualification follows from upstream CI.

### Phase 0 completed before product edits

- Read AGENTS first and current memory/parent E1 appendix/installed mapping/D's installed harness documentation by absolute paths. Acceptance-contract invoked first; no peers/TodoWrite (tool instructions prohibit it).
- `ls apps/web && npm ci --prefix apps/web --no-audit --no-fund` in owned E1 root: exit0, 80 real locked packages installed. No lock/dependency refresh or borrowed symlinks.
- Verified port5281 free with a bind-and-close Node net probe; made owned external HOME `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/e1-approval-client-home`. Only Vite client fixture is launched by Playwright, never API/engine. All local/hosted HTTP and WebSocket boundaries intercepted before navigation.
- Wrote `apps/web/tests/e1-approval-queue{.spec.ts,-playwright.config.ts}`. Real production App/store/Shell/Transcript/gateway are not mocked; only network/native rejection boundaries are synthetic. No decision sent or signature fabricated.
- Command (explicit workdir owned `apps/web`): `HOME=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/e1-approval-client-home ./node_modules/.bin/playwright test --config tests/e1-approval-queue-playwright.config.ts`.
- First run exit1: two real gateway shape regressions; nine browser cases blocked by fixture CSP. Added existing harness convention `bypassCSP: true` **only in test config**, not product. Re-ran same command before implementation: **11 failed**, now all behavioral assertions: post-mount global/new card not found; persistent error not found for403/503/network/nonarray/schema/native; bell name only `Notifications`; malformed gateway promises incorrectly resolve `{ok:true}` / `[{id:'broken'}]`. This corrected run is red proof, not the initial fixture setup failure.

### Phase 1 completed before product edits

Renewed upstream impacts against explicitly selected indexed repo `/private/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/rhythm-mega-temp-cleanup-integration` (older indexed snapshot; source callers cross-checked): FixtureProvider MEDIUM 6 direct/6 total/0 indexed processes; Shell LOW App direct/3 total/0 processes; PendingApprovalBanner LOW renderContent direct/3 total/0 processes; createLiveApprovalGateway LOW createLiveGateway direct/10 total/0 processes; failureText LOW response direct/3 total/0 processes; decideApproval LOW0 indexed, actual Shell context caller. No HIGH/CRITICAL. Approval-only store scope; no API/native/signer changes established as necessary.

### Phase 2 partial implementation / exact validation

Product edits only four exclusive E1 files:

- `gateway/approvals.ts`: actionable read/network/auth/native errors; strict pending response validation and10s HTTP timeout; retains existing bearer/capability and signed PATCH transport.
- Approval-only `store.tsx`: shared snapshot tagged to gateway identity at render time; focus/online/pageshow/visible resume +5s visible polling/manual refresh; latest-fetch generation fence and last-known preservation on failure; in-flight decision dedupe/native context fence/authoritative refresh.
- `Shell.tsx`: count/error badge, persistent loading/freshness/error/retry and keyboard-accessible actions.
- `Transcript.tsx`: consumes same pending snapshot, exact selected-session filtering; no independent fetch that clears rows on failure.

Repeated contract command above after initial implementation: **11 passed (48.1s), exit0**. `npm run build && npm run test:dist-smoke` in explicit owned `apps/web`: **exit0**, tsc clean, Vite1758 modules built; dist smoke `index and 2 relative assets verified`. Nonfatal existing large-chunk warning. Only owned dist/node_modules/tsbuild outputs, no signed bundle or foreign dependencies.

Additional safety/production-shape checks were authored and run before attempting the newly required nullable interface edit: same Playwright command plus `--grep 'legacy|closed bell|late older|repeated gestures'`: **2 passed,2 failed**. Source repository `AgentApproval.decisionNonce` is `string | null` and controller explicitly handles pre-signature rows. The stricter initial validator incorrectly rejects those rows (and thus valid siblings) instead of showing them read-only. This is a reproduced partial-candidate regression, NOT evidence the two original IDs are legacy. Closed bell also lacks an always-mounted metadata-only live announcement. Latest-response fencing and one native-refusal attempt/zero PATCH pass. No fake signed decision was used.

Final full contract command (same owned HOME/workdir, no edits after critical disclosure): **13 passed,2 failed (1.4m), exit1**. Exact failures:

1. `c2: legacy null-nonce rows stay discoverable without permitting a decision`: `approval-card-legacy` not found (line131).
2. `c3: closed bell announces metadata-only pending count`: `approval-queue-announcement` not found / expected `aria-live="polite"` (line144).

Diagnostics are owned `apps/web/test-results/e1-approval-queue/`, never installed Resources. Fixture-only CSP bypass is not a production CSP change. Browser tests are not native qualification. No existing native/security-negative suite was run; real live/API/native test authoring was not completed before the critical stop. D's established installed-attribution documentation was reused read-only, not modified or run.

### NEW CRITICAL informed-approval gate — STOP BEFORE INTERFACE EDIT

| Disclosure | Exact value |
|---|---|
| Symbol | `PendingApproval` (Interface) |
| File | `apps/web/src/gateway/approvals.ts` |
| Owned repo/worktree | `/Users/ajhochhalter/.local/share/opencode/worktree/a4784d9c54aa2929a09fdab2213ff827a3cb60a5/delivery-electron-approval-queue-20261001` |
| Branch / authorized baseline | `opencode/delivery-electron-approval-queue-20261001` / `1870574248c4f48883fd828263615cff6e9e5871` |
| Indexed repo | `/private/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/rhythm-mega-temp-cleanup-integration` (older snapshot; advisory but gate still mandatory) |
| Intended new scope | Align `PendingApproval.decisionNonce` to actual API `string \| null`; accept legacy null-nonce pending rows without clearing/hiding valid siblings; show legacy cards globally/transcript but disable approve/reject and explain request-again; keep all signed decisions requiring nonempty nonce. No API/signature/security/IPC changes. |
| Risk | **CRITICAL**,453 impacted symbols |
| Direct importers |3: `apps/web/src/store.tsx`, `apps/web/src/gateway/index.ts`, `apps/web/src/components/Transcript.tsx` |
| Blast radius |depth1=3, depth2=191, depth3=259; includes gateway consumers, main/App, harnesses and transitive client imports; returned page truncated at20 per depth |
| Affected processes/modules |Tool reports0 indexed processes/modules; not evidence of no runtime participation |
| Approval status |No manager handoff recording AJ's explicit informed approval for this exact interface/scope. General E1 implementation/baseline authorization does not override this newly disclosed critical gate. |

**No PendingApproval interface edit was made. All further product edits stopped**, including the already-LOW Shell announcement correction. Manager may resume only after recording AJ's informed approval for the exact symbol/scope above; expanded scope requires new review. This is a genuinely new risk/production-shape blocker, not the resolved baseline mismatch.

### Diff / ownership checks

`git diff --check && git diff --name-only && git diff --numstat && git status --short && git rev-parse HEAD` (explicit owned root): exit0; HEAD unchanged18705742; tracked product diff:

```text
10  5   apps/web/src/components/Shell.tsx
2   11  apps/web/src/components/Transcript.tsx
28  2   apps/web/src/gateway/approvals.ts
67  15  apps/web/src/store.tsx
```

Only four additional untracked files: `apps/web/tests/e1-approval-queue-playwright.config.ts`, `apps/web/tests/e1-approval-queue.spec.ts`, `docs/ai/contracts/task-e1-approval-queue.json`, and this existing provenance run receipt. No locks, Composer/fork/mobile/scheduler/W6/companion/API/native files changed. No commit/staging/push/PR/merge/deploy. Parent receipts and newer cleanup/mobile commits preserved.

Final root `git diff --check` remained clean. `git diff --no-index --numstat /dev/null <each-untracked-path>` measured config12/0, spec191/0, contract20/0, run receipt126/0 **before this final statistics note**; each no-index command exits1 normally because the untracked file differs from `/dev/null`. These numbers include the two pre-existing provenance documents, not just this continuation's additions. No staging needed to collect them.

### Current handoff — BLOCKED, partial candidate NOT READY

Baseline gate resolved; client failing reproduction and partial root fix executed. **Do not integrate or call this fixed**: legacy production-shape and closed-bell announcement remain red. Resume needs the exact CRITICAL approval above, then finish the two client assertions and full focused repair loop. Actual API/native contract + existing signer/auth/cross-user/stale-frame suites, real supported creation/GET/nonce-bound gesture/readback, and final replacement installed package smoke remain mandatory after explicit runtime transfer. C1 child724051dd remains sole4098/4097/4099 owner; no lifecycle commands or live4001/4096/foreign runtime contact occurred. Reported IDs27db624a/879da510 remain unqueried and undecided; existing invalid seal was not treated as an approval root cause and was neither cleaned nor resealed.
