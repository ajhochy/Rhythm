---
date: 2026-07-30
repo: Rhythm
branch: codex/fix-memory-injection-relevance
pr: null
issues: [0]
status: pending-live-verification
tags: [run, Rhythm]
---

# P0 memory-injection relevance and persistence boundary

## Engraph schema recon

- Installed binary: Engraph `1.7.2`.
- Evidence command: `strings "$(command -v engraph)"`.
- Installed code reference surfaced by that binary: compiled `src/search.rs:110`
  defines result fields `file_path`, `file_id`, `score`, `headings`, `snippet`,
  and `docid`.
- `engraph search --help` describes `--explain` as a per-lane RRF breakdown,
  and the binary describes the returned `score` as the final hybrid/RRF rank.
- No calibrated similarity or confidence field is exposed by this version.
  The implementation preserves `score` as rank evidence but does not reinterpret
  it as confidence. Automatic semantic injection therefore fails closed for the
  installed path/score-only schema.

No real vault or note body was read during schema recon.

## Threshold fixture corpus

Post-live-gate amendment (orchestrator, same day): the live run exposed two
retrieval defects fixed on this branch — (1) the owner filter used strict
equality, so owned sessions could not retrieve instance-global (owner-NULL)
vault notes; (2) RELEVANCE_STOPWORDS omitted interrogatives/auxiliaries
('when', 'where', 'why', 'will', 'should'), inflating score denominators for
realistic question phrasings. RELEVANCE_STOPWORDS is now derived from the
probe STOPWORDS superset; the stored-preference fixture re-measures at 1.00
(was 0.83). Positives {0.86, 1.00} vs negatives {0.00, 0.25} — separation at
0.60 improved.

`AGENT_MEMORY_INJECTION_MIN_RELEVANCE` defaults to `0.60`. The absolute score is
matched meaningful query tokens divided by meaningful query tokens, with a
minimum of two query tokens and two matches. The contract corpus measured:

| Fixture | Measured score | Expected gate |
|---|---:|---|
| Direct McDonald’s World Cup collector-cup rarity question → matching collector-cup fact | 0.86 | pass |
| Worship Committee scheduling question → matching stored scheduling preference | 1.00 | pass |
| Worship Committee agenda question → McDonald’s collector-cup report | 0.00 | reject |
| Worship Committee agenda question → unrelated committee parking note | 0.25 | reject |

The 0.60 boundary separates both positives from both negatives in the recorded
corpus. Raw rank never bypasses this absolute gate.

## Files

- See the final branch diff for implementation and test files.
- Contract: `docs/ai/contracts/p0-memory-injection-relevance.json`.
- Live contract:
  `apps/api_server/src/__tests__/live_e2e_p0_memory_injection_relevance.test.ts`.

## Checks

### Baseline red, before production-code changes

```text
cd apps/api_server
npx tsc --noEmit
# PASS (exit 0)

npx vitest run src/contract/p0_memory_injection_relevance.test.ts src/contract/p0_memory_injection_ws_persistence.test.ts
# RED: 2 failed files; 13 failed, 7 passed (20 tests)
```

### Implemented green

```text
cd apps/api_server
npx vitest run src/contract/p0_memory_injection_relevance.test.ts src/contract/p0_memory_injection_ws_persistence.test.ts
# PASS: 2 files; 20 passed (20 tests)

npx vitest run src/contract/p0_memory_injection_relevance.test.ts src/contract/p0_memory_injection_ws_persistence.test.ts src/__tests__/memory_injection.test.ts src/__tests__/memory_injection_index.test.ts src/__tests__/memory_retrieval_default_mode_smoke.test.ts src/__tests__/memory_retrieval_semantic.test.ts src/__tests__/memory_semantic_latency_smoke.test.ts src/__tests__/memory_injection_runner.test.ts src/__tests__/skill_injection_runner.test.ts src/__tests__/memory_provenance.test.ts src/__tests__/memory_vault_sync.test.ts src/__tests__/memory_index_rebuild.test.ts src/__tests__/migrations_self_heal.test.ts src/__tests__/migrations_replay_guard.test.ts src/__tests__/opc_711_anthropic_permission_mode.test.ts src/__tests__/opc_m4_1_file_attachments.test.ts src/__tests__/p2_systemprompt_ocagent.test.ts src/__tests__/memory_vault_authority.test.ts src/__tests__/phase6_sharing_postgres_bootstrap.test.ts
# PASS: 19 files; 162 passed (162 tests)
```

```text
cd apps/api_server
npx tsc --noEmit
# PASS (exit 0)
```

GitNexus change detection was invoked as required:

```text
node <gitnexus-1.6.9-cli> detect-changes --scope compare --base-ref main \
  --repo /Users/ajhochhalter/Documents/Rhythm --limit 200
```

It returned HIGH with 1,029 files / 837 symbols, including untouched vendored
files. That result describes the separately indexed parent checkout, not this
worktree. Retrying with this exact worktree and base
`eee9694cd073f2658a565a5e9570c667bb1e0b0c` failed because GitNexus has no
repository entry for `/Users/ajhochhalter/Documents/Rhythm/.worktrees/p0`.
Local `git diff --stat`, `git status --short`, and `git diff --check` were used
to verify that this worktree's actual diff stays within the P0 files listed
above; the missing worktree index remains a verification limitation.

## External live verification (not run in this workstream)

The external orchestrator must use a newly migrated disposable source database;
the test itself seeds and cleans up its users, sessions, notes, preferences, and
FTS rows. It refuses the installed DB and real vault.

```bash
cd /path/to/this/worktree
cd apps/opencode_fork/packages/opencode
bun run build --single
cd ../../../api_server
npm run build
cd ../..

mkdir -p /private/tmp/rhythm-p0-source
node <<'NODE'
const Database = require('./apps/api_server/node_modules/better-sqlite3');
const { runMigrations } = require('./apps/api_server/dist/database/migrations');
const db = new Database('/private/tmp/rhythm-p0-source/rhythm.db');
runMigrations(db);
db.close();
NODE

RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-p0-source/rhythm.db \
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-p0-sandbox \
RHYTHM_SANDBOX_API_PORT=4098 \
RHYTHM_SANDBOX_ENGINE_PORT=4097 \
AGENT_MEMORY_INJECTION_ENABLED=true \
tools/dev/sandbox.sh up

cd apps/api_server
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
RHYTHM_SANDBOX_API_PORT=4098 \
RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-p0-sandbox/rhythm.db \
DB_PATH=/private/tmp/rhythm-p0-sandbox/rhythm.db \
RHYTHM_LIVE_VAULT_PATH=/private/tmp/rhythm-p0-sandbox/vault \
npx vitest run \
  src/__tests__/live_e2e_p0_memory_injection_relevance.test.ts \
  --no-file-parallelism
cd ../..

RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-p0-sandbox \
RHYTHM_SANDBOX_API_PORT=4098 \
RHYTHM_SANDBOX_ENGINE_PORT=4097 \
tools/dev/sandbox.sh down
```

### Result

- Status: pending external orchestrator.
- Observed output: pending.

## Notes

- The operational production mitigation
  `AGENT_MEMORY_INJECTION_ENABLED=false` was not changed.
- No installed database, real memory vault, running process, or production
  environment was touched.
- Historical contaminated transcripts are intentionally unchanged. Any
  retroactive repair requires a separate destructive-data plan and review.
