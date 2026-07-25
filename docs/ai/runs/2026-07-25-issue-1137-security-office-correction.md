---
date: 2026-07-25
repo: Rhythm
branch: codex/1137-final-corrective
pr: null
issues: [1137, 1169]
status: verified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Issue #1137 mobile security and Office-reader correction

## Files changed

- `apps/api_server/src/services/mobile_opencode_proxy.ts`
  - Validate every `session.prompt` and `session.prompt_async` file part before
    forwarding: accept canonical contained `file:` URLs and valid `data:` URLs;
    reject missing, malformed, non-file/data, outside-root, traversal, and
    symlink-escape targets.
- `apps/opencode_fork/packages/app/src/components/prompt-input/files.ts`
  - Inspect complete bytes for every non-image/non-PDF attachment, including
    declared text MIME, using fatal UTF-8 decoding plus control-byte checks.
- API, browser, mobile-real-engine, and DOCX live regressions.
- `apps/api_server/src/__tests__/live_e2e_1137_any_file_reader_discovery.test.ts`
  - Replaced serialized substring matching with field-level proof over persisted
    OpenCode tool parts. The gate now requires a completed `skill` call whose
    `state.input.name` is exactly `document-creation`, a later completed `bash`
    call whose `state.input.command` includes `read_office_docs.py`, and an
    assistant `rawText` marker after both calls.
  - Added regression coverage proving prompt/text mentions, a running call,
    an inexact skill name, and a marker before the calls cannot satisfy proof.
- `apps/mobile/contracts/rhythm-opencode-contract.json`
  - Regenerated the OpenAPI fingerprint after the cumulative fork SDK changes.
- `apps/api_server/src/__tests__/issue_723_mcp_remove_reconcile.test.ts`
  - Use the existing v2 SDK test seam so the full Vitest VM never invokes the
    production dynamic-import loader.
- `docs/ai/contracts/issue-1137.json`
  - Added and passed criteria c9-c11.

## Checks run

### Structured-proof red and focused green

Red command, run from `apps/api_server`:

```bash
npx vitest run src/__tests__/live_e2e_1137_any_file_reader_discovery.test.ts --reporter=verbose
```

Observed before the parser correction:

```text
Test Files  1 failed (1)
Tests  2 failed | 2 skipped (4)
Received:
{
  "assistantText": "I should call document-creation and read_office_docs.py. DOCX_READER_PROOF_STRUCTURED",
  "bashCommand": "read_office_docs.py",
  "skillInputName": "document-creation",
}
```

Green commands, run from `apps/api_server`:

```bash
npx vitest run src/__tests__/live_e2e_1137_any_file_reader_discovery.test.ts --reporter=verbose
npm run build
```

Observed:

```text
Test Files  1 passed (1)
Tests  2 passed | 2 skipped (4)
Duration  154ms
> rhythm-api-server@0.1.0 build
> tsc -p tsconfig.json
> rhythm-api-server@0.1.0 postbuild
> node -e "require('fs').mkdirSync('dist/security',{recursive:true});require('fs').copyFileSync('src/security/advisories.json','dist/security/advisories.json')"
```

### Dedicated live sandbox

Preflight listener command, run from the repository root:

```bash
for port in 4001 4096 4097 4098 5497 5498; do pids=$(lsof -nP -t -iTCP:$port -sTCP:LISTEN 2>/dev/null || true); if [ -n "$pids" ]; then echo "$port LISTENING $pids"; else echo "$port FREE"; fi; done
RHYTHM_SANDBOX_DIR=/tmp/rhythm-dev-sandbox-1137-structured-proof RHYTHM_SANDBOX_ENGINE_PORT=5497 RHYTHM_SANDBOX_API_PORT=5498 tools/dev/sandbox.sh status
```

Observed before launch:

```text
4001 LISTENING 58644
4096 FREE
4097 LISTENING 47510
4098 LISTENING 47484
5497 FREE
5498 FREE
sandbox: /tmp/rhythm-dev-sandbox-1137-structured-proof
api :5498 listener:
engine :5497 listener:
```

The foreign listeners on 4001, 4097, and 4098 were not stopped or modified.

Launch command, run from the repository root in a persistent terminal:

```bash
RHYTHM_SANDBOX_DIR=/tmp/rhythm-dev-sandbox-1137-structured-proof RHYTHM_SANDBOX_ENGINE_PORT=5497 RHYTHM_SANDBOX_API_PORT=5498 tools/dev/sandbox.sh up
```

