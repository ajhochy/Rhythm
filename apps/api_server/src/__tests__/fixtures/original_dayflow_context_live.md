# Original Dayflow live proof — retained synthetic fixtures

Owner files: `original_dayflow_context_live_e2e.test.ts` and this new fixture guide only.
No browser surface: deterministic HTTP/provider capture is appropriate; no computer control.

## Status / triage

- Existing qualification/provider harness: KEEP as meaningful source-contract tests; engine frames,
  reader and canonical resolver are disclosed stand-ins, **not live evidence**.
- Existing scheduled live suite: KEEP as previous S1/S2/S4/S5 evidence only; not imported here because
  its cleanup deletes fixtures. Neither that suite nor grid/provider fixtures are modified.
- Corrected permitted signed-tool interactive/Coordinator, generic interactive boundary,
  revoked + recovery, foreign + marker: **NOT RUN** on this frozen correction.
- Parent retained prior permitted R3 result: **FAIL** (1 failed / 6 skipped). Ordinary `pwd` prompt
  requested no signed Dayflow read and was not eligible for the Coordinator automatic overlay.
  That evidence remains unchanged, not promoted to PASS.
- Unavailable, expired, scheduled-unavailable: **BLOCKED / NOT RUN**. Explicit failing live tests
  keep these gates visible. A hold is never success for optional-context authorized work.
- FOREIGN here combines a genuine prior exposure with an acknowledged synthetic project change
  and sticky marker. It proves marker enforcement/preservation, not independent detection of an
  unmarked foreign reference. Unmarked foreign-source detection remains **NOT RUN**.

## Manager prerequisites (activation belongs to parent)

Already-running sandbox only: `/private/tmp/sdmr-grid-sandbox`, API 4398, engine 4397,
gateway 4399. This suite starts only its dedicated scripted provider on **7483** when live-enabled.
No install, remote provider/account, real key, live app data, private transcript, lifecycle or deletion.
All fixtures and recovery sessions remain. Provider retains only messages in process memory; no
request headers, credentials, captures or raw transcripts are logged or written to disk.

1. Under `RHYTHM_APPROVED_FIXTURE_ROOT` outside the sandbox, supply a read-only synthetic
   Dayflow SQLite journal, and a read-only synthetic config source copied into the sandbox state.
   Actual reader schema: `timeline_cards(id,start_ts,end_ts,title,summary,detailed_summary,
   category,subcategory,metadata,is_deleted)`. `id` positive integer; timestamps integer epoch
   seconds; `is_deleted=0`; text columns bounded UTF-8. Use exactly one card, summary exactly
   `OD_SYNTHETIC_OBSERVATION`, in a completed historical interval within the current UTC activity
   day (04:00 boundary), never a future interval. Parent's approved 2026-10-09 05:00–06:00 fixture
   is valid; retain its `source-provenance.json` and do not replace it with a new unapproved journal.
   No sensitive instructions/secret-like content. This is actual DayflowSqliteSource input, not
   `fixture-v1`, MutableReader or injected service.
2. Through `/dayflow-integration/readiness/check` POST `{bundlePath: journalAbsolutePath}` then
   `/dayflow-integration/config` PUT `{sourceSelectionToken: readinessResponse.selectionToken}`
   select the journal.
   Configure UTC/enabled, authenticate user1 and grant `/dayflow-agent/source-consent` POST
   `{schemaVersion:1,action:"grant",sessionId,projectId}`, then enable `automaticImport:true`.
   Config is private at the state
   directory selected by `resolveDayflowIntegrationStateDir()`; by default beside the DB under
   `dayflow-integration`. Do not seed fake source authority or invent qualification hashes.
