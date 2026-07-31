# Project State

## Current focus

2026-07-30: local agent HTTP and WebSocket surfaces are hardened against
unapproved browser provenance and Host values. The change is locally verified,
independently security-reviewed, and ready for branch CI and human review.

## Active branch / PR

- Branch: `codex/harden-local-agent-surface`, based on `origin/main` at
  `eee9694cd`.
- PR: none; do not merge without human review.
- Run record:
  [runs/2026-07-30-local-agent-surface-hardening.md](runs/2026-07-30-local-agent-surface-hardening.md).

## In progress

- Push the reviewed branch, wait for branch CI, then hand it to a human for
  final review. No PR or merge is part of this run.

## Risks / known issues

- Hosted configured-origin behavior is preserved. A read-only production check
  confirmed the live deployment has a non-empty CORS allowlist.
- The recovery switch is global and should be used only temporarily.
- Follow-up review items: add direct environment-parser and Host edge-case
  coverage; decide separately whether non-`AGENT_LOCAL` execution roles should
  receive the same guard.
- GitNexus comparison found 22 changed symbols, 0 affected execution flows,
  and low risk.

## Test status

- Defensive contract: 19/19 passed.
- Complete serial API suite: 3,713 passed, 110 skipped, 0 failed.
- Focused post-review HTTP/WebSocket suite: 30/30 passed.
- TypeScript and issue-level workflow gates passed.
- Flutter, MCP, vendored engine, mobile static, and mobile browser gates passed.

## Next step

Push `codex/harden-local-agent-surface`, wait for branch CI, then human review.
Do not open or merge a PR automatically.
