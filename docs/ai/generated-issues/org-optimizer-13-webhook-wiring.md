# org-optimizer-13: Webhook-wiring generator (gated, fenced)

## Goal

Detect recurring inbound-trigger patterns (a kind of email / API payload / manual
paste that repeatedly kicks off the same agent or task) and propose
`webhook-wiring` (HIGH, gated): wiring an inbound webhook → agent/recipe to
automate that trigger. On approval, flow through the existing HMAC/SSRF
webhook-endpoint creation path; fence inbound payloads (#737) before they reach a
prompt.

## Context

Per decision doc §7. Substrate to reuse (do NOT build new):
`agent_webhook_endpoints` table (`event_types_json`, `secret` (HMAC-SHA256),
`target_scheduled_task_id`, `target_prompt`, `enabled`, `trigger_count`),
`webhookValidationService.ts` (HMAC + SSRF-safe validation),
`agentWebhookController.ts`, and the Flutter Agents → Webhooks UI
(`apps/desktop_flutter/lib/features/agent_webhooks/`). Creating an endpoint that
runs an agent on external input is an injection surface → HIGH, gated, fenced.

## Likely files

- NEW `apps/api_server/src/services/generators/webhook_wiring_generator.ts`
- reuse `agent_webhook_endpoints_repository.ts`, `webhookValidationService.ts`,
  `agentWebhookController.ts`
- proposals repo

## Acceptance Criteria

- [ ] A recurring inbound-trigger gap (repeated payload kicking off the same
  agent/task, with no `agent_webhook_endpoints` row wiring it) → one
  `webhook-wiring` proposal (HIGH).
- [ ] The proposal's note specifies: the trigger source/event, the target
  agent/recipe + its scope, the HMAC secret setup, and SSRF/allowlist constraints
  (stored in `change_json` + the security note); the queue blocks approval without
  the note (`requiresSecurityNote`).
- [ ] Never auto-applied (not reachable from the auto path).
- [ ] On approval, the endpoint is created via the existing webhook-create path so
  HMAC-SHA256 verification + SSRF-safe validation are enforced — not bypassed.
- [ ] The generated wiring routes inbound payloads through the same fencing the
  inbound drain uses (#737); raw external text is never inlined unbounded into the
  agent prompt. Assert the fencing is applied.

## Required tests

- generator contract: recurring inbound pattern → high-risk webhook-wiring
  proposal carrying the full security note; never auto-applied; approve → routes
  through the HMAC/SSRF create path (mocked) and is rejected if validation fails;
  inbound payload is fenced before reaching the prompt.

## Dependencies / order

Depends on 03 (gaps), 04, 10 (queue apply), 11 (UI). Seeded behavior covered by 14.

## Safety notes

HIGH risk, gated, fenced. Inbound webhooks that run agents are an injection
surface — payload fencing (#737) and HMAC/SSRF validation are mandatory and must
not be bypassed by the apply path.