Observed terminal tail:

```text
Smoke test passed: 0.0.0-codex/1137-final-corrective-202607251037
> rhythm-api-server@0.1.0 build
> tsc -p tsconfig.json
> rhythm-api-server@0.1.0 postbuild
> node -e "require('fs').mkdirSync('dist/security',{recursive:true});require('fs').copyFileSync('src/security/advisories.json','dist/security/advisories.json')"
Sandbox ready: http://127.0.0.1:5498 (engine :5497)
```

Health commands:

```bash
curl -fsS http://127.0.0.1:5498/health
curl -fsS http://127.0.0.1:5498/opencode/health
```

Observed:

```text
{"status":"ok","service":"rhythm-api-server","commit":"dev"}
{"status":"ready","message":"Opencode SDK ready","websearchConfigured":false}
```

Live command, run from `apps/api_server`:

```bash
RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:5498 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:5497 RHYTHM_LIVE_DB_PATH=/tmp/rhythm-dev-sandbox-1137-structured-proof/rhythm.db RHYTHM_SANDBOX_DIR=/tmp/rhythm-dev-sandbox-1137-structured-proof DB_PATH=/tmp/rhythm-dev-sandbox-1137-structured-proof/rhythm.db RHYTHM_MANAGED_SKILLS_DIR=/tmp/rhythm-dev-sandbox-1137-structured-proof/home/.config/opencode/skills npx vitest run src/__tests__/live_e2e_1137_any_file_reader_discovery.test.ts --reporter=verbose
```

Observed:

```text
RUN  v4.1.1 /Users/ajhochhalter/Documents/rhythm-worktrees/run0724-review-1137-final/apps/api_server
✓ issue #1137 structured DOCX reader proof > rejects serialized mentions without completed skill and bash tool parts 1ms
✓ issue #1137 structured DOCX reader proof > requires completed exact tool inputs before the assistant marker 1ms
✓ live E2E — #1137 arbitrary file reader discovery > asserts native and browser reader discovery independently after rejecting a symlink escape 8977ms
✓ live E2E — #1137 arbitrary file reader discovery > extracts a known marker from a valid DOCX through the existing document reader 19459ms
Test Files  1 passed (1)
Tests  4 passed (4)
Start at  03:38:23
Duration  28.63s (transform 40ms, setup 0ms, import 65ms, tests 28.46s, environment 0ms)
```

Teardown command, run from the repository root in the same persistent terminal:

```bash
RHYTHM_SANDBOX_DIR=/tmp/rhythm-dev-sandbox-1137-structured-proof RHYTHM_SANDBOX_ENGINE_PORT=5497 RHYTHM_SANDBOX_API_PORT=5498 tools/dev/sandbox.sh down
```

Observed:

```text
Sandbox removed: /tmp/rhythm-dev-sandbox-1137-structured-proof
```

Postflight listener command:

```bash
for port in 4001 4096 4097 4098 5497 5498; do pids=$(lsof -nP -t -iTCP:$port -sTCP:LISTEN 2>/dev/null || true); if [ -n "$pids" ]; then echo "$port LISTENING $pids"; else echo "$port FREE"; fi; done
if [ -e /tmp/rhythm-dev-sandbox-1137-structured-proof ]; then echo "sandbox path still exists"; else echo "sandbox path removed"; fi
```

Observed after teardown:

```text
4001 LISTENING 58644
4096 FREE
4097 LISTENING 47510
4098 LISTENING 47484
5497 FREE
5498 FREE
sandbox path removed
```

The foreign listener PIDs were unchanged; the dedicated ports were free and
`/tmp/rhythm-dev-sandbox-1137-structured-proof` no longer existed.

### Canonical gates after the structured-proof correction

- Browser attachment suite: 16 passed.
- Mobile proxy suite: 11 passed.
- Fork prompt suite: full file passed.
- Mobile Playwright: 15 passed.
- `VITEST_MAX_WORKERS=4 ai-workflow checks --level issue`: passed Flutter
  analyze/format plus API and MCP typechecks.
- `VITEST_MAX_WORKERS=4 ai-workflow checks --level pr`: passed Flutter
  analyze/format/tests, API lint/full Vitest/build, MCP tests/build, fork
  typecheck/session tests, and mobile static/contract/fake-server/web E2E.
