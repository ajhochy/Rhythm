---
date: 2026-10-01
repo: Rhythm
branch: codex/opencode-memory-recovery
pr: 1598
issues: [1603]
status: verified-scoped
tags: [run, rhythm]
---

## Files

Summary generation now projects only snapshot boundaries from SQLite, reads only the selected user's metadata without its old patch array, and coalesces overlapping requests per session. Two workers may compute summaries concurrently. A newer queued request survives failure or cancellation of its owner within the service lifetime. Snapshot content reads and patch generation are bounded; omission metadata reaches Electron/web and mobile.

The new `apps/api_server/src/__tests__/issue_1603_summary_memory_live.test.ts` uses a synthetic local provider through the real API WebSocket and real compiled fork. Its provider changes a disposable Git repository only after the real engine persists a step-start snapshot. It checks 18 files, line counts, an exact small patch, oversized/aggregate omission, persisted assistant output, process RSS, and both health endpoints.

## Checks

Candidate: base `1870574248c4f48883fd828263615cff6e9e5871` plus the issue-1603 working diff. These results are not final Mega or installed-app qualification.

From the worktree root:

```sh
node tools/dev/sandbox_fixture.mjs /private/tmp/rhythm-memory-1603-fixtures-20261001
env RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-memory-1603-fixtures-20261001 RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-memory-1603-fixtures-20261001/rhythm.db RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-memory-1603-fixtures-20261001/opencode.json RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-memory-1603-sandbox-20261001 DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow OPENCODE_DISABLE_DEFAULT_PLUGINS=1 OPENCODE_PURE=1 RHYTHM_NUMBAT_MONITORING_DISABLED=1 tools/dev/sandbox.sh up --foreground
```

`up` built this fork, API, and MCP; engine/API/gateway listened only on 4097/4098/4099. Synthetic source DB/config were read-only; no operator app data was used.

From `apps/api_server`:

```sh
env RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-memory-1603-sandbox-20261001 DB_CLIENT=sqlite DB_PATH=/private/tmp/rhythm-memory-1603-sandbox-20261001/rhythm.db RHYTHM_LIVE_URL=http://127.0.0.1:4098 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 ./node_modules/.bin/vitest run src/__tests__/issue_1603_summary_memory_live.test.ts --maxWorkers=1 --no-file-parallelism
```

Exit 0: 1 test passed, 1.50 seconds. Receipt: 18 files; 995,234 patch bytes; 8 omitted previews; peak engine RSS 505,680 KiB; 12 health samples; maximum combined API/engine health latency 27 ms; one generation request. This is a bounded synthetic regression, not an attempted recreation of a 50 GB incident.

The first live attempt timed out because its fixture provider mutated files during discovery before the baseline snapshot; both engine snapshot hashes were identical. The fixture was corrected to wait for a persisted step-start, then passed. No production code or assertion threshold was changed to resolve that harness error.

Fork: `bun test test/session/summary-memory.test.ts test/snapshot/snapshot-memory.test.ts test/snapshot/snapshot.test.ts --timeout 30000` — 57 passed, 1 existing Unicode skip, 0 failures, 1,433 assertions. `bun run typecheck` and API `tsc --noEmit` exited 0. Additional UI checks are in the companion snapshot receipt.

`gitnexus detect-changes --repo /Users/ajhochhalter/Documents/Rhythm --scope all --limit 30` reported 12 tracked files/34 symbols, LOW, no indexed processes. The index is four commits behind; new untracked files were independently inspected. Expected scope is summary/snapshot, additive SDK types, and patch-preview consumers.

The identical `up` environment was used for `tools/dev/sandbox.sh status` and `down`. Status attributed API/gateway to PID 35271 and engine to PID 35290. `down` exited 0 and removed the owned sandbox, retaining sanitized diagnostics at `/private/tmp/rhythm-memory-1603-sandbox-20261001.evidence.XMxIqL`. The small JSON receipt was retained outside the sandbox.

## Notes

Incident evidence supports amplification from repeated summary jobs hydrating large saved patches and constructing unbounded full-file diffs. No heap capture exists, so this does not prove every byte of the reported peak came from that path. Saved conversations and the installed app were left untouched. Combined delivery, final CI, signed installation, and TestFlight remain separate gates.

Rendered Electron/web diff consumer: `./node_modules/.bin/playwright test --config tests/gateway/issue-1603-diff-omission-playwright.config.ts` from `apps/web` — 1 passed (4.9s). The fixture intercepts all API/engine traffic at the native addresses allowed by the unchanged document CSP; no API/engine is started on those ports. It proves the real gateway retains the exact patch and omission field, and the Changes panel displays both correctly. Earlier legacy phase-6 fixture attempts were blocked by the document CSP because their mock addresses used sandbox ports. The dedicated fixture corrected its addresses instead of changing production CSP or bypassing it.

Post-teardown `lsof -nP -iTCP:4097 -iTCP:4098 -iTCP:4099 -sTCP:LISTEN` returned no listeners (exit1).
