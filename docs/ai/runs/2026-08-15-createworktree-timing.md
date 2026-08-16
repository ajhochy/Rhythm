---
date: 2026-08-15
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: []
status: pass
tags: [run, Rhythm, performance, measurement]
---

# Isolated-worktree session creation timing

## Outcome

The earlier attribution to "API work around engine worktree creation" is contradicted at the
measured 1.5–2.2 second scale. Raw engine worktree creation took **45.492–70.330 ms** and a normal
API session create in the already-known repo took **11.532–13.618 ms**. An isolated API create took
**1,528.129–2,182.925 ms**. Existing API timing logs place **1,459–2,093 ms** of that isolated request
inside `opencodeClient.createSession` after the worktree row/path already existed, versus **8–10 ms**
for the same call on the established repo cwd.

Thus, under the measured conditions, the dominant cost is the engine session create for a newly
created worktree directory. It is not the engine's raw `POST /experimental/worktree`, generic API
session creation, the controller's built-in tool-surface estimate, or stream subscription.

Step 2 instrumentation was not performed because Step 1 plus the controller's already-present
`[Opencode][timing]` lines made the stage attribution unambiguous. No source/runtime code changed.

## Raw samples

All values are wall-clock milliseconds from curl `time_total`, except the explicitly labeled API
log stages. Every valid create returned 200 or 201. The rejected 400 setup request is preserved in
[createworktree-timing-curl.txt](evidence/createworktree-timing-curl.txt) and excluded.

| Sample | Condition | Engine worktree (a), ms | Isolated API (b), ms | Non-isolated API (c), ms | Pairwise b-c, ms | Pairwise (b-c)-a, ms |
|---|---|---:|---:|---:|---:|---:|
| 1 | first observed; cold new worktree cwd | 63.340 | 2,182.925 | 13.497 | 2,169.428 | 2,106.088 |
| 2 | warm process; new worktree cwd | 70.330 | 1,528.129 | 11.532 | 1,516.597 | 1,446.267 |
| 3 | warm process; new worktree cwd | 45.492 | 1,556.077 | 13.618 | 1,542.459 | 1,496.967 |

Existing structured-ish timing lines already in the controller narrowed the API requests further:

| Sample | `createSession` isolated, ms | `createSession` non-isolated, ms | stream isolated, ms | stream non-isolated, ms | isolated pre-`_createT0` remainder, ms |
|---|---:|---:|---:|---:|---:|
| 1 | 2,093 | 9 | 1 | 1 | 77.925 |
| 2 | 1,477 | 8 | 0 | 0 | 48.129 |
| 3 | 1,459 | 10 | 1 | 0 | 94.077 |

The pre-`_createT0` remainder contains the controller's profile/config resolution, optional MCP role
file handling, branch probe, raw worktree create, project lookup, `repo.insert`, `setWorktree`, and
tool-surface estimate. Even combined, those stages were only 48.129–94.077 ms in these isolated
requests. `createSession` alone accounts for 94.6–97.4% of the pairwise isolate-only differential.

The exact MCP status call that `createSession` makes through `_connectedMcpServerNames()` was also
timed directly:

| Sample | `GET /mcp`, ms |
|---|---:|
| mcp1 | 2.351 |
| mcp2 | 2.251 |
| mcp3 | 13.119 |

This bounds API-side MCP server enumeration far below the isolated `createSession` stage. The
configured `local-lean` profile also had an empty MCP server/tool allowlist throughout the run.

## Ranked attribution

1. **Engine session creation for the new worktree cwd: 1,459–2,093 ms.** This is the dominant
   measured stage and 94.6–97.4% of the isolate-only differential. The API wrapper is awaiting the
   engine's session-create response during this interval.
2. **Raw worktree creation plus all other pre-session API work: 48.129–94.077 ms combined.** Direct
   raw engine worktree creation independently measured 45.492–70.330 ms, consistent with most of
   this small remainder.
3. **Generic session creation on the established cwd: 11.532–13.618 ms end to end.** Its engine
   `createSession` portion was 8–10 ms.
4. **Stream subscription: 0–1 ms.** It is immaterial here.

## Hypothesis assessment

- **MCP enumeration/connection:** contradicted as the dominant API-side cost. The exact `GET /mcp`
  enumeration invoked by `createSession` took 2.251–13.119 ms, and the profile's MCP allowlist was
  deny-all. This run did not instrument internals of the engine's `POST /session`; if that endpoint
  performs additional directory-scoped MCP initialization not visible as `GET /mcp`, that narrower
  possibility remains untested.
- **Lazy initialization:** weakly supported only at the new-directory engine-session boundary.
  Isolated `createSession` fell from 2,093 ms on the first observed request to 1,459–1,477 ms, while
  each isolated sample still used a distinct new cwd. The claimed 22.8s → 6.7s → 1.9s curve was not
  reproduced, and a compliant fresh-sandbox cold sample was unavailable (see below), so a broader
  process-level lazy-init curve is not established.
- **Contention/load:** untested. No synthetic load was introduced, and the prior 22.8–90+ second
  cases were not reproduced. These results identify the stage to observe under load; they do not
  explain why that engine session-create stage previously expanded to tens of seconds.
