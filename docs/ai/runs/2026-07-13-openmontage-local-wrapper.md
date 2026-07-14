---
date: 2026-07-13
repo: Rhythm
branch: fix/boot-stomp-config-revert-class
pr: null
issues: []
status: in_progress
tags: [run, Rhythm, openmontage, mcp]
---

# OpenMontage local wrapper integration

## Files

- External install: `/Users/ajhochhalter/Documents/OpenMontage` (upstream OpenMontage checkout).
- External local wrapper: `/Users/ajhochhalter/Documents/OpenMontage-mcp/openmontage_mcp_server.py`.
- External skill: `~/.config/opencode/skills/social-video-pipeline/SKILL.md` — replaced Higgsfield-only routing with the OpenMontage review contract.
- Runtime config: registered `openmontage` as a connected local MCP and added only its seven review-safe tools to `graphic-designer`.
- Repo record: this run log and `docs/ai/decisions/2026-07-13-openmontage-wrapper-boundary.md`.

## Checks

- `brew install ffmpeg` — installed FFmpeg 8.1.2_1.
- `make setup PYTHON_VERSION=3.12` — installed OpenMontage dependencies, Remotion, Piper, and HyperFrames; no Node-version change.
- `make demo PYTHON_VERSION=3.12` — three zero-key Remotion MP4 demos rendered and passed FFprobe.
- Wrapper stdio MCP initialize/list/create-script-review — passed; script checkpoint was `awaiting_human`.
- Wrapper approved text-motion render — passed; vertical 1080×1920 MP4 produced and passed FFprobe.
- Piper `en_US-lessac-medium` local voice model — installed at `models/piper/`; local narration smoke passed.
- Fresh full zero-key wrapper E2E — passed: script approval → Piper narration → Archive.org candidate and provenance → asset approval → local FFmpeg vertical draft. Output: `projects/zero-key-local-workflow-check-1e707e18/renders/zero-key-draft-f18f5539.mp4` (5.148980s, 2,761,369 bytes).
- `brew install ffmpeg-full` — installed keg-only FFmpeg 8.1.2_1 with `libass`; wrapper pins to that binary rather than replacing the existing system FFmpeg.
- Fresh caption/music MCP E2E — passed: script approval → Piper narration → Archive.org candidate → explicit footage approval + explicit local music approval → 1080×1920 MP4. Report records `captions_burned: true` and sidechain-ducked music. Output: `projects/caption-and-music-workflow-check-23bd33cb/renders/zero-key-draft-b0714981.mp4` (5.433333s, 2,424,227 bytes). The synthetic verification tone was removed from the real music library afterward.
- Caption visual inspection — initially exposed oversized SRT scaling; wrapper typography was corrected to the observed readable lower-third treatment and a fresh local frame inspection passed.
- Live API profile refresh/resync — passed; generated Graphic Designer agent file denies Bash and scopes the seven `openmontage_*` tools.
- `ai-workflow checks --level issue` — passed (Flutter analyze/format and API TypeScript).
- `ai-workflow checks --level pr` — blocked by 12 pre-existing failures in `apps/api_server/src/services/__tests__/opencode_agent_writer.test.ts`.
- Fast first-pass timeout guard — passed: zero-key acquisition is constrained to three queries × one clip with a 75-second wall-clock deadline. A simulated no-candidate timeout returned `asset_retrieval_needs_human_decision`, and a live stdio MCP project reached `awaiting_human` asset review; an attempted text-motion render for that project returned the expected rejection.
- Live MCP reload — passed: `POST /opencode/mcp/openmontage/disconnect`, `POST /opencode/mcp/openmontage/connect`, and `POST /system/refresh` completed; `GET /opencode/mcp` reports OpenMontage `connected`.

## Notes

- The zero-key wrapper now supports local Piper narration and public-source footage candidates after script approval, followed by a separate asset/narration approval gate before composition. It has no paid provider, unrestricted music, AI imagery, shell, export, share, publish, delete, or provider-configuration capability.
- The system Homebrew FFmpeg 8.1.2_1 build lacks its `subtitles` filter; the wrapper uses the isolated `ffmpeg-full` binary for caption burn-in.
- Local music library: `OpenMontage/music_library/README.md` documents the required adjacent rights metadata. It is intentionally empty until AJ adds tracks he is entitled to use.
- OpenMontage is AGPLv3; review before redistributing or bundling it.
- A zero-key acquisition attempt now writes a durable project marker. Partial candidates are reviewable; no-candidate acquisition is an explicit human-decision state. Neither condition can fall back to text motion within that project.

## Out-of-scope verification follow-up

**Failure:** `ai-workflow checks --level pr` fails in
`opencode_agent_writer.test.ts` (12 assertions). The active worktree already
contains an unrelated edit in
`apps/api_server/src/services/opencode_agent_writer.ts`: `injectManagerPreamble`
returns `body` before its routing-preamble implementation, while the tests
still assert the former manager-routing behavior.

**Required fix:** the owner of that existing routing-policy change must either
restore the routing implementation or update its contract/tests deliberately.
It is intentionally not changed by the OpenMontage integration.

### Timeout-guard verification rerun

- `ai-workflow checks --level issue` — passed (Flutter analyze/format and API
  TypeScript) on `fix/boot-stomp-config-revert-class` at
  `5f8d772c32c1bf7b8ffb970de7eabb8d54ef3858`.
- `ai-workflow checks --level pr` — reproduced the same unrelated 12 failures
  in `apps/api_server/src/services/__tests__/opencode_agent_writer.test.ts`.
  Isolation confirms `injectManagerPreamble` returns `body` at line 156 before
  the routing-preamble implementation. This predates and is unrelated to the
  external OpenMontage wrapper and skill changes.