- `node .gitnexus/run.cjs detect-changes --scope unstaged --repo Rhythm`:
  LOW, 3 files / 5 symbols / 0 affected processes.
- `node .gitnexus/run.cjs detect-changes --scope compare --base-ref main --repo Rhythm`:
  CRITICAL cumulative branch scope, 461 files / 2,329 symbols / 21 affected
  processes. This is the inherited #1076–#1175 integration delta; the new
  correction contains no production symbol change.

### Shared-port guard correction

Red command, run from `apps/api_server`:

```bash
npx vitest run src/__tests__/live_e2e_1137_any_file_reader_discovery.test.ts --reporter=verbose
```

Observed before robust URL parsing:

```text
✓ issue #1137 structured DOCX reader proof > rejects serialized mentions without completed skill and bash tool parts 1ms
✓ issue #1137 structured DOCX reader proof > requires completed exact tool inputs before the assistant marker 1ms
× issue #1137 live endpoint isolation > refuses all shared API and engine ports before any request 13ms
  → promise resolved "undefined" instead of rejecting
✓ issue #1137 live endpoint isolation > allows a dedicated API and engine port pair 1ms
Test Files  1 failed (1)
Tests  1 failed | 3 passed | 2 skipped (6)
Duration  185ms
```

Focused green commands, run from `apps/api_server`:

```bash
npx vitest run src/__tests__/live_e2e_1137_any_file_reader_discovery.test.ts --reporter=verbose
npm run build
```

Observed:

```text
✓ issue #1137 structured DOCX reader proof > rejects serialized mentions without completed skill and bash tool parts 1ms
✓ issue #1137 structured DOCX reader proof > requires completed exact tool inputs before the assistant marker 1ms
✓ issue #1137 live endpoint isolation > refuses all shared API and engine ports before any request 2ms
✓ issue #1137 live endpoint isolation > allows a dedicated API and engine port pair 8ms
Test Files  1 passed (1)
Tests  4 passed | 2 skipped (6)
Duration  199ms
> rhythm-api-server@0.1.0 build
> tsc -p tsconfig.json
> rhythm-api-server@0.1.0 postbuild
> node -e "require('fs').mkdirSync('dist/security',{recursive:true});require('fs').copyFileSync('src/security/advisories.json','dist/security/advisories.json')"
```

Preflight command, run from the repository root:

```bash
for port in 4001 4096 4097 4098 5497 5498; do pids=$(lsof -nP -t -iTCP:$port -sTCP:LISTEN 2>/dev/null || true); if [ -n "$pids" ]; then echo "$port LISTENING $pids"; else echo "$port FREE"; fi; done
RHYTHM_SANDBOX_DIR=/tmp/rhythm-dev-sandbox-1137-url-guard RHYTHM_SANDBOX_ENGINE_PORT=5497 RHYTHM_SANDBOX_API_PORT=5498 tools/dev/sandbox.sh status
```

Observed:

```text
4001 LISTENING 58644
4096 FREE
4097 LISTENING 47510
4098 LISTENING 47484
5497 FREE
5498 FREE
sandbox: /tmp/rhythm-dev-sandbox-1137-url-guard
api :5498 listener:
engine :5497 listener:
```

Launch command, run from the repository root in a persistent terminal:

```bash
RHYTHM_SANDBOX_DIR=/tmp/rhythm-dev-sandbox-1137-url-guard RHYTHM_SANDBOX_ENGINE_PORT=5497 RHYTHM_SANDBOX_API_PORT=5498 tools/dev/sandbox.sh up
```

Observed terminal tail:

```text
Smoke test passed: 0.0.0-codex/1137-final-corrective-202607251104
> rhythm-api-server@0.1.0 build
> tsc -p tsconfig.json
> rhythm-api-server@0.1.0 postbuild
> node -e "require('fs').mkdirSync('dist/security',{recursive:true});require('fs').copyFileSync('src/security/advisories.json','dist/security/advisories.json')"
curl: (7) Failed to connect to 127.0.0.1 port 5498 after 0 ms: Couldn't connect to server
curl: (7) Failed to connect to 127.0.0.1 port 5498 after 0 ms: Couldn't connect to server
Sandbox ready: http://127.0.0.1:5498 (engine :5497)
```

Health and listener commands:

