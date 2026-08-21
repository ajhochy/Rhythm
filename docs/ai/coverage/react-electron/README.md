# React/Electron Desktop Parity Coverage Matrix

This is an inventory of declared checks, not a claim that every invariant has browser automation. It covers API, MCP, Flutter, mobile, the OpenCode fork, imported web, root, tools, and durable docs. Generated/vendor output, mutable `docs/ai/runs/**`, and `docs/ai/project-state.md` are excluded; execution evidence/project state report runs rather than declare checks. OpenCode fork source is deliberately included.

## Files and schema

- `source-inventory.jsonl`: one JSON object per discovered declaration: `sourceId`, `surface`, `path`, `anchor`, `line`, `title`, `kind`, `parserLimitations`.
- `behaviors.json`: taxonomy plus behavior records containing `actor`, `precondition`, `action`, `outcome`, `failure`, `security`, `layers`, `journeys`, `status`, `owner`, and `rationale`.
- `mappings.csv`: exactly one disposition per source row. Valid dispositions are `retained_unit`, `retained_integration`, `retained_ui`, `manual_check`, `review_required`, and `deferred`.

`sourceId` is stable as `<surface>:<repository-relative-path>:<anchor>`. The scanner is line-oriented and records that limitation rather than inventing precision. Generated defaults retain declared unit/integration checks conservatively; uncertain evidence must be `review_required`. Only Terminal/PTTY may be `deferred`; every other gap remains planned or review-required.

## Update protocol for multiple agents

1. Re-read this README and the three matrix files immediately before editing.
2. Own one source row or behavior at a time; preserve rows owned by other agents.
3. Upsert by stable `sourceId`/`behaviorId`; do not renumber, duplicate, or rewrite unrelated rows.
4. Fill every required field, choose one disposition, and include a concrete rationale.
5. The matrix directory itself is excluded from its scan output; update this README before final regeneration.
6. Run `node tools/validation/validate-desktop-parity-matrix.mjs` from the repository root.
7. For scanner changes, run it twice and compare the generated files; preserve stable ordering.
7. On conflict, keep both observations only if their IDs differ; otherwise retain the newer verified evidence, mark uncertainty `review_required`, and name the owner in the rationale. Do not resolve conflicts by deleting another agent's row.

Regenerate with `node tools/validation/generate-desktop-parity-matrix.mjs`, then validate with the command above. The generator reports unique source, mapping, behavior, and review-required counts; record them in the run note only after regeneration. Do not sum surface categories because they intentionally overlap conceptually.