- **"The cost is in the API path around engine worktree create":** contradicted in its specific
  form. The controller does wait synchronously, but the measured seconds are in the engine session
  create for the worktree cwd, not raw worktree creation or controller bookkeeping.

## Cold-sample limitation

A managed restart was attempted so the first request would follow a fresh `sandbox.sh up`. The
required `tools/dev/sandbox.sh down` refused because the supervised engine had respawned and the
script's recorded PID was stale:

```text
sandbox engine port :4097 is now PID 71902, not recorded PID 98680; refusing to kill it
```

`GET /global/health` immediately confirmed the replacement engine was healthy. No PID file was
edited and no process was killed manually. Therefore sample 1 is accurately labeled
**first-observed / cold new worktree cwd**, not "first request after a fresh sandbox up." This is the
only requested measurement that could not be obtained.

## Reproduction commands

The commands below omit the bearer value; `TOKEN` is read from the isolated sandbox DB and never
printed.

```bash
cd /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite
REPO='/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite'
API='http://127.0.0.1:4098'
ENGINE='http://127.0.0.1:4097'
DB="$TMPDIR/rhythm-dev-sandbox/rhythm.db"
TOKEN="$(sqlite3 "$DB" "SELECT token FROM sessions WHERE expires_at IS NULL OR expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1;")"
ENCODED="$(jq -rn --arg v "$REPO" '$v|@uri')"
```

Engine-only worktree create (repeat with a unique `smoke-*` name, then delete using the returned
`.directory`):

```bash
NAME="smoke-timing-a-$(date +%s%N)"
curl -sS --max-time 180 -X POST \
  "$ENGINE/experimental/worktree?directory=$ENCODED" \
  -H 'Content-Type: application/json' \
  --data-binary "{\"name\":\"$NAME\"}" \
  -w $'\nstatus=%{http_code} total_s=%{time_total} starttransfer_s=%{time_starttransfer}\n'

curl -sS --max-time 30 -X DELETE \
  "$ENGINE/experimental/worktree?directory=$ENCODED" \
  -H 'Content-Type: application/json' \
  --data-binary "{\"directory\":\"<directory from create response>\"}"
```

Isolated API create:

```bash
NONCE="$(date +%s%N)"
curl -sS --max-time 180 -X POST "$API/agent-sessions" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data-binary "$(jq -nc --arg name "smoke-createworktree-timing-b-$NONCE" \
    --arg cwd "$REPO" --arg profileId local-lean --arg worktreeName "smoke-timing-b-$NONCE" \
    '{name:$name,cwd:$cwd,profileId:$profileId,isolateWorktree:true,worktreeName:$worktreeName}')" \
  -w $'\nstatus=%{http_code} total_s=%{time_total} starttransfer_s=%{time_starttransfer}\n'
```

Non-isolated API create:

```bash
NONCE="$(date +%s%N)"
curl -sS --max-time 180 -X POST "$API/agent-sessions" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data-binary "$(jq -nc --arg name "smoke-createworktree-timing-c-$NONCE" \
    --arg cwd "$REPO" --arg profileId local-lean \
    '{name:$name,cwd:$cwd,profileId:$profileId}')" \
  -w $'\nstatus=%{http_code} total_s=%{time_total} starttransfer_s=%{time_starttransfer}\n'
```

MCP status timing and API-log correlation:

```bash
for i in 1 2 3; do
  curl -sS --max-time 30 "$ENGINE/mcp" -o /dev/null \
    -w "mcp$i status=%{http_code} total_s=%{time_total} starttransfer_s=%{time_starttransfer}\n"
done

rg -n 'cad3e0ea-402a-483a-b898-95f04d013c48|a714a4e9-b290-4dac-bbe8-8ee3a552e8f2|62ec7897-b992-4663-9f1b-58e88fa704cc|cbaffe5a-87a8-4816-8f6f-915100a63e1c|5c86b6c4-5eba-4de8-8d08-e9f811acb875|987044b9-896e-45d9-ae8b-9173928c1100' \
  "$TMPDIR/rhythm-dev-sandbox/api_server.log"
```

Per-session cleanup used:

```bash
curl -sS --max-time 60 -X DELETE \
  "$API/agent-sessions/<local-id>/hard?removeWorktree=true" \
  -H "Authorization: Bearer $TOKEN"
```

Because the API worktree cleanup logged HTTP 400 despite returning 204, final cleanup also removed
only this run's exact worktree paths through the engine root-directory endpoint and deleted only its
exact orphan branches. Full evidence is in
[createworktree-timing-cleanup.txt](evidence/createworktree-timing-cleanup.txt).

## Evidence and final state

- [Raw curl samples](evidence/createworktree-timing-curl.txt)
- [Correlated API timing lines](evidence/createworktree-timing-api.txt)
- [Cleanup, residue, and profile proof](evidence/createworktree-timing-cleanup.txt)

Final checks: zero `smoke-` entries in `git worktree list`; zero
`opencode/smoke-*` branches; zero `smoke-createworktree-timing-*` rows in `agent_sessions`; zero
auth-session rows created by this run. The sandbox remained healthy on 4098/4097/4099 and was left
at `local-lean` / `omlx` / `gpt-oss-20b-MXFP4-Q8` with no `lmstudio` auth entry.
