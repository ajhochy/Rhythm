# Rhythm — project state

## Current focus
Hermes shipping integration: all writers finished; independent gate329 **FINAL_SHIPPING_INTEGRATION PASS** on frozen source. Source-qualified, **not deployment-ready**; staged candidate is STALE after corrections.
Coordinator workflow runs (#1612) and approval queue hygiene remain preserved on the current shipping base (expired pending cards hidden; external-content approval window 1 hour).

## Active branch / PR
`feat/hermes-shipping-rollout-20261014`, source commit `31906d37d2f61cd964d66372c79a8ba59c14c60d`, [draft PR #1617](https://github.com/ajhochy/Rhythm/pull/1617). Old #1615/#1616 evidence is superseded, not a merged/deployed claim.
Installed Electron app: `/Applications/Rhythm.app` **0.18.76**, recorded revision c74, team56Q69NYP9H; live API4001/engine4096 unchanged. No merge/tag/release publication authorized.

## In progress
Qualification-only `electron_release.yml` [run38639296935](https://github.com/ajhochy/Rhythm/actions/runs/38639296935) is running for numeric version **0.18.77**, pinned to source commit `31906d37`; release job skipped. Parent must verify signing/notarization, Gatekeeper, packaged smoke and downloaded artifact before ASK for restart.
Checkpoint: [final integration](runs/2026-10-14-hermes-final-shipping-integration.md); [rollout/trust/operator guide](guides/hermes-shipping-rollout.md).

## Risks / known issues
- Mac full-app quit/install/relaunch permission **not yet asked or approved**; active agents and app-owned Hermes/Dayflow/Colony may shut down. Preserve old signed app and data/config for rollback. AJ's deploy/build/test authorization does not waive restart ASK.
- Live4001 V2 currently404 from the old bundle; live operator execution and cookie-enabled native/source owner mapping remain unqualified (STOP). Pi receiver already installed/healthy; prior one-restart permission spent, relay operator rejoin restart done; no new Pi restart needed.
- No successful source LLM, physical Keychain/card click, live Pi/browser ACK, or current signed/notarized UI artifact qualification claimed. UI source unchanged; a CI rebuild may differ in bytes.
- Coordinator runs use bypassPermissions confined to their worktree (`external_directory: deny`); a goal must name
  the repo by absolute path.
- The approval list hides expired cards only from `status=pending`; agents that asked must ask again after 1 hour.
- Fork still carries the schema-2 provider-guard protocol of the retired typed adapter.
- 3,795 historical NULL-owner sessions not backfilled; 8 pre-existing FK orphans in agent_session_messages.

## Test status
Frozen gate329: 48 selected API, 2 live (5 revocation groups), 1 pinned wire, 4 real MCP→API→fork, 33 auth +10 Cloud control, 8 operator +23 provisioning, 9 MCP and strict API/MCP emit PASS. Shared delegation84 PASS; counts overlap, no aggregate total. MCP inventory **109+3=112** (report in PR).
Historical hide-expired-approvals full suite (not rerun here): 8701 passed, 4 failed — all pre-existing or env (turn_routing D2 fails on
mega base; mcp_tool_grant_drift ×2 + skill_usage_tracker need tsx in apps/api_server/node_modules).
Historical web gateway spec: "post-login local boundary" fails on mega base too. Apple signing/notarization, Gatekeeper and signed smoke of final source remain pending.

## Next step
Parent records actual commit/PR after creation, dispatches qualification-only CI, verifies artifact hash/signatures/notarization/Gatekeeper/signed smoke, then asks AJ artifact-specific restart permission before any Mac replacement/relaunch or live Pi fixture state change. No merge/tag/publish.
