---
date: 2026-09-29
repo: Rhythm
branch: feat/router-systemone-backend
pr: pending
issues: []
status: in-progress
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Router: System One (Kev / Jev) backend

## Files

- `apps/api_server/src/services/decision/systemone_client.ts` (new) + `systemone_client.test.ts` (new)
- `decision_settings.ts`, `decision_client.ts`, `decision_config_service.ts`, `model_router.ts`, `config/env.ts`
- Tests: `model_router.test.ts`, `decision_backends.test.ts`, `__tests__/mobile_routing_scope.test.ts`
  (routing view now carries `minConfidence` / `lowConfidenceTier`)
- UI: `apps/web/src/components/tools/RouterSettingsPanel.tsx`, `apps/web/src/gateway/sessions.ts`,
  `apps/mobile/components/settings/router-model-section.tsx`, `apps/mobile/providers/services/rhythm-tools-service.ts`
- UI tests: `apps/web/tests/contract/router-auto-model.spec.ts` (router:B5), `apps/mobile/tests/settings/router-model-section.test.tsx`
- Docs: `docs/ai/decision-engine-setup.md` (Kev section), `apps/api_server/scripts/router_calibrate.mjs`

## Checks

- api_server `tsc --noEmit` clean; full vitest 746 files / 7062 passed, 0 failed
- decision + routing suites 21 files / 237 passed; mutation (fallback disabled) fails 2 router tests
- Live: `RHYTHM_LIVE_E2E=1 npx vitest run src/contract/router_systemone_live.test.ts` against running Kev :8009 —
  `/config/test` → cheap (0.757) 219 ms; Auto first prompt (offline-merge design) → frontier 0.5598, shadow, logged with 3 probabilities, 219 ms
- web `tsc -b` clean; router Playwright 16/16 (`RHYTHM_ROUTER_AUTO_CONTRACT=1`, spec self-skips without it)
- mobile `tsc` clean, jest settings 5 suites / 50, eslint clean
- Screenshots (Playwright, `RHYTHM_CAPTURE_EVIDENCE`): System One fields + tier result render

## Notes

- Kev latency: ~80–250 ms warm, but 2.8–4.2 s on the first calls after other heavy work (a vitest run reproduces it).
  With the 1000 ms default such a first prompt times out and keeps the baseline route (safe, but no routing).
  The live test warms Kev first. Worth watching in the shadow week before raising the timeout.
- `mobile_routing_scope.test.ts` routing-shape assertions extended with the two new fields (nothing removed).
- Agent `npm ci` / node_modules symlinks were classifier-denied; AJ ran `npm ci` (root, web, mobile).
- GitNexus flagged `normaliseDecisionSettings` / `buildRerankClientFromSettings` HIGH; changes are additive and gated on `backend === 'systemone'`.
- Not run: full engine/ws Auto-session smoke (live test enters at `routeTurnForSession`); mobile simulator screenshot; Electron-packaged target.
