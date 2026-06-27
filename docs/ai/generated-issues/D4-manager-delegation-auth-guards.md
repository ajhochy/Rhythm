# D4 — Manager delegation authorization and recursion guards

**Labels:** `api-server`, `security`, `agents`, `p4`
**Design authority:** `docs/ai/decisions/2026-06-24-manager-delegation.md`
**Depends on:** D1, D2, D3

## Goal

Make delegation fail closed and bounded.

## Acceptance Criteria

- [ ] Manager with `allowed_delegates_json=["X"]` can delegate to `X`.
- [ ] Same manager cannot delegate to unlisted `Y`.
- [ ] Non-manager cannot delegate.
- [ ] Manager cannot delegate to itself.
- [ ] Recursive/depth-exceeded delegation is rejected.
- [ ] Unknown or malformed allowlist values reject safely.

## Likely Files

- `apps/api_server/src/services/agent_delegation_service.ts`
- `apps/api_server/src/__tests__/agent_delegation_auth.test.ts`

## Required Tests

- Add `agent_delegation_auth.test.ts` covering all acceptance criteria.
