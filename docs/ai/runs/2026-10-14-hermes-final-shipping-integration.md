---
date: 2026-10-14
repo: Rhythm
branch: feat/hermes-shipping-rollout-20261014
pr: 1617
issues: [NOTIFY-HERMES, HERMES-APPROVALS]
status: SOURCE_QUALIFIED_APPLE_CI_PENDING
tags: [run, rhythm]
index: "[[Rhythm]]"
---

## Files changed

Docs-only checkpoint: targeted `docs/ai/project-state.md`, this new run, and new
`docs/ai/guides/hermes-shipping-rollout.md`. No source/tests/env/graph/Git history,
server, installed app or private runtime artifact writes. Parent owns commit/push/PR.

## Checks run

Recorded from parent handoff: all writers finished; independent gate329
**FINAL_SHIPPING_INTEGRATION PASS** at HEAD
`c74f4392a6df61979fbe33e620a0077ebb6e0b4b` plus dirty qualified feature.
Frozen 12,064 file identities, zero changes; manifest SHA256
`c3c851083637542eb1fe789904b67a8da7f5f84b3490343ba8d82d70827dbdf1`.
Whole owned source/prototypes unchanged before/after; canonical generated outputs
may regenerate normally. This documentation task did not rerun behavioral tests.

| Executed scope | Result / qualification |
| --- | --- |
| Selected API | 48 PASS = 43 coordinator/source +5 wire |
| Real live API/engine | 2 PASS; five canonical UNKNOWN revocation groups deny list/SSE/ACK404 with unchanged DB/journal |
| Pinned wire | 1 PASS; all five kinds, exact V1/V2 GET=SSE identity; no public internal engineRequestID |
| Real external SDK→MCP→API→fork | 4 PASS; eight actual calls, one task/consumption, seven downstream HTTP denials; inventory109+3=112 |
| Auth / unchanged Cloud controls | 33 +10 PASS; available rejecting private Cloud fixture401, unavailable auth503, no egress or weakened five unit files |
| Operator / provisioning | 8 +23 PASS; provisioning = helper16, bridge1, transport3, nativeHTTP1, birth2 |
| Strict builds / MCP units | API/MCP strict emit PASS; MCP9 PASS |
| Shared delegation / approval resume | 84 PASS = approval-resume13 +71 other shared checks |

Do not sum overlapping suites: the previously reported120 is source3 +auth33
+shared84; source3 and approvals5 are already within48 (approvals5 also in33).
Pending/unverified remains no-completion; private content filtered; SDK revocation
denies404 with unchanged journal. Six unsafe endpoints deny before any socket;
actual native profile/partial-creation controls create zero extra chats.

Canonical lifecycle order:4998 then5198 then4898, sequential, same four required
fixture variables per lifecycle, owned uid501 DB/config0400, all teardowns PASS and
all owned ports free. Node22.23 SHA256
`f4138f62bc2f24b896232afc646fd0a1e75bd3ab1e626c4f3f8ef73b41c6a732`;
unchanged fork SHA256
`d60f5a42930ddb824184242da36dd4a4fffd6d8f4460ff5faf03e0dc09afa072`.
No source fork edits/new fork-build claim.

Exact executable commands and scoped environments are retained in the
[wire/native ACK](2026-10-14-hermes-currentwire-nativeack.md),
[MCP engine](2026-10-14-hermes-shipping-approval-engine-e2e.md),
[auth fixture](2026-10-14-hermes-cloud-auth-fixture-check.md), and
[operator](2026-10-14-hermes-operator-cli-mode.md) records. Final independent
receipts supersede earlier per-run receipt identities, not their historical failures:

- MCP receipt basename `receipt-1893f694-f62a-42b1-9409-ae6c25c55cef.json`, SHA256
  `10a39c9b99280ff46c60d921e61621596b8d5a0693f89e67012ed4415a830f85`.
