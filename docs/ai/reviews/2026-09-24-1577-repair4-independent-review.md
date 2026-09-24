# Independent review — PR #1578 repair4

Review date: 2026-09-24
Checkout: `/private/tmp/rhythm-swarm-pr1578`, branch `swarm/pr-1578-review`, HEAD `dd8717ad8fb5be7d70b1121fc7edffa18e85ea68`.

## Scoped conclusion

The repair4 source changes address both blockers recorded in the earlier full-candidate review (`/private/tmp/rhythm-codex-takeover-review/backend-ledger.md`, `pr1578 — BLOCK`). The model resolver now receives the signed server-trusted stored profile id, so its stored provider/model route can be selected. The prompt options now use the resolved stored profile `ocAgent` when no client override exists, rather than forwarding the provider kind (`claude-code`) as an OpenCode agent mode. The previous review identified that `claude-code` is not a projected engine agent and the fork rejects unknown named agents; this repair removes that exact mismatch.

The focused test makes stored profile model (`fixture-profile-model`) and engine mode (`build`) distinct from the row's provider kind, and checks the prompt model/mode, deny-all MCP and skill allowlists, and retained SDK session path. The recorded RED logs show the prior implementation failed the respective model assertion; `/private/tmp/rhythm-repair4/1577-focused.log` records 13 focused tests passing. The live log records one real MCP/API/engine scenario passing. This is a scoped pass for the repair4 regression only; no tests or servers were run during this independent review.

## Verified documentation/acceptance issue

`docs/ai/contracts/issue-1577.json` leaves c9 `pending` despite the repair4 run log recording the c9 regression green in the 13-test focused run; set it to `pass` if the run log is the intended evidence. The c7 reason still says required live scenarios were not run or expanded in repair attempt 3. Repair4 did run one live scenario, though it explicitly leaves resumable reattachment, signed malicious override through real MCP, and live skill-use measurement unverified. Keep c7 `UNVERIFIED` and in `not_tested`, but update the reason to describe the remaining repair4 gaps accurately. The run log's limits section is accurate.

The supplied stored issue body path `scratchpad/issues/issue-1577.md` describes unrelated frontend issues #1552/#1558, so it cannot serve as original acceptance source for this prompt-session work. This review relies on the retained issue-1577 contract, repair4 run record, prior PR1578 review ledger, and candidate diff. Do not present the repair4 result as full issue completion.

## Read-only integrity

No candidate files were edited; no tests, servers, commits, installs, or network calls were run. SHA-256 values below were identical before and after review:

- `apps/api_server/src/services/ws_gateway.ts`: `80af563059858a0ffa80099005e2b2cc81a9e2f058d4657ac03f010860b29fbb`
- `apps/api_server/src/__tests__/issue_1577_prompt_existing_session.test.ts`: `2cdc358ef2795cc7a8b146a832ea4dbba8aecac9d202572da84aac42cf87dbe5`
- `apps/api_server/src/__tests__/issue_1577_prompt_existing_session_live_e2e.test.ts`: `81ffc604c12688211cb0e5a8bc82264af0985106020ac37e4ee31a8b13e99a59`
- `docs/ai/contracts/issue-1577.json`: `f39c53b01616235ac0f2eed2cca5451ff3b688bef73b7d3de143d1a2543a61ad`
- `docs/ai/runs/2026-09-24-pr1578-repair4.md`: `24251413b82196b5aaed4b0eda7b546fe8ec6ad4f3abc73d1f763a7bb4ab4a36`
