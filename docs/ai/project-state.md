# Project State

## Current focus

Finish PR #1165's release evidence after restoring compatibility between the
mobile Google OAuth exchange request and the currently deployed Cloud route.

## Active branch / PR

- Local branch: `codex/mobile-1172-agents-activity`
- Remote PR branch: `feat/rhythm-agent-ios-roadmap`
- Draft PR: #1165, `WIP: consolidate unfinished Rhythm Agents iOS prototype`
- Last pushed review repair: `8b62b6241`; the locally verified OAuth
  compatibility repair is the next exact-head candidate for PR #1165.

## In progress

- Push the OAuth compatibility repair, then wait for exact-head CI.
- Continue the remaining #1175 physical-device and release matrix after this
  focused authentication/pairing path.

## Risks / known issues

- This is a broad security-sensitive branch covering mobile credential scope,
  signing-secret isolation, MCP trust boundaries, dependency installation,
  delegation ownership, vault containment, and Cloud/local identity binding.
- GitNexus impact/detect tooling is unavailable in this session. Bounded caller
  inspection and the full verification matrix are recorded as fallback, not
  represented as a GitNexus pass.
- Credentials, signing assets, build artifacts, pairing/device tokens, private
  hostnames, and iPhone identifiers must never be committed or printed.
- Signed development builds, physical-iPhone validation, and TestFlight remain
  human release gates. Do not merge before those gates are complete.

## Test status

- All seven executable issue contracts (#1224–#1230): PASS.
- Full `checks --level pr`: PASS across Flutter, API, MCP, OpenCode fork, and
  mobile static/contract/fake-server/web-E2E gates.
- Vendored OpenCode fork build and binary smoke: PASS.
- API build: PASS.
- Isolated API/OpenCode health probes: PASS.
- #1227 guided setup disclosure/trust-boundary live test: PASS.
- #1228 delegation ownership live test: PASS.
- #1230 immutable Cloud/local identity live test: PASS after correcting a
  throwaway test-capability hashing mismatch; no product code changed.
- `git diff --check`, stale-copy search, and credential-pattern scan: PASS.
- Mobile OAuth compatibility contracts: PASS. The signed development build
  launched on a physical iPhone and the user reported `Connected`.
- Issue- and PR-level local gates: PASS on the OAuth repair working tree.
- Broad #1175 physical coverage remains pending: the focused result does not
  prove the complete tools, isolation, streaming, approval, revocation,
  background-recovery, production archive, or TestFlight matrix.

## Next step

Push the focused repair into PR #1165 and wait for exact-head CI; then resume
the remaining signed-device, production archive/TestFlight, migration review,
final manual smoke, and explicit merge-approval gates.