3. Keep **two distinct receiving fixtures** in the already-consented synthetic project:
   - `sessionId`: ordinary API-owned user1 nonchild/nonsystem project chat, **not** a designated
     primary Coordinator. Its ordinary prompt uses the actual signed Dayflow read path.
   - `coordinatorSessionId`: optional for ordinary-only runs, required for automatic-overlay case;
     returned by authenticated gateway `/coordinator-conversations/resolve` POST
     `{projectId: approvedProjectId}` or existing setup. Resolve creates/replays a dedicated inert
     root; **open alone is not designation**, and resolve does not adopt an arbitrary API chat.
     Parent prepares eligible authorized project/profile configuration and records the actual root.
     The Coordinator test replays resolution and checks persisted primary scope before dispatch;
     the ordinary test never uses that root or relabels its dispatch as C2.
   No hand-edited conversation/dispatch rows. Project catalog existence alone is not ownership.
   Both roots use the same approved loopback profile, selecting provider
   `original-dayflow/scripted`, configured in sanitized engine config with
   `@ai-sdk/openai-compatible`, `baseURL:http://127.0.0.1:7483/v1`,
   synthetic `apiKey:od-synthetic-only`, tool calling enabled. No live account routing.
   Profile permissions must be exactly serialized
   `{"*":"ask","bash":{"*":"ask","pwd":"allow"}}`. No persisted MCP grant is added.
   Scripted discovery/description precede actual `rhythm_recent_dayflow_summaries({limit:1})`;
   the suite waits for exactly that discovered read's pending permission and replies **once**.
   It never replies always, approves a different tool, or approves any bash/write request.
   Keep all generic security fences. Parent configures
   the actual root's normal permission mode through the authorized API if needed; the root must
   still ask for the scripted bash write. The genuine local Rhythm MCP server must be loaded with
   its signing/authenticated API wiring; no shell stand-in may supply Dayflow tool results.
   Root cwd must be an existing sandbox subdirectory. Genuine importer/index entries must be
   owner1 and match source consent/project; do not relabel owner-null memory as API-owned proof.
4. Put this manifest in a retained sandbox directory; identifiers come from actual API/seed results:

   ```json
    {"schemaVersion":1,"syntheticOnly":true,"sessionId":"ACTUAL_ORDINARY_ROOT_ID",
     "coordinatorSessionId":"ACTUAL_RESOLVER_RETURNED_PRIMARY_ROOT_ID",
    "projectId":"ACTUAL_PROJECT_ID","profileId":"ACTUAL_PROFILE_ID",
    "foreignProjectId":"ACKNOWLEDGED_OTHER_SYNTHETIC_PROJECT_ID",
    "journalPath":"APPROVED_ROOT/dayflow.sqlite",
    "configPath":"SANDBOX_STATE/dayflow-integration/config.json"}
   ```

Run **one targeted case at a time**, with the relevant genuine receiving root and matching current
source consent. Revocation and FOREIGN intentionally leave the root held and fixtures retained;
do not reuse it for a later PERMITTED case. Global source-consent changes need manager serialization
with other fixture owners. Writer does not activate/provision any of these paths.
Parent triage efe6a4cf (07:56:59) supersedes the earlier NULL-owner diagnosis: the existing
`DayflowCanonicalEvidenceResolver.resolve` safely claims a **unique NULL-owner projection only
after receipt-bound canonical note/hash/source checks**, using the repository's bounded claim.
Parent currently observed NULL marker false / owned true / unexpired receipt true; remaining
cause is **UNKNOWN**. NULL ownership alone is not established product failure. Preserve this
genuine resolver path; do not hand-edit owner rows, consent, receipts or hashes to satisfy the suite.
Shared-memory investigation/repair remains separately owned and untouched here.

## Executable commands

From `apps/api_server`, use existing installed binaries only. Manager supplies the actual sandbox
DB-copy path, isolated HOME/TMPDIR and manifest path (not the read-only source DB):

```sh
env HOME="$ISOLATED_HOME" TMPDIR="$ISOLATED_TMPDIR" DB_PATH="$SANDBOX_DB_COPY" \
  RHYTHM_LIVE_DB_PATH="$SANDBOX_DB_COPY" RHYTHM_SANDBOX_DIR=/private/tmp/sdmr-grid-sandbox \
  RHYTHM_APPROVED_FIXTURE_ROOT="$APPROVED_SYNTHETIC_ROOT" \
  RHYTHM_ORIGINAL_DAYFLOW_FIXTURE="$SANDBOX_MANIFEST" \
  RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_ORIGINAL_DAYFLOW=1 \
  RHYTHM_LIVE_URL=http://127.0.0.1:4398 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4397 \
  ./node_modules/.bin/vitest run src/__tests__/original_dayflow_context_live_e2e.test.ts \
  -t 'PERMITTED interactive'
```

