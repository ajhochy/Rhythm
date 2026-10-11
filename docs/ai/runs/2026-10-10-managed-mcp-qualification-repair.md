---
date: 2026-10-10
repo: Rhythm
branch: codex/rhythm-deliverables-completion-20261010
pr: null
issues: []
status: unverified
tags: [run, rhythm]
---

## Files

Bounded source repair against b0be44bbbd1f52cf23981057fc7e1133af8979f0:

- `opencode_client_service.ts`, only `ensureRhythmMcp`: explicit options override the managed engine environment path (`RHYTHM_OPENCODE_CONFIG_PATH`, then `OPENCODE_CONFIG_DIR`); ordinary home fallback remains. Managed/explicit persistence uses the colocated deletion store unless explicitly overridden. Identical offline configuration is byte-identical and performs no native work. Native ensure requires MCP registration and config-cache invalidation even when persisted bytes already match; error envelopes, thrown registration errors, and failed reloads reject with `SDK_ERROR`. Errors added here do not expose credential bodies.
- `qualification_fixture_service.ts`, only `dayflow`: real canonical notes now share the declared private `<manifestRoot>/memory` vault scanned by normal sync/rebuild. Per-fixture journals/configs/ledgers/namespaces and genuine consent/source proofs remain separate and unchanged.
- New `qualification_dayflow_vault_survival.spec.ts` and `vitest.qualification-vault.config.ts`: dedicated confined temporary-files/in-memory-SQLite regression, real Dayflow producer/canonical writer, normal sync/rebuild, existing resolver owner restoration and independent changed-content/foreign-owner refusals. Mocked engine and startup authority mean this is source evidence only. `.spec.ts` avoids the ordinary `src/**/*.test.ts` lane; execute only with the required OS profile.

## Checks

Read parent diagnosis `dayflow-installed-68-admission-diagnosis.md` first. Parent-owned frozen MCP regression before repair: **8 failed / 2 passed**, safely confined; evidence `managed-mcp-confined-red.json` and `managed-mcp-acceptance-freeze.json` in the private completion evidence directory. Child did not execute or edit that frozen regression/config; parent owns its repaired-source rerun.

Before edits, exact upstream GitNexus impacts on `Rhythm-deliverables-completion`: `ensureRhythmMcp` LOW (3 impacted, 1 direct; actual route/app/server callers inspected); fixture `dayflow` HIGH (4 impacted, 1 direct, 3 modules). Parent had emitted the user-facing HIGH warning. No other production symbol changed.

All child test executions used this exact command from `apps/api_server`:

`/usr/bin/sandbox-exec -f /Users/ajhochhalter/Documents/Codex/2026-10-10/rhythm-deliverables-completion/managed-mcp-regression.sb ./node_modules/.bin/vitest run --config vitest.qualification-vault.config.ts --configLoader=runner --no-cache`

- Original nested-vault implementation: **1 failed / 0 passed**, 1.59s. Real normal sync observed `scanned=0 upserted=0 deleted=1`; the original previously valid canonical candidate then resolved to null. Earlier harness setup lacked the declared normal vault directory and therefore exercised the existing missing-vault preservation gate instead; creating that owned directory reproduced the actual tombstone failure.
- Repaired shared-vault implementation: sync observed `scanned=1 upserted=1 deleted=0`; normal rebuild indexed1 and existing canonical resolver restored its null-owner projection. A foreign-owner challenge initially lacked a user FK fixture; adding the second invented public owner fixed that test setup. Independent content and foreign-owner challenges use a separately revalidated clean baseline.
- Final confined command after renaming the new regression to `.spec.ts`: **1 passed**, 1.55s. All assertions include genuine source consent/candidate, canonical survival, owner restoration without a fake pass row, changed bytes refused, and foreign owner preserved/refused.
- `npm run build`: **exit 0**, API TypeScript and advisory postbuild, including a final run on the repaired source.
- Repository-root `git diff --check`: **exit 0**.
- Frozen MCP test contents/config before parent rename remained hashes `eb905a46908c7b559410061ed5dfd662e3d4b8bc2796270b13cfdc27401e3fb5` / `161e32e16322fb2b7fdc5d6abd08d1628018b83e0ac259de07efc3d0db631b41`. Parent acceptance owner is changing only its extension/config include to isolate the lane; child made no such edits.
- Original frozen completion JSON/spec remain `0f62e7628510ec2d42505b19c79965883e894c9f6537411c08b8a3c3b3940056` / `daf485744766dc7a54ed8b760848fb7c69cc8cdeb9881aef029e0c628d3bddce`.

