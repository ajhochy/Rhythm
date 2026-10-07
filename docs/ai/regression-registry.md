# Regression registry

**Read this before forming a hypothesis about any bug that "we already fixed."**

`docs/ai/` holds ~1,500 run logs, decisions and plans. Nobody reads 1,500 files
mid-incident, so this is the index: known failure mode → what the user sees →
what fixed it → the one check that proves it still works.

Most recurrent first. If a symptom here matches, start from the fixing commit
and ask *"is it present, and is it bypassed on some path?"* — that has been the
answer far more often than "it was reverted."

## How these actually recur

Three shapes, in order of frequency:

1. **The fix is present but bypassed on a path nobody checked.** Not reverted
   — just not on the route the symptom takes.
2. **The fix is write-path only, with no backfill and no read-path bound.** It
   stops new bad data; historical rows keep reproducing the symptom forever.
3. **The guard exists but CI never runs it**, or the test passes without
   exercising production code.

---

## 1. Mobile transcript frozen / showing old messages

**Symptom** — chat list and transcript show hours-old content; sends appear to
do nothing; the typing indicator animates forever; no error shown.

**Fixes**
- `abfd5bcd` (2026-09-29, #1587) — live delta streaming. Replaced a 150 ms
  trailing debounce that did a full-page refetch on every pause (measured
  1.61 MB per pause, O(transcript)). Deltas are exempt from recovery dedupe
  because the OpenCode delta envelope carries no top-level `id`.
- `978b631b`, `105f5a9e` (2026-10-07) — byte bounds on transcript pages.
  `limit` bounds messages, never bytes; a 20-message page measured
  **15,714,325 bytes** against an **8,388,608** gateway cap, so the seed was
  undeliverable and deltas had no parent message to attach to.
- `20554dad` (2026-10-07) — same ceiling on mirror-served pages, which bypass
  the engine and so bypassed the engine's bound.

**Check**
```bash
curl -s -o /dev/null -w '%{size_download}\n' \
  "http://127.0.0.1:4096/session/<SDK_SESSION_ID>/message?directory=<DIR>&limit=20"
# must be well under 8388608
```

**Trap** — deltas apply only on top of a seeded list. If the seed fails, the
transcript freezes silently and every delta is discarded.

---

## 2. Oversized images / attachments in transcripts

**Symptom** — one session serialises to hundreds of MB; reads stall the engine.

**Fix** — `97466a2c` (2026-09-28) re-enabled `image.normalize` (2000px /
4.5 MB base64) for tool images; `8a092d2f` (2026-09-28) compresses mobile photo
uploads. **Both still present and working.**

**Verified 2026-10-07**: zero attachments over 4.5 MB created since 2026-09-29;
69 attachments, max 3,090 KB.

**Why it still bites** — shape 2 above. The fix is write-path only. Sessions
from before 2026-09-28 still carry 508 KB–19 MB inline base64 URIs forever,
and nothing bounded *serving* them until the byte bounds above. **Do not
conclude the image fix regressed** — check the creation date of the offending
attachment first.

**Check**
```sql
-- opencode.db: must return 0
SELECT count(*) FROM part p, json_each(json_extract(p.data,'$.state.attachments')) a
WHERE datetime(p.time_created/1000,'unixepoch') >= '2026-09-29'
  AND length(json_extract(a.value,'$.url')) > 4718592;
```

---

## 3. Engine unresponsive / whole app slow under mobile load

**Symptom** — gateway healthy, engine hangs for minutes, mobile times out at
30 s, desktop survives because it has no equivalent abort.

**Fix** — `c5f55793` (2026-10-07): `git gc` → `git gc --auto` in snapshot
cleanup. Unconditional `gc` repacks every run; a repo with **0 loose objects**
still took **411,291 ms (6.9 min)** rewriting a 1.73 GiB pack, under a
one-permit semaphore. Also stopped logging every `message.part.delta`
(12,093 of 26,041 log lines).

**Check** — `service=snapshot prune=7.days cleanup` lines in
`~/.local/share/opencode/log/*.log` should show single/double-digit ms. The
`+Nms` on that line *is* the gc duration (it logs after `git gc` returns).

**Trap** — a large `+Nms` gap elsewhere in that log means only "no log lines
for N ms", which during idle is normal. It is **not** evidence of a stall.
Measure responsiveness directly (`curl` the engine), not log silence.

---

## 3b. Engine pinned by snapshot track() hashing a media directory

**Symptom** — phone shows three dots forever; prompts never reach the engine;
engine at 100% CPU with the gateway idle. Looks identical to #3 but is a
different cause, and is triggered by *opening a chat*, not by mobile traffic.

**Cause** — `track()` had a 2 MB per-file guard and **no aggregate budget**, so
a directory of sub-limit files staged in full. Measured 2026-10-07 on a real
session cwd: 483 files blocked as large, **5,590 files / 2.05 GB hashed on
every track()**, pinning the main thread ~88 s.

**Fix** — `2d4cfdaf`: aggregate byte budget, untracked bulk excluded
smallest-first via the existing `sync()` exclusion path. Only untracked paths
are excluded, so revert of edited (tracked) files is unaffected.

**Check**
```bash
grep -E "\+[0-9]{4,}ms" ~/.local/share/opencode/log/<newest>.log   # expect none
grep "aggregate budget" ~/.local/share/opencode/log/<newest>.log    # fires on large cwds
```

**Trap** — the session `cwd` matters more than anything about the chat. A chat
rooted in a media/vault folder behaves completely differently from one in a
code repo. Check `agent_sessions.cwd` before assuming the chat is the variable.

**No prior art** — searched `docs/ai/` (223 files mention snapshot); none
covered `track()` staging cost. This one was genuinely new.

## 3c. Engine pinned by File.status reading every untracked file

**Symptom** — identical to #3/#3b from the phone: three dots forever, then an instant
"network error" (`paired-mac.invalid`). Triggered by *connecting* to a chat whose cwd
has large untracked files, not by sending.

**Cause** — `File.status` read every `git ls-files --others` file in full and split on
newlines to count lines. Measured 2026-10-07: 1,842 untracked files / 3.0 GB (2.9 GB
.png) → **71.5 s per `GET /file/status`**, 97% of CPU in native UTF-8 `decode`. Mobile
calls `file.status()` on every connect.

**Fix** — `d69ad22e`: skip non-text mimes, 1 MiB per-file cap, 64 MiB aggregate budget.
Same commit stops the engine watching `$HOME` (654 legacy sessions rooted there).

**Check**
```bash
curl -s -o /dev/null -w '%{time_total}\n' "http://127.0.0.1:4096/file/status?directory=<cwd with big untracked media>"
# must be well under 1 s; 71.5 s before the fix
```

**Trap** — the JSC profile showed only `decode` under `readFile` because Effect's
runLoop flattens the stack; the caller was found by listing every `readFileString`
site in the engine and matching the second hot frame (`stringSplitFast`).

## 4. Stale data shown with no error

**Symptom** — app shows hours-old data and looks connected.

**History** — `settleBackgroundRead` consuming rejections was **deliberate**
(`docs/ai/runs/2026-08-19-mega-c-relay-mobile.md`: *"updates offline presence
and consumes the rejection"*), to stop uncaught `MacOfflineError` crashes. The
unintended consequence: a healthy gateway in front of an unresponsive engine
leaves stale content on screen looking current.

**Fix** — `978b631b` (2026-10-07) surfaces the failure via
`backgroundReadError` and a "Showing older messages" notice. The original
intent is preserved — the rejection is still not rethrown. `macPresence`
stays `online` on purpose: the Mac is reachable, the read failed.

---

## 5. Mobile reads skipping the mirror

**Symptom** — every transcript read hits the engine even though a local mirror
exists.

**State** — open, [#1606](https://github.com/ajhochy/Rhythm/issues/1606).
`readMirrorTranscript` serves only when every row carries verbatim
`info_json`. Measured 2026-10-07: **53,997 of 154,718 rows (35%)** missing it,
forcing **4,733 of 8,898 sessions (53%)** onto the engine.

**Check**
```sql
SELECT count(*) FROM (SELECT session_id FROM agent_session_messages
  GROUP BY session_id HAVING sum(CASE WHEN info_json IS NULL THEN 1 ELSE 0 END) > 0);
```

---

## 6. Payload byte budgets (methodology, established 2026-07-30)

`docs/ai/runs/2026-07-30-r5-agent-dto-transcript-pagination.md` set the
precedent: measure the serialized payload, state a byte budget, prove the
before/after. A 39-agent fixture went 1,759,943 → 9,789 bytes (99.44%),
*"below the documented 32 KiB budget."*

**Use this before inventing a new approach.** Bound by bytes, not by item
count — item counts do not bound payloads.

---

## 0. Instruments that lie — read this before trusting any signal

The single largest source of wasted diagnosis in this repo. Four separate
indicators report success, or a specific cause, that they have not verified.
All four cost most of 2026-10-07.

**"A notification arrived, therefore the backend worked" is not a valid
inference in this codebase.**

| Signal | What it claims | What it actually means |
|---|---|---|
| `"OpenCode finished a task"` push | a turn completed | **fires on ABSENCE of activity.** The phone marks a session pending on send, then notifies once it stops looking busy for 5s. A prompt that never reached the engine satisfies every guard — no busy status ever arrives — so the notification fires *because* the request failed. Local notification, not a server push; reads neither store. Fixed: requires an observed busy status first. |
| `[MobileOpenCodeProxy] upstream request timed out` | the 30s timeout fired | fires on **any** `AbortError` from any source, and the branch that logs the real error name and cause code is unreachable for it. A 14ms connection abort was indistinguishable from a 30s timeout. Fixed: distinguishes our timer from a foreign abort and logs the identity. |
| `session.status` busy | the agent is working | **sticky.** The engine emits busy and, if it dies, never emits idle — so the typing indicator spins forever on a dead turn. Fixed: non-idle statuses are cleared when the event stream is not connected. |
| `settleBackgroundRead` | (silent) | swallowed **every** read failure (`.catch(() => undefined)`), so a healthy gateway in front of an unresponsive engine left hours-old data on screen looking current. Deliberate originally (2026-08-19, to stop uncaught `MacOfflineError` crashes) — the staleness was the unintended half. Fixed: surfaces a "Showing older messages" notice without rethrowing. |

**Method that works:** verify the instrument before the subject. Confirm what
a field or log line actually measures before reasoning from it. Specific traps
already paid for:
- A large `+Nms` gap in the engine log means only "no log lines for N ms" —
  during idle that is normal, NOT a stall. Measure responsiveness directly.
- The engine logs only some HTTP requests; absence of a log line does not mean
  the request never arrived.
- `/health` self-reports `commit: "dev"` and will not tell you the running SHA.
  Get it from the process `--app-path`.
- More than one Rhythm bundle can be installed. `open -a <path>` resolves via
  LaunchServices by bundle ID and may launch a DIFFERENT copy than the path you
  gave it. `lsof` the running engine to learn which binary is actually serving.

## 7. Guards that do not run, and tests that pass without testing

Hit repeatedly. Before trusting any regression test:

- **Is it in a suite CI executes?** Fork CI runs only `test/session/`,
  `src/session/`, `test/tool/task.test.ts` and one server test — named
  explicitly in `.github/workflows/opencode_fork_ci.yml`. A test outside those
  paths never runs. `test/snapshot/` and `test/bus/` were added 2026-10-07 for
  exactly this reason. Mobile `test:jest:ci` excludes five suites by pattern.
- **Does it exercise production code?** Known anti-patterns found in this repo:
  a test that extracts a `useMemo` body with the TypeScript AST and runs it via
  `new Function`; a test asserting a field (`id`) production never sends; a
  contract of `expect(false).toBe(true)` reported as verified RED.
- **Mutation-prove it.** Break the fix, confirm the test fails, restore.

---

## Updating this file

Add an entry when you fix something a future investigation could mistake for
new. Keep each to: symptom the user reports, fixing commit, one runnable
check, and the trap that makes it look like something else.
