# Project state

## Current focus

Model routing on Kev: new **System One (Kev / Jev)** decision backend — one typed `choice` question per routed prompt, calibrated low-confidence fallback to `standard`.

## Active branch / PR

`feat/router-systemone-backend` off `mega/2026-09-18-mobile-electron-hermes` (`07e14ace`) → draft PR against that base (link in the run log). Previous focus PR #1587 (mobile transcript streaming) is merged into the base.

## In progress

- Manual smoke: pick System One in Router model settings (Electron + mobile), Test connection, then an Auto session in **Shadow** and check `GET /agent-decisions`.
- Recommended rollout: `first_prompt` scope, Shadow for a week, then On. Details: `docs/ai/decision-engine-setup.md` → "Kev (recommended for model routing)".

## Risks / known issues

- **Kev cold latency**: ~80–250 ms warm, 2.8–4.2 s for the first calls after other heavy work on the Mac. Under the 1000 ms default those first prompts time out and keep the baseline route (safe, logged as `timeout`). Watch the timeout rate during the shadow week.
- Live test enters at `routeTurnForSession`; the full ws_gateway/engine Auto-session path was not smoke-tested by the agent.
- Carried from the base: `issue-1387` mobile tests base-red (offline-mirror hydration); #1586 silent session stalls still open.

## Test status

api_server tsc clean, full vitest 7062 passed / 0 failed; live Kev test passes (`RHYTHM_LIVE_E2E=1`); web tsc + router Playwright 16/16 (`RHYTHM_ROUTER_AUTO_CONTRACT=1`); mobile tsc, jest settings 50/50, eslint clean.

## Next step

AJ smoke-tests the draft PR with Kev running (`uv run --extra serve python -m kev.serve --run jaredpalmer/kev-4b --port 8009`), then merges into the mega branch.