Other exact selectors: `PERMITTED Coordinator`, `generic interactive actual`, `REVOKED`, `FOREIGN`, `UNAVAILABLE optional`,
`EXPIRED optional`, `AgentRunner scheduled`. Last three intentionally fail UNVERIFIED until a
safe real-reader setup is supplied and implemented; they are not unit-wire proof.

Offline skip/type checks (no provider started):

```sh
env -u RHYTHM_LIVE_ORIGINAL_DAYFLOW HOME="$ISOLATED_HOME" TMPDIR="$ISOLATED_TMPDIR" \
  DB_PATH="$ISOLATED_TMPDIR/typecheck-only.db" \
  ./node_modules/.bin/vitest run src/__tests__/original_dayflow_context_live_e2e.test.ts
env HOME="$ISOLATED_HOME" TMPDIR="$ISOLATED_TMPDIR" DB_PATH="$ISOLATED_TMPDIR/typecheck-only.db" \
  ./node_modules/.bin/tsc --noEmit --skipLibCheck --esModuleInterop --target ES2023 \
  --module commonjs --moduleResolution node --types node \
  src/__tests__/original_dayflow_context_live_e2e.test.ts
```

## Observable assertions / missing entrypoints

- Coordinator automatic-overlay foreground only: authenticated primary-root resolution, exactly one new
  durable native-message dispatch, `origin=prompt_api`, `requested_source=session`, `route_authed=1`,
  `reason_code=c2_foreground`, `outcome=accepted`. These checks run before inspecting provider capture.
- PERMITTED: real provider messages contain observation, timestamps and qualified provenance,
  evidence-only fence; canonical index row owner1; real exposure manifest retained; actual pwd
  result contains sandbox cwd and assistant finishes. Second turn exercises actual SDK continuation.
- Ordinary signed-tool interactive case: ordinary authenticated `/agent-sessions/:id/prompt`,
  native dispatch binding with **no C2 marker**, then real dispatcher discovery → description →
  execution of returned canonical `rhythm_recent_dayflow_summaries({limit:1})`. Exactly its pending
  read permission is approved **once**. Actual provider-received **tool result** must contain fenced,
  timestamped observation, and V1 candidates must be persisted by receiving authority. Automatic
  overlay alone cannot pass. A subsequent ordinary `pwd` turn proves retained-history continuation;
  a write still asks approval and remains unexecuted despite the one-time read approval.
- Generic interactive boundary is retained as a separate real-tool case: fresh API-owned
  projectless chat discovers/describes/calls the actual recent-summaries MCP tool, with one-time read
  permission, receives bounded unavailable output with no
  canonical observation, cannot acquire V1 dependencies, and still executes authorized `pwd`.
  A direct generic prompt is not relabeled as an eligible Coordinator turn.
- Permissions: scripted write produces pending bash approval, marker absent, reply is **reject**,
  file remains absent. No blanket approvals or tool execution substitutions.
- Coordinator: foreground enters gateway `/coordinator-conversations/message`, using actual open
  result's control revision, then proves provider context, real pwd and pending/rejected write.
  No status-card-only pass.
- REVOKED: genuine exposure first; authenticated revoke; no subsequent provider call; exposure
  remains; fresh API-owned projectless session executes pwd without revoked observation.
- FOREIGN: genuine exposure first; only sandbox session project/marker changed; no provider call;
  original exposure and exact sticky marker remain. Does not prove unmarked foreign detection.
