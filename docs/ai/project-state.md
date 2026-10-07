# Project state

## Current focus

Resume the approved combined candidate: preserve C15 Coordinator repairs and the mobile response-stall patch `c5f557934b02437809d26297fb1ee7a76ef62aaa`. C15 repairs cover clipboard lifecycle metadata, server local-day context, nested permission ceilings, bounded hierarchy visibility, interactive coding routing and permitted native tools when the dispatcher is denied. Targeted behavior passes; the complete PR gate is unresolved. C15 is not signed or installed.

## Active branch / PR

Local `codex/coordinator-response-repair`, C15 `2a3f661c7ac2e93cbe0bcbb0a0ef4a54d5c80c82`, apps tree `072d398c7db754c8a429c7b310a61db2d4753ed2`, after documentation head `d83ffaa4bf8ec87fefd3104ec685e2b6a1209b7b`. Draft PR #1604 uses `integration/2026-10-06-resume` against `main`; follow-up push/exact-head CI and human merge remain pending. Issue #1605.

## In progress

Diagnose PR stage 12: `shell completion resumes queued loop callers` expected one LLM call, observed zero. The exact captured stage-12 command reran once with exit 0: 523 passed / 5 skipped / 1 todo / 0 failed. Original failure is preserved; no queue-arrival trace establishes its cause, so triage remains BLOCKED. Instrumented correct-queue and controlled late-arrival cases both passed; no product queue fix is supported. The existing test now checks returned assistant errors and exact fixture text before the original count. Combined source freezes next for new full/live/signed/installed gates; resync has not run.

## Risks / known issues

Scripted providers qualify actual software plumbing, not installed model judgment or unsolicited ancestor completion. Partial Opus5.5 replay supports routing/hierarchy tool choice but overstated a bounded list as complete. UI Always allow persistence is CODE_TRACE_ONLY and unqualified; no global permission fix is claimed. No automatic grants, copied ancestor approval markers or taint bypass. Notarization, phone and full native matrix proof remain separate.

## Test status

Canonical SQLite 13.0.3 rerun: C5 grant/deny 2/2, all 19 checks each; formal idle/restart 2/2, all 19/20 qualification plus 5 operational checks, eight foreground date snapshots plus one signed status per case. Stock teardown/source/build/dependency/binary/normal guards pass. Fresh full issue 4/4; PR 21/22, only fork stage 12 fails; API 8,258 tests pass. Original failed input run is retained. Root restored exactly 22 preserved PNGs; C15 source was clean before this documentation checkpoint.

Prior signed C9 `54888e924c5b31cb7700b6eb1f5da7c4c450e930` retains its original full/native/CI qualification; it does not qualify C15. Normal app was externally restarted at 18:13 PDT (main 4209/API 4220/engine 4289), with an unrelated `0.0.0-investigate/mobile-transcript-regression-202610070111` engine. Root and agents did not initiate that turnover; current normal runtime is not C15 proof.

## Next step

Capture queue-arrival causality without weakening the test, then obtain complete required gates. AJ approved combining the separate mobile latency fixes with this repair and delivering/installing the combined result at Oct 6 18:40 PDT (01:40 UTC Oct 7), verified from relayed human transcript evidence. Other paused work remains paused. Replacing it with C15 alone would remove its snapshot-gc and per-token logging mitigations. Qualify the combined frozen source, signed/installed behavior and targeted Secretary resync, push the draft PR, verify exact-head CI, and archive only owned work after root review. See `runs/2026-10-06-coordinator-response-repair.md`.
