# contract.json Schema

Canonical schema for the machine-readable acceptance contract. This is the
single source of truth — `acceptance-contract` (SKILL.md), the AgentFlow
`implement-issue.aflow` contract-writer agent, `verification-gate`, and
`failure-postmortem` all consume this format. Edit here, never inline copies.

The contract is written to `docs/ai/contracts/issue-N.json` in the target
repo, alongside an executable test file in `tests/contract/` (path varies by
stack). Every acceptance criterion from the issue appears exactly once.

## Schema

```json
{
  "issue": 42,
  "generated": "2026-05-18",
  "criteria": [
    {
      "criterion_id": "issue-42-c1",
      "text": "<verbatim criterion text from issue>",
      "mode": "unit | integration | ui | manual",
      "test_file": "tests/contract/issue-42.spec.ts",
      "test_id": "issue-42-c1: <description>",
      "status": "pending",
      "reason": "<only present when mode is manual or UNVERIFIED>"
    }
  ],
  "stack": "typescript | python | dart | go | unknown",
  "not_tested": ["issue-42-c5"]
}
```

## Field semantics

- **`issue`** — the GitHub issue number this contract covers.
- **`generated`** — ISO date the contract was generated.
- **`criteria[].criterion_id`** — stable ID, `issue-<N>-c<index>` (e.g.
  `issue-42-c1`). One criterion maps to exactly one test ID; never combine
  criteria in a single test.
- **`criteria[].text`** — the criterion verbatim from the issue body. Do not
  paraphrase; postmortems diff this text against smoke findings.
- **`criteria[].mode`** — verification mode: `unit`, `integration`, `ui`, or
  `manual`. Vague or non-automatable criteria are recorded as `manual` with an
  explicit `reason`, never silently skipped.
- **`criteria[].test_file` / `test_id`** — where the executable test lives and
  the exact test name. Absent for `manual` criteria (no test stub is emitted).
- **`criteria[].status`** — `pending` at generation time. The pipeline updates
  it to `pass` / `fail` as tests run.
- **`criteria[].reason`** — required when `mode` is `manual` or the criterion
  is `UNVERIFIED` (e.g. `"Requires real email delivery infrastructure; not
  automatable in CI"`).
- **`stack`** — detected test stack; determines the test file format. If the
  stack cannot be determined, all criteria are `mode: manual` with
  `UNVERIFIED: stack-unknown`.
- **`not_tested`** — the list of criterion IDs with `mode: manual`. This list
  is the explicit input to verification-gate's PASS report — any criterion in
  `not_tested` must appear in the manual smoke check target list.

## How consumers use it

- **coding-agent / implementer**: first action is running the contract tests
  and confirming they fail; final action is running them again and confirming
  they pass. PASS = green tests, not "build succeeded".
- **verification-gate / verifier**: reads the contract and requires every
  criterion to be `status: pass` or listed in `not_tested` with an explicit
  reason. A missing or empty contract file is a verification failure.
- **failure-postmortem**: compares each criterion's `contract_status` against
  the manual `smoke_status` to classify divergences (see
  `docs/failure-taxonomy.md`).