- Native `current-ack-proof.json` in retained disposable fixture `hermes-cli-owned-vm0qs_eb`, SHA256
  `ee9dda51820ce17d559560ccec8a32413def95d5a5503f7c14b3f3f25a30d508`;
  `current-shipping-native-ack.png` inspected: normal chat, no overlay.

## Notes / boundaries / next step

Native proof uses official registrar/projection/delegation with generated protected
machine credential files, synthetic owner1, real preengine origin→Rhythm SSE→pinned
NativeAdapter→actual copied native HTTP/worker/save→real unobscured Chromium nonce
receipt→real visible source ACK. Retry wrong-run404; reopen tombstone2; foreign
states preserved; native deterministic TEST provider1, no prior callbacks.
Only first progress event `968559f3-b691-454d-a21d-ba4a13e4f975` delivered from a
three-event progress/progress/error source page: **not all three drained**.
Source model `syntheticNoProvider` intentionally produces a real error, not LLM
success. No live Pi/browser proof. Native107 core +7 outputs overlap: union110,
not114. Frozen notifier SHA256
`3f8be42e4ff81aa4f18274d01e5c7b28661fcc322bae21ffb7d225f111671ef7`;
router `129a4f31283b06e18ea2b5ff8197fa0f050fcf6eac069e6f84cc3e79ec3dfaf9`.

MCP owner audit is **Synthetic Admin via Hermes**, relay-attested
`owner_chose_in_chat`, not cryptographic human/desktop card-click proof. Existing
desktop guards and real fork-signed engine action context remain required.
Unsupported verified-success producer stays manual-verification-pending; no false
coding completion. Persisted question outbox does not guarantee missed/overflow
offline question recovery or delivery.

Recovery history remains in original records: initial missing source relationships,
structural UNKNOWN test-contract mismatch, private Cloud401/503 setup failure,
public/internal wire expectation and test-bootstrap imports, and deferred MCP
advertisement setup. Bounded source/test/fixture corrections passed subsequent
checks; historical RED/error/status text is not rewritten as first-try success.

Current shipping base preserves coordinator features. Old05d/e659 source bases
were unsuitable (487 API-file differences); the earlier minimal staged/sign-only
app is historical and **STALE** after source corrections. Do not claim current
ten-file compiled diff or byte-identical signed UI verification. UI source unchanged
does not guarantee new CI artifact byte identity. Old PR heads8dd/05d and #1615/#1616
are superseded evidence, not merged/deployed; new shipping draft number pending.

Parent next: commit only intended source/docs (exclude private copied binaries,
runtime artifacts and receipts), push/open draft, update actual metadata, then
existing `electron_release.yml` on this branch, `version=0.18.77`,
`qualification_only=true`. Apple CI **not yet dispatched**; signing/notarization,
Gatekeeper, signed smoke and artifact upload remain pending. No merge/tag/publish.
Installed signed Electron0.18.76/c74/team56Q69NYP9H remains unchanged rollback app.
AJ authorized deploy/build/test, **not Mac restart**: ASK still not asked/approved.
See [rollout guide](../guides/hermes-shipping-rollout.md) before activation.

## Parent commit and qualification-build checkpoint

The preceding dirty-source/CI-not-dispatched statements describe the verification
handoff time. Parent subsequently committed/pushed the exact tested source as
`31906d37d2f61cd964d66372c79a8ba59c14c60d` (plus a private-runtime gitignore,
no product changes), opened draft PR1617, and dispatched qualification-only
Electron run38639296935 for version0.18.77. `gh run view` confirms its headSha is
that exact source commit. Arm64 qualification job is running; the publication job
is skipped. No merge, tag, release, app replacement or restart occurred.

This documentation checkpoint changes no qualified product bytes. Future branch
HEAD documentation commits must not be confused with the source SHA being built.
Signing/notarization, Gatekeeper, packaged smoke and downloaded-artifact identity
remain pending. Mac restart must still be explicitly requested after those gates.
