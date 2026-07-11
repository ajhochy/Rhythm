---
date: 2026-07-11
repo: Rhythm
branch: codex/fix-inert-1014-1007-997
pr: pending
issues: [1014, 1007, 997]
status: pass
tags: [run, Rhythm]
---

# Inert fixes — standalone behavioral verification

## Files

- Fork cache invalidation now clears every directory scope after agent/config reload.
- Scheduled placeholder detection recognizes the scheduler's `Scheduled: <name>` form.
- Skill scoring retries reliable provider-distinct routes and preserves 0/0 candidates
  for gated human review rather than silently discarding them.
- Live acceptance harness: `apps/api_server/src/__tests__/live_e2e_inert_regressions.test.ts`.

## Checks

The fork and API were rebuilt before the live run:

```sh
cd apps/opencode_fork/packages/opencode && bun run build --single
cd apps/api_server && npm run build
```

The API was launched with the rebuilt fork on spare port 4098, an isolated copy
of the local SQLite database, and a minimal isolated HOME. The shipping :4001
process and production database were not used.

```sh
HOME=/tmp/rhythm-inert-green.RXSyyI/home \
PORT=4098 \
DB_CLIENT=sqlite \
DB_PATH=/tmp/rhythm-inert-green.RXSyyI/rhythm.db \
AGENT_LOCAL=true \
RHYTHM_OPENCODE_BIN_DIR=apps/opencode_fork/packages/opencode/dist/opencode-darwin-arm64/bin \
AGENT_RUN_TIMEOUT_MS=180000 \
node apps/api_server/dist/server.js
```

Live contract command:

```sh
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
RHYTHM_LIVE_DB_PATH=/tmp/rhythm-inert-green.RXSyyI/rhythm.db \
RHYTHM_LIVE_SERVER_LOG=/tmp/rhythm-inert-green.RXSyyI/server.log \
npx vitest run src/__tests__/live_e2e_inert_regressions.test.ts --reporter=verbose
```

Observed results after the product changes:

- #1014: after patching `allowedDelegatesJson`, the next turn in the same SDK
  session emitted a real `task` tool call and created a child session. The final
  corrected contract rerun passed in 14.59s.
- #1007: a real trigger-now run produced a content-derived session name containing
  the distinctive north-balcony prompt marker, not `Scheduled: Scheduled run`;
  passed in 44.194s.
- #997: real skills.sh discovery reached the LLM judge; Anthropic and OpenAI were
  unavailable, Google Gemini returned a candidate score of 65, the log recorded
  `candidate=65 vs would-be-draft=0 -> shortlist`, and a human-gated external-adoption
  proposal reached `proposed`; passed in 103.111s.

Before the repairs, the same harness reproduced all three failures: an already-open
session retained the stale roster, trigger-now kept `Scheduled: Scheduled run`, and
the judge remained 0/0 without a proposal.

## Notes

- The #1014 harness was corrected after it initially inspected system/tool-input
  text as assistant success evidence. It now requires a real `"tool":"task"`
  part on the post-PATCH turn, so a fallback MCP call or echoed prompt cannot pass.
- The scorer diagnosis found expired Anthropic credentials, an OpenAI usage-limit
  response, and a 512-function Google error caused by omitting the provider ID at
  session creation. Passing the provider ID activates the Gemini-safe deferred
  MCP allowlist and made the third route succeed.
- External candidates remain high-risk and require explicit human approval. If
  every scorer route is unavailable, 0/0 is surfaced for human review rather than
  treated as evidence that the candidate lost.
