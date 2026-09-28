# Independent resumed review — #1574 bounded index cleanup

Date: 2026-09-24. Read-only candidate `/private/tmp/rhythm-swarm-1574`, branch `swarm/issue-1574`, HEAD `a2581505`. Compared current source against `/private/tmp/rhythm-repair4/1574-final-review.md`, the preserved deferred patch, and the worker's repair receipt. No product edit, test run, server, signal, or cleanup operation in this review.

## Finding and disposition

No new unsafe-signal finding in the resumed `_runIndex` change. The earlier single `gone` check could leave `serve.owner` after an exited child, as the integrated 58/59 replay showed. The new `finally` loop re-reads the marker every 50 ms for at most `STOP_GRACE_MS + 500` (3.5 seconds) and clears `indexRelay`/`indexChild` only after `gone` proves **both exact recorded OS identities** are gone. Each loop requires the same nonce, `starting` state, home, root, binary and config hash as the reservation. Changed, incomplete or uncertain identity exits the loop without clearing ownership; `releaseReservation` then retains such a marker for inspection. This is a bounded fail-closed repair of the observed timing race.

The loop itself sends no signal. The existing TERM/KILL paths remain in the detached relay and owned-child shutdown/reap code, with marker/OS checks before escalation. The extra wait cannot authorize a signal to a candidate found only by executable or port. The final nonce re-read before `publish` is weaker than the loop's full identity comparison, but the only observed same-nonce writers in this lifecycle are the index relay before it exits and the awaiting parent; the new poll does not introduce a second writer or a new signal path. A concurrent external same-nonce marker rewrite was not exercised and remains a theoretical race, not a verified finding.

The worker reports the latest candidate targeted c2 passed, manager/ownership 52/52 and isolated routes 7/7, plus build pass; I did **not** independently run these. The root's exact integrated replay is still required before treating the prior 58/59 failure as resolved. Real Engraph, actual API/engine, installed desktop and existing-machine cleanup remain unverified.

## Evidence and scope

- Current `engraph_manager.ts` SHA-256: `19eb7240dd6b1792ddb646fc1ffebb26096b4e757c62846a1489ba372dbee939`. The prior final review recorded `8a7792390ef3d2a7a5ae415846e9d158cb400475d4994dea03164fffa62c8e72`. The resumed functional delta is the one-shot cleanup replacement at `_runIndex` `finally` (current lines 1150–1178).
- `issue_1574_engraph_ownership.test.ts` SHA-256 remains `d9b4f4574b2fd1103cec38df86dad296be965e14a3fcffe8ea00fafb011e43a3`; `fake_engraph_resistant.js` remains `c7ca98fd5754a310b653af5801d953e32ceacf21516c07b7b6d47c5a1538a540`. The c2 test waits for the fake child's TERM-ready and TERM-received markers, then asserts live reservation, eventual exit and marker removal. This fixture is stronger than the earlier fixed sleep, but its isolated pass does not supersede the integrated replay.
- Broader candidate diff against HEAD also contains the earlier old-port discovery and fail-closed startup change. That change reports matching unmarked processes on previous ports without signaling them. It is outside this resumed delta, previously reviewed in `/private/tmp/rhythm-repair4/1574-independent-review.md`.
- `git diff --check` passed. No candidate file changed during this review.
