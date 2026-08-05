# Smoke checklist — `mega/run-2026-08-04` (PR #1319)

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

**E4 — plan mode still auto-denies.**

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
