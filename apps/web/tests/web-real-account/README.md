# AJ-only real-account verification

These four checks are a separate real-account set. They have been authored from current source; live Recon/Confirm remains for the root operator. They are not part of the 93-case synthetic parity denominator and currently provide no real-account pass evidence.

The suite creates at most one new local Cookbook recipe, one private cloud task, and one private cloud HTML artifact. Every record contains `[rhythm-web-e2e <full UUID>]`. The task owner comes from `/cloud/auth/me`, never the local numeric ID. Server startup already binds cloud Google subject/email to the validated local owner. No exported credential, live database, private account file or synthetic fixture is read by this harness.

Coverage:

- Cookbook UI create/delete, API update of that exact new record, UI reload and backend readback. The existing UI has no edit control. The recipe is never run or bound to a profile.
- Private AJ cloud task UI create/edit/complete/reload/delete. No collaborator, assignment, schedule, source, share, or notification recipient is added. The completion service excludes the actor.
- Read-only narrow Tasks navigation and reload through the cloud proxy.
- Private artifact public API create/update/delete, revision/hash/state readback and a standalone browser render. This does **not** qualify Dashboard import, tab persistence or artifact editor UI. Dashboard tabs are avoided because opening them writes existing user preferences.

All browser/Node writes are limited to prepared creates and exact IDs acknowledged by this run; unknown writes, account/settings/preferences changes, collaborators, messages, agent turns, recipe execution and shares are rejected. Browser WebSockets are closed for these inert record flows. No response is mocked. Traces, screenshots and video are disabled to avoid retaining unrelated account content. The attached ledger contains only the run marker, owned IDs, status and public candidate identity.

## Final candidate prerequisite

The root operator must first build/sign and launch the final candidate normally, with one runtime owning 4001/4096, and verify its AJ owner binding and exported cloud credential without exposing the credential. This suite never starts or stops a backend. Supply a new public receipt, owned regular nonsymlink file mode0600, after launch:

```json
{
  "schemaVersion": 1,
  "kind": "web-real-account-candidate-v1",
  "appPath": "/absolute/canonical/path/Rhythm.app",
  "sourceRevision": "FULL_40_HEX_COMMITTED_REVISION",
  "apiPid": 12345,
  "enginePid": 12346,
  "localOwnerId": 1
}
```

The helper checks the public bundled `api_server/build-identity.json`, exact engine runtime version/PID/ports, engine executable within that app, current listener PIDs, bootstrap owner/cloud availability, cloud health and cloud identity. `/health.commit` is not used as revision proof because it can be `dev`. The root operator remains responsible for exact signed API/asset provenance in the final launch receipt.

From `apps/web`, after supplying real values:

```sh
RHYTHM_WEB_REAL_ACCOUNT=1 RHYTHM_LIVE_E2E=1 \
RHYTHM_WEB_PUBLIC_ORIGIN=http://rhythm-web.test:4001 \
RHYTHM_WEB_REAL_EXPECTED_REVISION=<full-40-hex-revision> \
RHYTHM_WEB_REAL_CANDIDATE_RECEIPT=<absolute-public-receipt.json> \
./node_modules/.bin/playwright test --config tests/web-real-account/playwright.config.ts
```

No paid/model flags or browser bearer are needed. Without both explicit opt-ins the tests skip before receipt access. Static commands, from repository root:

```sh
npm run build:guard -- ./apps/web/node_modules/.bin/tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --esModuleInterop --skipLibCheck --types node apps/web/tests/web-real-account/real-account-fixture.ts apps/web/tests/web-real-account/real-account.spec.ts apps/web/tests/web-real-account/playwright.config.ts
./apps/web/node_modules/.bin/playwright test --config apps/web/tests/web-real-account/playwright.config.ts --list
```

## Cleanup contract

Every test runs `finally` cleanup, with worker teardown as a final check unless cleanup already stopped the run. Normal DELETE uses only exact created IDs after checking marker, owner and private/no-collaborator state; no SQL purge or broad deletion is allowed. Cookbook/task GET must return404 and catalog must omit the ID. Artifact owner GET must return410 with `artifact_deleted`, and catalog must omit the ID; retained server tombstones/content are normal deletion, not a physical-purge claim.

A lost acknowledgement can be recovered only for an actually dispatched create's full random title. The ledger is retained in a new mode0700 `/private/tmp/rhythm-web-real-*` directory. Cleanup failure sets `blocked`, stops the serial suite (`maxFailures:1`, no retries), and reports every known leftover ID plus the ledger path. Do not rerun after cleanup failure until the root operator resolves those exact IDs and records absence. Unknown create IDs are flagged in `pendingCreates`; never delete unrelated rows to make a rerun pass.

Source contract references: `services/web_host.ts`, `services/web_cloud.ts`, `controllers/agentCookbookController.ts`, `repositories/agent_cookbook_repository.ts`, `controllers/tasks_controller.ts`, `services/notification_service.ts`, `controllers/live_artifacts_controller.ts`, `components/ToolWorkspace.tsx` (LiveCookbookTool), `pages/tasks/index.tsx`, `pages/dashboard/LiveArtifactsShell.tsx`. Existing synthetic Cookbook/cloud specs are retained for their meaningful UI/backend assertions; this separate set adds actual-account custody and private ownership gates without importing those fixtures.