- UNAVAILABLE missing setup: reproduce an actual **dated reader failure**, not disabled config,
  missing consent or no configured source. Management routes cannot inject reader status.
  Manager must supply current journal binding/config plus safe repeatable failure while preserving
  read-only source. Writer may not restart backend, alter approved source or fake the service.
- EXPIRED missing setup: real qualified receipt persisted in `ownership-ledger.json`, matching
  canonical note and user1 index, with expired `reference.expiresAt`; automatic importer must not
  silently renew it before admission. No exposed API sets receipt expiry or test clock. Need
  manager-prepared dated/expired fixture or approved deterministic entrypoint; no fabricated grant.
- Scheduled unavailable must use actual `/agent-schedules` + trigger-now/AgentRunner once the
  source failure is reproducible. Schedule API has no existing-session resume selector. Continuation
  and safe recovery above use real prompt API, not renamed scheduler criteria.

No live acceptance PASS claimed from type/skip checks. Manager records eventual results against
final built source/runtime in the run log; this owner does not modify shared documentation/logs.

## Writer offline check record (2026-10-08)

Retained isolated check directory: `/private/tmp/original-dayflow-writer-check-20261008`.
Exact commands from `apps/api_server` (existing binaries, no install/network):

```sh
env -u RHYTHM_LIVE_ORIGINAL_DAYFLOW \
  HOME=/private/tmp/original-dayflow-writer-check-20261008/home \
  TMPDIR=/private/tmp/original-dayflow-writer-check-20261008/tmp \
  DB_PATH=/private/tmp/original-dayflow-writer-check-20261008/typecheck-only.db \
  ./node_modules/.bin/vitest run src/__tests__/original_dayflow_context_live_e2e.test.ts
env HOME=/private/tmp/original-dayflow-writer-check-20261008/home \
  TMPDIR=/private/tmp/original-dayflow-writer-check-20261008/tmp \
  DB_PATH=/private/tmp/original-dayflow-writer-check-20261008/typecheck-only.db \
  ./node_modules/.bin/tsc --noEmit --skipLibCheck --esModuleInterop --target ES2023 \
  --module commonjs --moduleResolution node --types node \
  src/__tests__/original_dayflow_context_live_e2e.test.ts
```

Observed: Vitest `Test Files 1 skipped (1)`, `Tests 7 skipped (7)`; targeted TypeScript
check exit 0/no diagnostics. Both are offline check **PASS**, not acceptance proof.

## Receiving-path correction impact (2026-10-09)

GitNexus impact: **UNKNOWN** — `gitnexus impact` tool unavailable in this session; owned new
test helpers are not known to be indexed. Static upstream caller review before editing:
`dispatch` → `historical`, `approvalStillRequired`, generic/recovery checks;
`historical` → permitted ordinary interactive/Coordinator, revoked and foreign cases;
`approveReadOnce` → signed historical and projectless boundary case;
`resolveCoordinator`/primary/provenance helpers → Coordinator automatic-overlay case only.
Scripted-provider changes affect only this opted-in suite's discover→describe→signed read→pwd sequence.
No production symbols, shared memory code, router/grid fixtures, authority rows or receipts edited.
Scope: test-only; shared-memory diagnosis remains separately owned, cause UNKNOWN.

Correction offline checks: same isolated commands above, **PASS** — targeted TypeScript exit 0
with no diagnostics; env-unset Vitest `Test Files 1 skipped (1)`, `Tests 8 skipped (8)`.
All corrected live cases remain **NOT RUN**; unavailable/expired/scheduled-unavailable remain
explicit **UNVERIFIED** gates. The earlier failed live artifact remains a failed artifact.

Parent executes proof on the frozen files. No source/runtime activation, provider launch, live
case, provisioning, credential action or evidence cleanup was performed by this writer.

Latest correction supersedes the earlier freeze and exact-read-grant proposal: ordinary interactive
is **not** Coordinator foreground; no permanent read permission is required or installed. Rechecked
after this revision with the exact isolated commands: TypeScript exit 0/no diagnostics; Vitest
`Test Files 1 skipped (1)`, `Tests 8 skipped (8)`. New live acceptance is still **NOT RUN**.
