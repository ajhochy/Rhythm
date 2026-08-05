# Smoke checklist — `mega/run-2026-08-04` (PR #1319)

## Results — round 3 (2026-08-04, driven directly against the running app)

Rounds 1–2 were driven by a Codex agent. Round 2 returned 8/8 BLOCKED claiming
the app was unreachable; the app was healthy throughout (one PID set, alive
across the whole window), and the `curl: (7) … after 0 ms` refusals were Codex's
own sandbox denying localhost. Round 3 drove the app directly instead.

| Item | Verdict | Evidence |
|---|---|---|
| C3 Org External Discovery | PASS | `completed_no_op`; 12/12 tool calls completed, zero denials, zero approvals. Includes `rhythm_get_dashboard`, the tool that threw the round-1 taint 403. |
| A5 `pco-song-usage-sync` | PASS | `success`; 25/25 tools completed, no `$HOME` glob, no inactivity abort. 17 plans / 78 song occurrences / 58 notes touched. |
| E5 secretary auto-approve | PASS | `GET /agent-configs` → `secretary.autoApproveActions = false`. |
| E6 curated-MCP credential gate | PASS | empty `{}` → 400 `MISSING_CREDENTIALS`; whitespace-only key → 400; unknown server → 404 `NOT_CURATED` (discriminating control). This is the item that returned 200 in round 1. |
| E2 `git push --force` card | PASS *after a fix* | Initially executed with an auto-`accept`. Root-caused to two payload mismatches (see below), fixed in f8ece4f5. Now broadcasts `permission.asked` — "approvals.mode=manual — awaiting user approval" — leaves bash at `running`, executes nothing. |
| D1 skill data loss | PASS | `monday-worship-planning/SKILL.md` = `328575ea…` before and after a full 474-file suite run. |
| E1 interactive taint gate | PASS | Armed with `rhythm_list_message_threads` (`message-thread.list` is deliberately NOT in `SOURCES_EXEMPT_FROM_APPROVAL_GATE`), then asked for `rhythm_create_task`. The agent called `rhythm_request_approval` instead — `rhythm_create_task` was never invoked — and stopped: "Approval is required before creating the task." Round 1's attempt used first-party-exempt `task.list`, which never arms the gate. |
| E3 hardline denial | PARTIAL | `rm -rf /` **does** escalate (profiles carry `rm -rf*: ask`) and is denied — proven by unit test against the captured payload. But the pipe-to-shell class never reaches the gate at all. See #1322. Not fired live: firing `rm -rf /` to test a deny path risks the disk if the deny path is broken. |
| E4 plan mode auto-deny | FAIL | `echo` matched the profile's `bash {"*":"allow"}`, so the engine never asked and plan-mode auto-deny never ran — the command executed. Same structural cause as E3. Tracked in #1322. |

### The E2 root cause (f8ece4f5)

Captured off the engine's own `:4096/event` stream:

```json
{"permission":"bash","patterns":["git push --force no-such-remote-xyz HEAD"],
 "metadata":{},"always":["git push *"],"tool":{…}}
```

The bridge read `perm.toolName ?? perm.type` (neither field exists — the id is in
`permission`) and took the command from `args.command`/`metadata.command`
(`metadata` is `{}`; the text is in `patterns`). So `toolName` was `''` for every
real engine permission, silently disabling **both** the #736 tool-allowlist
backstop and the #878 command gate. Every pre-existing #878 test passed anyway,
because they hand-build `metadata: { command }` — a shape no engine event has.

**Testing note:** assert against a payload captured from the running engine, not
a hand-written one. Two security layers were dead for as long as the tests
described a payload the engine never sends.


Every item is **verifiable from the running app** via `http://localhost:4001` or the
Obsidian vault. No item requires guessing.

Preconditions (already true when this was written):
- App running from `mega/run-2026-08-04`; engine reports
  `0.0.0-mega/run-2026-08-04-*` on `:4096`.
- `GET /opencode/health` → `{"status":"ready"}`.

Record for each item: **PASS / FAIL**, the command or endpoint used, and the actual
output. A FAIL needs the real error text, not a paraphrase.

---

## A. Scheduled-agent autonomy

**A1 — every enabled task completes unattended.**
Trigger each of the 17 enabled tasks (`POST /agent-schedules/<id>/trigger-now`),
wait for a terminal `lastRunStatus`, then for each assert:
- `lastRunStatus` is `success` or `completed_no_op` — never `error`, never stuck
  `running`/`queued`
- **zero** pending approvals in the run tree
- **zero** tool calls denied for permission reasons

Run history is only visible via `GET /agent-sessions?scheduledTaskId=<id>`
(`is_system=1` rows are excluded from the plain session list).

**A2 — Memory Consolidation actually captures.** Task
`8c7a99fa-8ba2-482e-acd0-e579b54e1818`. Final message must show
`Captured: >0` and `human decision: 0`. Its failure signature is
success-with-zero-work, so `success` alone is not a pass.

**A3 — first-party reads are not blocked.** In the A2 transcript,
`rhythm_list_sessions` and `rhythm_list_memories` must both return content.
`[BLOCKED: … Content not loaded.]` is a FAIL. A `[NOTE: N of M … withheld]` line is
a PASS — that is per-item salvage working.

