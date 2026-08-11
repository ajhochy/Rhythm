---
date: 2026-08-10
repo: Rhythm
branch: feat/artifact-viewer
pr: 1338
issues: [SLICE-RT]
status: ready_for_verification
tags: [run, api_server, live-artifacts, csp]
---

# Runtime CSP parity

## Files

- `apps/api_server/src/controllers/live_artifacts_controller.ts`
- `apps/api_server/src/__tests__/live_artifacts.test.ts`
- `docs/ai/contracts/live-artifacts-runtime-csp-parity.json`
- `docs/ai/decisions/2026-08-10-artifact-runtime-claude-parity-csp.md`

## Acceptance contract

Initial failing command:

```sh
cd apps/api_server && npx vitest run src/__tests__/live_artifacts.test.ts
```

Observed: 26 tests, 2 failed. The fragment CSP still contained `nonce-…` instead of the required allowlist, and a standalone document was double-wrapped (two doctypes).

## Checks

```sh
cd apps/api_server && npx vitest run src/__tests__/live_artifacts.test.ts && node_modules/.bin/tsc --noEmit && npm run build
```

Observed: `1 passed`, `26 passed`; type check exited 0; build exited 0.

```sh
tools/dev/sandbox.sh down && tools/dev/sandbox.sh up && tools/dev/sandbox.sh status
```

Observed: rebuilt sandbox ready at `http://127.0.0.1:4098`, engine `:4097`; sandbox intentionally left UP.

Live command: a Node HTTP assertion against `http://127.0.0.1:4098` inserted a temporary sandbox user session/workspace, `POST`ed a full document containing a `fonts.googleapis.com` stylesheet plus inline `<style>` and `<script>`, then `GET /live-artifacts/:id/render` and asserted one doctype, both inline blocks unchanged, the fonts link, and the exact CSP header.

Observed output:

```json
{"create":201,"render":200,"id":"dd577a4d-6d7d-4d39-9c9f-a6f662aefbc0","doctypes":1,"inlineStyle":true,"inlineScript":true,"fontsLink":true,"csp":"sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; style-src 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; font-src https://fonts.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com data:; img-src data: blob: https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'"}
```

## Notes

GitNexus impact on `LiveArtifactsController.render` was attempted before editing. The stale index returned `Target '' not found`, risk `UNKNOWN` (prior dispatch recorded LOW/UNKNOWN). No high/critical result was returned. `detect_changes` is required before any commit; no commit was made in this run.
