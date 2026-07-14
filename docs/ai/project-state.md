# Project State

## Current focus

**Boot-stomp class fix (2026-07-11)** — one architectural fix for the whole
"my agent/skill/task edits are gone on the next boot" bug family. Root cause:
one-time seeds/repairs coded as eternal enforcement (unguarded content writes
firing on every boot / every picker refresh). Full taxonomy + fix in
`docs/ai/runs/2026-07-11-boot-stomp-class-fix.md`; the convention is recorded
in `docs/ai/decisions/2026-07-11-content-writes-are-one-time.md`.

## Active branch / PR

- **PR #1080** `fix/1039-profile-sync-mode-all-revert` — mode:'all' sync fix
  (open, awaiting merge).
- **NEW (this session)** `fix/boot-stomp-config-revert-class` (stacked on
  #1080) — runOnce marker mechanism for all migration content repairs,
  session_selectable made user-owned (insert-only in sync), secretary roster
  reconcile one-time, seeded-task delete tombstones, CLI-preset scheduling
  guard fix. Draft PR to be opened; do NOT merge without owner sign-off.

## In progress

- Draft PR + owner smoke of the fix branch. Everything else verified:
  tsc clean, 2702/2702 tests, live 3-boot restart proof 16/16, negative
  control (replay guard fails on pre-fix code) confirmed.

## Risks / known issues

1. Repairs now fire once per install — shipping a NEW default prompt/preset
   value requires a new `runOnce` key (contract documented at top of
   runMigrations; enforced by `migrations_replay_guard.test.ts`).
2. Postgres bootstrap marker path is code-reviewed but not integration-tested
   (test infra is SQLite-only) — verify on next prod deploy.
3. Follow-ups to file: stale DB-body snapshot in org-optimizer
   `applySkillBodyRevision` revert path; `allowed_mcps_json` NULL overload
   (unset vs unrestricted); prod-task mirror reverts local edits to mirrored
   non-done tasks (by design, but undocumented for users).

## Test status

- api_server: 2702 passed / 26 skipped; `tsc` clean.
- Live: 3 real server boots against scratch DB — all user edits survived.

## Next step

Open draft PR, hand to owner for manual smoke (edit Config Doctor in the real
app, restart, confirm it sticks), merge #1080 first or fold it in.

## Recent coding-agent runs

### 2026-07-13 — openmontage-local-wrapper
- Files modified: machine-local `/Users/ajhochhalter/Documents/OpenMontage-mcp/openmontage_mcp_server.py`; machine-local OpenCode config/skill; this run log and decision record.
- Checks run: OpenMontage setup + zero-key Remotion demos; stdio MCP gate/render path; live Rhythm profile/MCP scope checks. Repo workflow checks pending verification-gate.
- Decisions made: narrowed Graphic Designer to four OpenMontage MCP tools while retaining `corePermissionsJson: null` and Bash deny; see `docs/ai/decisions/2026-07-13-openmontage-wrapper-boundary.md`.
- Deviations from spec: the wrapper deliberately provides local text-motion drafts only, not stock/AI footage, narration, music, or publishing.
- Concerns: superseded by the zero-key documentary workflow entry below.

### 2026-07-13 — openmontage-zero-key-documentary-workflow
- Files modified: machine-local `/Users/ajhochhalter/Documents/OpenMontage-mcp/openmontage_mcp_server.py`; machine-local Piper model and social-video skill; this decision/run record.
- Checks run: Piper narration smoke; fresh stdio MCP E2E (script approval → no-key Archive.org candidate → asset approval → local vertical render) passed; live Graphic Designer scope refresh/resync passed.
- Decisions made: retained Graphic Designer's Bash deny and added only two review-gated zero-key tool calls; FFmpeg caption support is detected and made visible rather than silently omitted. See `docs/ai/decisions/2026-07-13-openmontage-wrapper-boundary.md`.
- Deviations from spec: music remains intentionally unavailable without a separately approved, user-supplied licensed track; this FFmpeg build cannot burn captions.
- Concerns: public-source license metadata is presented for human review, not treated as a universal clearance; repository-wide PR checks remain blocked by a pre-existing unrelated `opencode_agent_writer` test mismatch.

### 2026-07-13 — openmontage-captions-local-music
- Files modified: machine-local OpenMontage wrapper and social-video skill; machine-local music-library README; Graphic Designer's MCP allowlist; this decision/run record.
- Checks run: full FFmpeg `libass` filter check; fresh MCP E2E with burned SRT captions and an explicitly approved synthetic test-music fixture; local fixture removed after the render; live MCP disconnect/connect and profile resync passed.
- Decisions made: pin the wrapper—not global PATH—to keg-only `ffmpeg-full`; allow music only from the metadata-gated local library with a separate explicit approval. See `docs/ai/decisions/2026-07-13-openmontage-wrapper-boundary.md`.
- Deviations from spec: no production music is preloaded; AJ must add tracks with declared rights metadata.
- Concerns: prior unrelated `opencode_agent_writer` test mismatch still blocks repository-wide PR verification.

### 2026-07-13 — openmontage-fast-first-pass-timeout-guard
- Files modified: machine-local OpenMontage MCP wrapper and `social-video-pipeline` skill; this run record.
- Checks run: wrapper compile/config assertions; simulated timeout contract; live stdio MCP asset acquisition and text-motion-rejection check; live MCP reconnect plus Rhythm skill/profile refresh.
- Decisions made: limit first-pass footage retrieval to three queries, one clip each, and a 75-second deadline; preserve partial candidates for review and make no-result retrieval an explicit human-decision state. Once zero-key acquisition starts, the same project cannot render text motion.
- Deviations from spec: none.
- Concerns: public-source response speed remains network-dependent; a timeout can still return no candidates, but now stops safely rather than hiding the condition.
