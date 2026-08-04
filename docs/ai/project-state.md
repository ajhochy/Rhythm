# Project State

## Current focus

#1094 native OpenAI image generation — the engine half. The per-profile toggle
projected `permission.image_generation: allow` into agent frontmatter, but
opencode gates tools by name and no such tool was ever registered, so the
permission was silently inert for every profile. Now registered as an AI-SDK
provider tool and verified generating images live.

## Active branch / PR

- Branch: `workflow/run-2026-08-03-image-generation` (main merged in locally
  for combined live testing; the GitHub PR stays open)
- Base: `main` @ `dd60008c`
- PR: [#1304](https://github.com/ajhochy/Rhythm/pull/1304) (draft)
- Recently merged to main: [#1284](https://github.com/ajhochy/Rhythm/pull/1284)
  (mobile reliability/parity/profile rollup, #1277–#1287) and
  [#1303](https://github.com/ajhochy/Rhythm/pull/1303) (Config Doctor
  remediation), both after user-confirmed physical-device smoke.
- Merge remains a manual human action after review.

## In progress

- PR #1304 awaiting manual smoke in the desktop dev app on the combined
  branch. See
  docs/ai/runs/2026-08-03-issue-1094-image-generation-engine-wiring.md.

## Risks / known issues

- **Manual smoke needs the bundled binary replaced.** The installed app runs
  `/Applications/Rhythm.app/Contents/Resources/opencode_bin/opencode`. A source
  change has no effect until that binary is rebuilt/replaced, and the engine
  only reads agent files on a fresh boot — `/config/reload` will not pick up
  agent-file changes. `tools/dev/launch_desktop_current.sh` stages the freshly
  built fork for dev runs.
- **The fork's `node_modules` drifts incomplete.** Missing `tailwindcss`,
  `zod`, and `@opentui/*` broke `bun run build` in the embedded web-UI step and
  produced 3 test failures + 26 tsc errors. `bun install` in
  `apps/opencode_fork` fixes it with no lockfile change. Re-check this before
  concluding the fork build is broken.
- Pre-existing, unrelated to current work: `ModelsDev … disk empty and fetch
  disabled` (fork) and the curated-MCP failures (api_server) fail identically
  on an unmodified tree.
- Catalog-scoped client calls (`/session`, `/permission`, `/question` without
  the gateway prefix) 502 against the paired gateway origin whenever polling
  runs in a degraded state — pre-existing path mismatch, noted on #1287.
- Exact-owner projectless server-side filter from `cdd0bb465` remains in place
  and required.
- User-owned `.proof/` image modifications remain excluded from commits.

## Test status

- Fork: typecheck 0 errors; `bun test` 2712 pass / 1 pre-existing fail; build
  exit 0.
- api_server: typecheck 0 errors; `vitest run` 3822 pass / 4 pre-existing fail;
  build exit 0.
- `classify.cjs`: `FATAL=0 SKIPPED=0 WARN=0 OK=33`.
- Live on `openai/gpt-5.6-sol`: granted profile produces a 1254×1254 PNG with
  its path in the transcript; ungranted profile reports no tool; Anthropic
  profile unaffected.
- CI on #1304: OpenCode Fork, Server, and Mobile all green.
- Mobile (merged #1284): typecheck PASS, lint 0 errors, jest 24/24, Playwright
  web E2E 71/71 PASS.

## Next step

Manual smoke of #1304 in the desktop dev app on the combined branch: ask
`creative-media` for an image. Then human review and manual merge of #1304.
Follow-ups still tracked on #1287: desktop persisting profile bindings onto
agent_sessions rows; decision on cleaning pre-fix corrupted profile rows;
cold-start first-open latency budget; device-tier test gap for scope-flip
cache lifecycles.
