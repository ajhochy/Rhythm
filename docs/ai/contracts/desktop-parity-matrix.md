# Desktop Parity Matrix — Slice 6 Acceptance Contract

**Date:** 2026-08-14  
**Command:** `node --test tools/validation/test/desktop-parity-matrix.test.mjs`

| ID | Criterion | Evidence |
|---|---|---|
| slice-6-c1 | Publish README, source inventory, behavior taxonomy, mappings, and schema/contract. | Matrix artifacts validate. |
| slice-6-c2 | Scan declared tests and manual checks across named product and durable documentation surfaces reproducibly, excluding generated/vendor paths, mutable `docs/ai/runs/**`, and `docs/ai/project-state.md`. Run evidence and project state report executions; they do not declare checks. | Deterministic generator and inventory limitations. |
| slice-6-c3 | Every source row has one conservative mapping/disposition. | Validator mapping checks. |
| slice-6-c4 | Every seeded behavior contains the required coverage fields; Terminal/PTTY alone is deferred. | Validator behavior and Terminal checks. |
| slice-6-c5 | Validator rejects invalid IDs, enums, rationale, taxonomy, malformed completion, and Terminal misuse. | Node stdlib self-tests. |
| slice-6-c6 | Generator is deterministic and reports unique counts without summing overlap. | Double generation self-test and run note. |
| slice-6-c7 | README defines a safe multi-agent update protocol. | README review. |
| slice-6-c8 | Durable matrix artifacts are commit-visible while ordinary generated coverage remains ignored. | `git check-ignore -v` allow/deny checks. |
| slice-6-c9 | A fresh hermetic scan byte-matches each published matrix artifact. | Node stdlib freshness test. |

Pre-implementation acceptance run is expected to fail because the matrix artifacts and validator do not yet exist.

WAIVED: Git ignore metadata repair has no product behavior change; verification is exact ignore-rule checks, deterministic matrix checks, and diff scope review.
