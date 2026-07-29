# Issue #1170 inferred blast radius

GitNexus was explicitly waived by the orchestrator. This static replacement
uses import/caller searches only; no symbol index or test command was run.

## Production entry points

- `MobileSseProxy` is instantiated only by
  `apps/api_server/src/routes/mobile_gateway_routes.ts`, which exposes
  `/mobile-gateway/events` and `/mobile-gateway/sessions/:id/events`.
- `MobilePtyProxy` is instantiated only by `apps/api_server/src/server.ts`,
  which delegates the dedicated mobile gateway server's HTTP upgrade events
  to `handleUpgrade`.
- `attachWsGateway` also receives the `MobilePtyProxy` instance so the
  authenticated mobile PTY route is recognized before legacy WebSocket
  routing.

## Test/import consumers

- `apps/api_server/src/__tests__/issue_1170_mobile_realtime_proxy.test.ts`
- `apps/api_server/src/__tests__/issue_1170_mobile_realtime_proxy_live.test.ts`
- `apps/api_server/src/__tests__/issue_1175_mobile_gateway_security.test.ts`
- `apps/api_server/src/contract/issue_1175_corrective_security.test.ts`
- `apps/api_server/src/contract/issue_1175_security_review.test.ts`

## Inferred risk

Low. This gap-fill changes tests and proof artifacts only. No production
symbol, route, schema, or runtime configuration is modified. The added live
assertions exercise existing single-use OpenCode tickets and the existing
one-second PTY device revalidation timer. The main residual risk is test
environment behavior because execution is reserved for the orchestrator.

