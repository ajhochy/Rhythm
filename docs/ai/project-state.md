# Project State

## Current focus

Desktop release `v0.18.51` is published after the bundled-server smoke fix
merged in PR #1184 and the full release workflow completed successfully.

## Active branch / PR

- Main fix: [PR #1184](https://github.com/ajhochy/Rhythm/pull/1184), merged as
  `0c12bdab4` and tagged `v0.18.51`.
- Follow-up branch: `codex/fix-desktop-release-sqlite-smoke`.
- The follow-up contains only the regression guard and project-memory update;
  its draft PR is not open yet.

## In progress

- Open the follow-up draft PR for the static regression guard and run record.
- No release implementation work remains.

## Risks / known issues

- No known release blocker remains.
- GitHub emitted a non-blocking warning that several actions still target
  deprecated Node.js 20 metadata while the runner forces Node.js 24.

## Test status

- Desktop Release run
  [30178638700](https://github.com/ajhochy/Rhythm/actions/runs/30178638700):
  **PASS** at `d36c108c1` in 13m57s.
- Universal macOS build, bundled server and memory smoke, fork/MCP/skill
  persistence checks, packaging, signing, notarization, artifact upload, and
  release publication all passed.
- Local targeted parity guard: 9/9 passed after first proving the new assertion
  fails against the old relative-path workflow.
- `ai-workflow checks --level issue` and `--level pr`: passed.
- API build and `actionlint`: passed.
- GitNexus: 3 changed files, 0 affected processes, LOW risk.
- Full evidence:
  `docs/ai/runs/2026-07-25-desktop-release-bundled-sqlite-smoke.md`.

## Next step

Open the follow-up draft PR, then leave merge to human review. The release
itself is already published.
