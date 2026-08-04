# Project State

## Current focus

#1094 native OpenAI image generation — the engine half. The per-profile toggle
projected `permission.image_generation: allow` into agent frontmatter, but
opencode gates tools by name and no such tool was ever registered, so the
permission was silently inert for every profile. Now registered as an AI-SDK
provider tool and verified generating images live.

## Active branch / PR

- Branch: `workflow/run-2026-08-03-image-generation`
- Base: `main`
- PR: [#1304](https://github.com/ajhochy/Rhythm/pull/1304) (draft)
- Also open: [#1284](https://github.com/ajhochy/Rhythm/pull/1284) (draft,
  mobile SSE rollup) — device smoke PASSED, awaiting human review/merge.
- Merge remains a manual human action after review.

## In progress

- None. PR #1304 awaiting CI + manual smoke in the desktop app. See
  docs/ai/runs/2026-08-03-issue-1094-image-generation-engine-wiring.md.

## Risks / known issues

- **Manual smoke needs the bundled binary replaced.** The installed app runs
  `/Applications/Rhythm.app/Contents/Resources/opencode_bin/opencode`. A source
  change has no effect until that binary is rebuilt/replaced, and the engine
  only reads agent files on a fresh boot — `/config/reload` will not pick up
  agent-file changes.
- **The fork's `node_modules` drifts incomplete.** Missing `tailwindcss`,
  `zod`, and `@opentui/*` broke `bun run build` in the embedded web-UI step and
  produced 3 test failures + 26 tsc errors. `bun install` in
  `apps/opencode_fork` fixes it with no lockfile change. Re-check this before
  concluding the fork build is broken.
- Pre-existing, unrelated to current work: `ModelsDev … disk empty and fetch
  disabled` (fork) and the curated-MCP + agent-approvals failures (api_server)
  fail identically on an unmodified tree.
- Catalog-scoped client calls (`/session`, `/permission`, `/question` without
  the gateway prefix) 502 against the paired gateway origin when polling runs
  degraded — pre-existing path mismatch, noted on #1287.
- User-owned `.proof/` image modifications remain excluded from commits.

## Test status

- Fork: typecheck 0 errors; `bun test` 2712 pass / 1 pre-existing fail; build
  exit 0.
- api_server: typecheck 0 errors; `vitest run` 3821 pass / 5 pre-existing fail;
  build exit 0.
- `classify.cjs`: `FATAL=0 SKIPPED=0 WARN=0 OK=33`.
- Live on `openai/gpt-5.6-sol`: granted profile produces a 1254×1254 PNG with
  its path in the transcript; ungranted profile reports no tool; Anthropic
  profile unaffected.
- Mobile (PR #1284): typecheck PASS, lint 0, jest 24/24, Playwright 71/71.

## Next step

Manual smoke of #1304 in the desktop app: replace the bundled engine binary,
fully quit and relaunch Rhythm, then ask `creative-media` for an image. Then
human review and manual merge of #1304 and #1284.
