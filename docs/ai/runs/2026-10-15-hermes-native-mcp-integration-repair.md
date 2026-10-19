---
date: 2026-10-15
repo: Rhythm
branch: unchanged-not-queried
pr: null
issues: []
status: READY_FOR_VERIFICATION_WITH_CARD_CONFLICT
tags: [run, Rhythm, hermes, operator]
---

## Scope / approvals

Explicit manager handoff: implementation-only deployed integration repair. Existing native Hermes Rhythm MCP must expose exact qualified shipping 114 tools, use existing credential file unchanged, retain cloud domain API and route agent operations through existing in-container localhost:4001 relay. Authorized side-by-side qualified artifact deployment, protected backup, atomic wrapper switch, and supported reconnect limited to Rhythm MCP while native idle. One repair attempt. Independent verifier: manager, read-only checks runnable without artifact write access; manager alone handles next native turn and AJ choice.

Excluded: new cards, decisions, card lists, chat messages, prompt/transcript writes, fabricated events, SQL, repository code/build changes, Git operations, dependency network installs, credential/auth/provider/permission/network changes, sudo, restart of WebUI/app/API/container/relay/host/subscriber. These approvals/exclusions remain durable; do not re-request unchanged scope. No host permission denial occurred.

## Phase 0 — actual failing acceptance contract

Loaded acceptance-contract then coding-agent before implementation. Read supplied closest receipts plus existing project-state/current-plan. Protected temp base `T=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode`.

Contract: `$T/hermes-mcp-repair-acceptance.cjs`, official installed SDK, actual configured `/opt/hermes/.venv/bin/python /opt/data/mcp/rhythm/run.py` stdio child. Check names: configured_inventory (114, including get/decide), domain/agent routing, agent_owner (normalized 1), existing_card_get (exact ID/revision/hash, complete preview/consequence). No mock, no decide call. Mandate: make these checks pass without weakening assertions.

Command (before and after; after captured in protected text file):

```sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 pi-nas@100.109.210.55 \
 'docker exec -i --user 1993:1993 hermes-webui-trial node -' \
 < "$T/hermes-mcp-repair-acceptance.cjs"
```

Before: FAIL `shipping inventory must contain 114 qualified tools; 100 !== 114`; get/decide absent. During preimplementation endpoint verification `/auth/me` returned 401 because it is not this agent bearer identity surface; corrected contract to existing `/hermes-notify/identity` and reran the same inventory failure **before deployment**. Contract not edited after deployment. Existing runtime token and previously approved subscriber token projection both independently fetched the exact card HTTP200 before deployment; neither credential was changed.

## Phase 1 — bounded impact review

GitNexus impact not applicable: no indexed code symbols changed. Inspected existing wrapper/config, exact qualified artifact package/dependency declarations and relay approval handlers, actual native MCP lifecycle, actual `/webui` entrypoint/runtime command implementation, native inventory and idle health. Initial `/opt/hermes/hermes_cli` dashboard route exploration was not the running WebUI: PID1 actually runs `/webui/server.py`; switched to actual implementation before refresh.

Deployed Node: native Linux ARM64 v26.7.0. Existing dependencies: SDK1.32.1, zod3.25.76, undici8.11.2. Qualified package0.6.2 requires Node>=22.19.0 and SDK^1.12.0/zod^3.22.0/undici^8.7.0: all compatible. No dependency copied or installed, no Mac binary copied. Package version alone was insufficient: old and qualified package metadata both report0.6.2, but dist inventory differed100 vs114.

Risk review: stale child/schema caches require actual native reconnect, not a separate probe alone. Actual WebUI supported `/api/commands/exec` command `reload-mcp` is profile-scoped rather than name-scoped. Proved **both full config MCP names and actual native server list consist solely of rhythm**, plus active_runs=0, active_streams=0 and exact SID inactive, before invoking; therefore this reconnect affected Rhythm only. No broad/global server restart or manual signaling. Card freshness remains enforced, not bypassed.

## Files / deployment

Command: `python3 -B "$T/hermes-mcp-repair-install.py"` — exit0, one deployment.

Only manually changed existing runtime file:

- Container `/opt/data/mcp/rhythm/run.py`: SHA256 `a05faf1bb3815f70f14860f728b13800bfe30c015b0ed7b1de0cce8718f086d1`. Same existing credential read `/opt/data/rhythm-token`; cloud URL remains `https://api.vcrcapps.com`; added `RHYTHM_AGENT_URL=http://127.0.0.1:4001`; entry now side-by-side qualified dist. Atomic sibling-file `os.replace` switch, original mode retained.

Added protected paths (UID1993; directories0700, regular artifact files0600):