```bash
RHYTHM_SANDBOX_DIR=/tmp/rhythm-dev-sandbox-1137-url-guard RHYTHM_SANDBOX_ENGINE_PORT=5497 RHYTHM_SANDBOX_API_PORT=5498 tools/dev/sandbox.sh status
curl -fsS http://127.0.0.1:5498/health
curl -fsS http://127.0.0.1:5498/opencode/health
for port in 5497 5498; do pids=$(lsof -nP -t -iTCP:$port -sTCP:LISTEN 2>/dev/null || true); if [ -n "$pids" ]; then echo "$port LISTENING $pids"; else echo "$port FREE"; fi; done
```

Observed:

```text
sandbox: /tmp/rhythm-dev-sandbox-1137-url-guard
api :5498 listener: 55983
engine :5497 listener: 56004
{"status":"ok","service":"rhythm-api-server","commit":"dev"}
{"status":"ready","message":"Opencode SDK ready","websearchConfigured":false}
5497 LISTENING 56004
5498 LISTENING 55983
```

Live command, run from `apps/api_server`:

```bash
RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:5498 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:5497 RHYTHM_LIVE_DB_PATH=/tmp/rhythm-dev-sandbox-1137-url-guard/rhythm.db RHYTHM_SANDBOX_DIR=/tmp/rhythm-dev-sandbox-1137-url-guard DB_PATH=/tmp/rhythm-dev-sandbox-1137-url-guard/rhythm.db RHYTHM_MANAGED_SKILLS_DIR=/tmp/rhythm-dev-sandbox-1137-url-guard/home/.config/opencode/skills npx vitest run src/__tests__/live_e2e_1137_any_file_reader_discovery.test.ts --reporter=verbose
```

Observed:

```text
RUN  v4.1.1 /Users/ajhochhalter/Documents/rhythm-worktrees/run0724-review-1137-final/apps/api_server
✓ issue #1137 structured DOCX reader proof > rejects serialized mentions without completed skill and bash tool parts 1ms
✓ issue #1137 structured DOCX reader proof > requires completed exact tool inputs before the assistant marker 1ms
✓ issue #1137 live endpoint isolation > refuses all shared API and engine ports before any request 2ms
✓ issue #1137 live endpoint isolation > allows a dedicated API and engine port pair 8ms
✓ live E2E — #1137 arbitrary file reader discovery > asserts native and browser reader discovery independently after rejecting a symlink escape 6806ms
✓ live E2E — #1137 arbitrary file reader discovery > extracts a known marker from a valid DOCX through the existing document reader 26220ms
Test Files  1 passed (1)
Tests  6 passed (6)
Start at  04:05:02
Duration  33.22s (transform 42ms, setup 0ms, import 73ms, tests 33.05s, environment 0ms)
```

Teardown command, run from the repository root in the same persistent terminal:

```bash
RHYTHM_SANDBOX_DIR=/tmp/rhythm-dev-sandbox-1137-url-guard RHYTHM_SANDBOX_ENGINE_PORT=5497 RHYTHM_SANDBOX_API_PORT=5498 tools/dev/sandbox.sh down
```

Observed:

```text
Sandbox removed: /tmp/rhythm-dev-sandbox-1137-url-guard
```

Postflight command:

```bash
for port in 4001 4096 4097 4098 5497 5498; do pids=$(lsof -nP -t -iTCP:$port -sTCP:LISTEN 2>/dev/null || true); if [ -n "$pids" ]; then echo "$port LISTENING $pids"; else echo "$port FREE"; fi; done
if [ -e /tmp/rhythm-dev-sandbox-1137-url-guard ]; then echo "sandbox path still exists"; else echo "sandbox path removed"; fi
```

Observed:

```text
4001 LISTENING 58644
4096 FREE
4097 LISTENING 47510
4098 LISTENING 47484
5497 FREE
5498 FREE
sandbox path removed
```

The foreign listener PIDs were unchanged and no foreign process or worktree
was modified.

## Notes

- The first live launch was reaped when its non-interactive shell exited.
  Failure triage classified this as environment/flake; relaunching the same
  isolated sandbox through a persistent terminal produced the green evidence.
- The first PR gate exposed three pre-existing environment/harness problems:
  missing mobile dependencies, a stale generated contract hash, and an
  issue-723 test that bypassed the class's v2 test seam. `npm ci`, contract
  regeneration, and the intended test seam resolved them; the canonical gates
  then passed from the top.
- No follow-up issue was filed; no production database or foreign listener was
  touched.
