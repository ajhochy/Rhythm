# Hermes shipping rollout — current source checkpoint (2026-10-14)

**Source-qualified, not deployment-ready.** [Final independent gate329](../runs/2026-10-14-hermes-final-shipping-integration.md)
passed after all writers finished. Earlier notifyV2/approval/source logs remain
historical evidence; this guide carries current shipping prerequisites without
changing those records or broadening trust. Shipping source is committed as
`31906d37` in [draft PR #1617](https://github.com/ajhochy/Rhythm/pull/1617).

## Release and restart boundary

1. Parent commits/pushes qualified shipping source/docs and opens a draft PR;
   report **MCP109 existing +3 relay tools =112**. No private runtime/fixture artifacts.
2. Dispatch existing `.github/workflows/electron_release.yml` on that exact branch,
   numeric `version=0.18.77`, `qualification_only=true`. This arm64 path rebuilds,
   signs/notarizes, verifies codesign/Gatekeeper, runs signed security/Colony smoke
   and uploads artifacts; no merge/tag/release publication. **Not dispatched yet.**
3. Record actual commit, CI/run/artifact identity and hash plus successful receipts.
   Old local signed-only staging is STALE/unnotarized evidence, not an installable
   final qualification. UI source is unchanged; rebuilt bytes may differ.
4. **Ask AJ fresh artifact-specific Mac restart permission before acting.** Include
   artifact hash, one full Rhythm quit, complete-app install/relaunch, unchanged
   API4001/engine4096, interruption of current/sibling agents and app-owned
   Hermes/Dayflow/Colony shutdown effects. Preserve old signed0.18.76 app and all
   data/config; name rollback to that old app, with any extra restart separately
   approved. ASK not yet asked/approved; deploy/build/test authorization is not it.

Installed Electron0.18.76 has recorded c74 revision/team56Q69NYP9H. Its live4001 V2
404 is expected old-bundle behavior, not evidence of source failure. Do not start
another api_server by hand or touch live4096 to test the candidate.

Live Pi receiver is already installed/healthy; prior same-image/config postflight,
one-restart receipts and journal/log absence checks remain prior evidence. That
restart allowance is spent; relay operator rejoin restart is already done. **No new
Pi restart needed or authorized.** Publish prerequisites below before any actual Pi
fixture state change, after AJ's scoped restart/activation approval.

## Operator-owned single-fixture prerequisites (live execution NOT RUN)

Reference: [operator CLI contract/commands](../runs/2026-10-14-hermes-operator-cli-mode.md).
Explicit mode requires both `--allow-private-relay --api http://127.0.0.1:4001`;
default stays exact canonical4898. No generic/private HTTP fallback or endpoint alias.

- Protected immutable version2 manifest: `fixtureOnly:true`,
  `executionMode:"operator-fixture"`, exact approved owner/root/state/native endpoint,
  existing manager/roster target/profile, hashes and file references. No secret
  values in docs/argv. Files owned/non-symlink600; roots owned/non-writable to others.
- Existing owner bearer and runtime bridge capability files required; optional
  existing native cookie/CSRF references must match manifest. Capability only covers
  existing registered profile catalog/projection/delegation role; it does not mint
  grants, replace owner auth or take over the default profile. Missing reference:
  **STOP**, never generate a live registrar credential or weaken ownership checks.
- Native/source owner namespaces are distinct. Cookie-enabled mapping remains
  **UNQUALIFIED/STOP**, even with cookie/CSRF files; unknown auth policy also STOPs.
  Password-unset loopback fixture proof is not password-enabled login qualification.
- Nondefault active profile or unsupported selected profile STOPs. If public native
  modules require staging, copy only exact pinned two-module bytes to a NEW owned
  protected stage; do not chmod/chown/rewrite installed source or config.

Dryrun validates references without reading credential values or doing HTTP/writes.
Creation uses supported POST session/new then rename for **only the newly returned
SID**, durable same-SID receipt, zero messages/provider requests before delivery.
Execute uses supported Receiver.link and feature auth-store entry; no arbitrary SID
adoption, handwritten chat/index/DB rows, extra chat or authority. Partial/conflicting
birth stops rather than overwriting/adopting. `--stop-owned-fixture` disables only
the exact owned link idempotently and preserves records/proofs/foreign state; no
destructive delete. Operator live creation/execute is still NOT RUN.

## Wire, delivery and approval trust

- [Pinned V2 wire](../runs/2026-10-14-hermes-v2-wire-compatibility.md) and
  [current native ACK](../runs/2026-10-14-hermes-currentwire-nativeack.md): exact
  public keys/GET=SSE identity, all five kinds; internal verification labels and
  engineRequestID are not public. Source coding success remains unverified/pending
  without an authoritative producer; no idle→completion promotion. Structural
  UNKNOWN/revoked lineage denies history/SSE/ACK404, preserving journal/private data.
- Final native evidence is one selected first-progress event through actual copied
  native worker/save and unobscured Chromium nonce receipt to real source ACK;
  source page contains three events, not all delivered. Synthetic source model
  error and deterministic native TEST provider are explicit boundaries. No live
  Pi/browser, successful source LLM, or guaranteed offline question recovery claim.
- [Approval engine](../runs/2026-10-14-hermes-shipping-approval-engine-e2e.md) proves
  external SDK→MCP→API→real fork, once-only task effect and downstream denials.
  Relay decision audit is authenticated owner choice in chat, **relay-attested**,
  not crypto-human or native desktop click. External approval alone cannot execute
  the action without real fork-signed context. No Keychain/native card broadening.
- [Auth fixture](../runs/2026-10-14-hermes-cloud-auth-fixture-check.md) preserves
  known-bad401 and auth-unavailable503 with no egress; no production auth relaxation.

Historical run statuses/errors and old #1615/#1616 are not evidence that this new
shipping candidate is merged, deployed, notarized or restart-approved.