- `/opt/data/mcp/rhythm/qualified-0.18.79-10d8bd13/`: exact 37 qualified dist files plus package.json copied byte-for-byte from supplied signed0.18.79 artifact; `qualified-manifest.json` contains each original hash.
- Its `node_modules` symlink targets `../node_modules`, reusing all installed dependencies.
- `/opt/data/mcp/rhythm/backup-before-qualified-0.18.79-10d8bd13/run.py`: original wrapper, SHA256 `010e8de34c986028f92ddaca573d6cb52adc61be23c96594122a25e19cc0fb46`.
- Same backup directory `preservation.json`: protected baseline file identity/hash metadata.
- Old installed `node_modules/@ajhochy/rhythm-mcp-server` code left intact for rollback.

Transfer archive SHA256 `7c3004cf8024c9715519d0a04bbd3d0f0800a06b80f58f1fa0b7e91fcd08f868`. Exact per-file paths/hashes/modes in protected final receipt. Source `$T/hermes-mcp-qualified-manifest.json` matches deployed manifest. Supported reconnect also normally updates existing `/opt/data/cache/mcp_schema_cache.json` and appends `/opt/data/logs/mcp-stderr.log`; no raw log capture.

## Checks / actual results

- Post-deploy contract: **FAIL overall**, inventory114 PASS, normalized agent owner1 HTTP200 PASS, exact-card get returns MCP isError with upstream HTTP409 `Approval has expired or has already been consumed`. Direct same-endpoint read independently confirms409. No conclusion whether expiry vs consumption beyond actual error; no SQL/state inspection, no decision or replacement card. Earlier200 does not qualify the current get as PASS.
- Supported refresh command: `python3 -B "$T/hermes-mcp-repair-refresh.py"` — exit0. Actual WebUI POST `/api/commands/exec` body `{"command":"reload-mcp"}` (not a chat message or native turn). Response `Reconnected: rhythm; 116 tool(s) available across 1 server(s)`.
- Native inventory before102, after116: 114 shipping tools plus two native utility entries. Actual qualified names now present: `mcp__rhythm__rhythm_get_pending_approval`, `mcp__rhythm__rhythm_decide_approval`. Actual child PID445 replaced by70290, UID1993, start epoch17896577, `/usr/local/bin/node /opt/data/mcp/rhythm/qualified-0.18.79-10d8bd13/dist/index.js`.
- `python3 -B "$T/hermes-mcp-repair-final.py"` — exit0: all38 qualified source hashes match, config/credential/native notify DB/registry baseline hashes/inodes/permissions unchanged. Native notify DB inode16000429 retained. Agent identity `{version:1,ownerUserId:1}`.
- Native `/health` statusok before/after, identical `server_started_at=1791996140.3024168`, sessions8, active_runs0, active_streams0, same last_run_finished_at. No new native turns from repair.
- `systemctl --user show hermes-owner-subscriber-7b4dc99c.service -p ActiveState -p SubState -p MainPID -p NRestarts`: active/running, MainPID1411069, NRestarts1 unchanged. Subscriber innerPID64737 UID1993 epoch16330294 unchanged; exactly one owned ESTABLISHED socket remote4001.
- Local `ps -p 87306,87559 -o pid=,comm=`: supplied app/API PIDs retained. No app/API/server launched or restarted.

## Protected evidence / handoff

Temp0600: `hermes-mcp-repair-acceptance.cjs`, `hermes-mcp-repair-acceptance-after.txt`, `hermes-mcp-repair-install.py`, `hermes-mcp-repair-install-result.json`, `hermes-mcp-qualified-manifest.json`, `hermes-mcp-repair-refresh.py`, `hermes-mcp-repair-refresh-result.jsonl`, `hermes-mcp-repair-final.py`, `hermes-mcp-repair-final-receipt.json`. No raw private transcripts, credentials, or published secrets.

Next-turn expectation: native **registry/connection** now advertises approval tools, independently observable via passive `/api/mcp/tools`. Existing WebUI has per-session cached AIAgent instances (`api/streaming.py`); supported reload rediscovered MCP but does not explicitly evict session-agent cache. Consequently next existing native turn is **not yet proven** to receive the new schemas; manager must verify through its authorized next actual turn. No cache manipulation or extra native turn performed. If existing cached agent still omits tools, report the exact cache invalidation need rather than restart app or write transcripts. Tool-search/deferred exposure is not independently qualified here.

Current exact-card retrieval cannot satisfy acceptance because real API returns409. Do not create a replacement, extend TTL, regenerate nonce, weaken freshness, or decide. Manager owns follow-up and AJ exact choice; implementation is READY_FOR_VERIFICATION **with these explicit limitations, not end-to-end PASS**.

Rollback (not executed): preserve side-by-side artifacts; atomically restore saved wrapper from protected backup, then use the same supported runtime reconnect only after again proving sole MCP=Rhythm and native idle. Do not delete artifacts, rotate credentials, or restart services.
