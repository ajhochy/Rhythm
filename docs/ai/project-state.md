# Project State

## Current focus

Independent exact-source review of the integrated Rhythm Agents iOS release
candidate before signing and physical-device validation.

## Active branch / PR

- Local branch: `codex/mobile-1172-agents-activity`
- Remote PR branch: `feat/rhythm-agent-ios-roadmap`
- Draft PR: #1165, `WIP: consolidate unfinished Rhythm Agents iOS prototype`
- Main integrated through: `80d1552acb94eb1c4d6ba7471c5dfb55fd438e1d`
- Frozen review source: `6dd2516f96b357d99854b8fbcb0ef6ad1206ae07`
- PR policy: evidence-only descendants may follow the frozen source

## In progress

- #1197: independent whole-branch security and quality review of the frozen
  source.
- #1198: signed EAS development build after #1197 passes.
- #1199: authenticated physical-iPhone and isolated-Mac matrix.
- #1200: production EAS/TestFlight provenance and install smoke.

## Risks / known issues

- The cumulative mobile branch remains a broad, high-risk review surface even
  though current-main integration, local checks, live tests, and CI are green.
- GitNexus current-head impact/detect evidence is unavailable; direct scope
  inspection and the full verification matrix are recorded as fallback, not
  represented as a GitNexus pass.
- Credentials, signing assets, build artifacts, pairing/device tokens, private
  hostnames, and iPhone UDIDs must never be committed or printed.
- The deployed production API still uses the older mobile OAuth request
  contract; production sign-in is not green until a matching reviewed backend
  is deployed.
- Do not merge before #1197–#1200 are complete.

## Test status

- Exact-source `ai-workflow checks --level pr`: PASS.
- Isolated API/OpenCode/mobile-gateway health probes: PASS.
- Pairing compatibility: 1/1 PASS.
- Pairing and mobile tool authorization: 1/1 PASS.
- MEM-OKF real API/MCP/vault suite: 5/5 PASS.
- Paired gateway project isolation: 1/1 PASS.
- Focused maximum-Dynamic-Type contract: 2/2 PASS.
- GitHub PR workflows: Desktop, Server, MCP Server, OpenCode Fork, and Mobile
  CI all PASS on the frozen source.
- Signed development build, physical iPhone, and TestFlight: pending human
  gates.

## Next step

Perform #1197 against
`git diff main...6dd2516f96b357d99854b8fbcb0ef6ad1206ae07`, commit the immutable
review report, and do not start signing until it has no unresolved Critical or
Important findings.