**A4 — no orphaned runs.** After A1, no enabled task sits at `running`/`queued`.

**A5 — `pco-song-usage-sync` completes.** Task
`d469de2c-8733-49a4-99eb-7014dc3ade11`. Must not die on the 600s inactivity
window, and must not run `glob` against `/Users/ajhochhalter`.

## B. Engine timeouts

**B1 — `glob` is bounded.** A glob over a huge tree returns an actionable timeout
error rather than hanging. Expect the error to name the path and the env var
(`RHYTHM_GLOB_TIMEOUT_MS` / `RHYTHM_RIPGREP_TIMEOUT_MS`).

**B2 — no orphaned `rg`.** After B1, `pgrep -fl "rg --no-config"` is empty.
First confirm the detector works by checking it reports a live `rg` — an empty
result from a pattern that never matches proves nothing.

**B3 — `image_generation` survives a slow render.** Ask an image-capable profile
(`creative-media` has `imageGenerationEnabled=true`) for a deliberately expensive
image. Must NOT fail with `Provider stream inactive for 180000ms`.

**B4 — the watchdog still protects text streams.** `RHYTHM_PROVIDER_STREAM_INACTIVITY_MS`
must NOT be forced to 600000 on the engine child — the interim raise was removed.
Check the engine process env.

## C. Org optimizer accuracy

**C1 — no false scope proposals.** Trigger Org Self-Optimizer
(`fd8eab78-83ff-4a04-a0ee-e9454e593425`) — wait >90s after any relaunch, it skips
inside a cold-start window. Then read `GET /agent-org-proposals`. There must be NO
proposal claiming `planning-agent` lacks `gitnexus`, and none claiming
`creative-media` lacks image generation. Both are false: `planning-agent` has
`{"gitnexus": null, …}` (null = all tools) and `creative-media` has
`imageGenerationEnabled=true`.

**C2 — granted tools are dispatchable.** A profile with `{"gitnexus": null}` can
actually call a gitnexus tool. Previously the profile layer advertised them and the
dispatch guard denied them.

**C3 — Org External Discovery completes without a pending approval.** Task
`65d48739-b305-41cd-b961-a2d0587f283a`.

## D. Skill data loss

**D1 — the test suite cannot touch real skills.** Record
`shasum ~/.config/opencode/skills/monday-worship-planning/SKILL.md`, run
`cd apps/api_server && npm test --silent -- --fileParallelism=false`, re-record.
**The hash must be identical.** This file was destroyed three times in one
afternoon before the fix.

**D2 — the guard fails loudly.** A test that resolves the managed-skills root to
the real `~/.config/opencode/skills` must THROW, not write.

**D3 — skill bodies are intact.** These five must each have a non-empty body:
`daily-email-triage`, `daily-dev-summary`, `monday-worship-planning`,
`monthly-gc-report`, `AI__Trend__Research__with__Obsidian__Brief__and__Dashboard`.

**D4 — an unknown score does not destroy a skill.** An unparseable/absent score
must leave a skill untouched, not disable or empty it.

## E. Regression guards (these must still be true)

**E1 — interactive sessions keep the approval gate.** A non-scheduled session
(`is_system=0`, no `scheduled_task_id`) must still require human approval for a
protected mutation after external content. The autonomy work must not have
loosened this.

**E2 — `git push --force` still surfaces a card.** In an interactive session under
`bypassPermissions`, a dangerous-but-not-hardline bash command must still prompt.

**E3 — hardline commands are still denied.** `rm -rf /` is refused even in an
unattended scheduled run.

Do NOT verify this by actually running a destructive command: if the deny path is
broken the test destroys the machine. Use `curl -s http://127.0.0.1:9/nope | sh`
instead — it matches the `curl-pipe-shell` hardline pattern and is inert even if
it executes, because port 9 (discard) refuses the connection and `sh` then reads
empty stdin. Pair it with the unit tests that assert the destructive patterns
against a captured payload.

**E4 — plan mode auto-denies the tools it can see.** Scoped deliberately: plan
mode is NOT read-only for bash, and never was. The engine's own native `plan`
agent (`agent/agent.ts`) denies `edit` (with plan-file exceptions) but not `bash`
— only `explore` denies `*`. Rhythm's plan-mode auto-deny fires only on
permissions the engine escalates, so with a profile carrying
`bash {"*": "allow"}` a plain `echo foo` runs. After the #1322 escalation the
dangerous shapes (bare `sh`/`bash`/`zsh`, `mkfs*`, `dd *`) DO escalate and are
auto-denied in plan mode. Assert that, not blanket bash denial. Genuine
read-only bash needs a per-session ruleset override — still open in #1322.

**E5 — `secretary` has NO auto-approve.** `GET /agent-configs` →
`secretary.autoApproveActions` must be `false`. Deliberate: `email.send` is a
protected action.

**E6 — a curated MCP credential gate cannot be weakened.** A key-based curated
server must still reject an empty credential payload with
`400 MISSING_CREDENTIALS`.

## F. App health

**F1** — `/health`, `/opencode/health`, `/agents/capabilities` all healthy.
**F2** — MCP servers: `rhythm` and `obsidian` both `connected`.
**F3** — engine on `:4096` reports the `mega/run-2026-08-04` version (not the Aug 3
build). A stale binary silently tests the wrong engine.