## Notes

No scope deviation. No live app/backend, provider, auth/approval, installed bundle, current fixtures/database, normal config, original checkout, npm install, commit, push, or restart was touched. Kernel confinement denied network and normal user-config access for every child test. API compile opened no engine/socket.

Installed admission remains **UNVERIFIED** on the repaired source. Native trusted transport, genuine Rhythm authentication, current canonical proof, receiving enrollment, prepared provider overlay and final retained-history checks must be observed on a rebuilt candidate. The .68 live failures remain historical FAIL evidence. No successful model completion follows from an actual provider attempt, and the separate OpenAI refresh401 still needs genuine reauthentication. Coordinator metadata adapter and broader config/index services were deliberately not changed. Root owns independent acceptance, detect-changes, packaging/install and live qualification.

### Independent status review correction

Read-only review found that native MCP.add may return HTTP200 with a StatusMap containing `rhythm.status='failed'` (or disabled/configured/missing), so absence of an SDK error envelope was insufficient. Source remained frozen until root captured the strengthened confined regression: **8 failed / 10 passed**, `normalFilesUnchanged=true`, evidence `managed-mcp-status-confined-red.json`.

Only the previously impacted `ensureRhythmMcp` was then amended: both returned data and its named rhythm entry must be non-array objects, with exact status `connected`, before config reload or a `registered:true` result. All missing/malformed/nonconnected states throw body-free `SDK_ERROR`. No acceptance test execution or modification by this child followed.

`/usr/bin/sandbox-exec -f /Users/ajhochhalter/Documents/Codex/2026-10-10/rhythm-deliverables-completion/managed-mcp-regression.sb npm run build` from `apps/api_server`: **exit 0**, TypeScript and advisory postbuild. `git diff --check`: **exit 0**. New frozen acceptance spec/config hashes remain `02c95dd77fbce8399e27d7c393e95aa0ea5665a39e0fe2b6905af24293f23a54` / `8d259556fd0bb74dcf4b34b69f669377384d3ecf2552b4e6ae416a6fed7fe11d`; original completion contracts unchanged. Repaired client SHA256 `be44f369ea01548e48fc8484526d86866eb40ba5610284716313d9743084954f`. Source-only status correction remains unverified pending root's frozen acceptance rerun and installed native evidence.

## Independent root gate

After the status repair, root ran the dedicated acceptance command through `run-confined-managed-mcp-contract.py managed-mcp-status-confined-green`: **18 passed**,553ms,exit0, normal config/deletion hashes unchanged. The preceding status RED had8 failed/10 passed with unchanged normal hashes. Only the new source regression was strengthened; the original installed acceptance JSON/spec hashes are unchanged. The dedicated `.spec.ts` files are excluded from ordinary `src/**/*.test.ts` collection. Source review found no remaining blocker in the two-method scope.

A prior unconstrained contract-author run touched the normal OpenCode Rhythm MCP entry and may have changed the deletion marker. Root stopped execution and used the actual app's normal authenticated frontend refresh; the invented value is gone. Exact prior bytes/deletion intent remain unknown. App/API/engine PIDs and boot identities did not change. All subsequent regression runs used the independently verified OS profile with network and normal user configuration access denied. Evidence: `managed-mcp-regression-isolation-incident.json`, `normal-config-supported-refresh-observation.json`, and the confined RED/GREEN receipts in the completion evidence directory. This incident limits any claim that the entire qualification session left normal user data unchanged.

Full installed qualification is still pending: no genuine human-approved manager/worker workflow or actual resulting-artifact receipt is established by these source checks.
