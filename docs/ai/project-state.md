# Project State

## Current focus

2026-07-30/31: live human smoke (desktop + physical iPhone) of the combined
R1–R6/P0/MSP-001–007 runtime-and-mobile-parity effort, plus the T1
mobile↔desktop data-parity gate. Smoke surfaced 8 real bugs through actual
device use; 15 verified PRs merged to `main` overnight. Dev environment
(desktop app + its local api_server) is currently down after a machine crash
mid-session — Metro (mobile code server) survived.

## Merged to main tonight

#1272 (cloud-bearer auth — the fix that unblocked all desktop smoke),
#1254 (tokenless desktop session owner inheritance), #1255 (R2 idle-status
fix), #1256 (R6 plugin/telemetry dedupe), #1257 (R4 progress-aware deadline),
#1258 (R1 delegated-session isolation), #1260 (R3 scheduled-failure
classification), #1261 (P0 memory-relevance gate), #1262 (MSP-006
project-scoped Tools), #1263 (MSP-001 session/profile contract), #1264
(MSP-004 atomic session opening), #1265 (MSP-003 shared pending
permission/question state), #1267 (R5 agent-picker DTO + pagination), #1275
(Phase 0 local-agent-surface hardening), #1276 (T1 parity gate +
research-tab owner-visibility fix, issue #1274).

## Left open on purpose

- **#1259** (MSP-005 native composer) — CI green, but a live physical-iPhone
  test found the box still doesn't grow (issue #1280). Do not merge on CI
  alone; needs a real re-test after #1280 is fixed.
- **#1266** (MSP-002 three-dot config) — red `foundation` CI check, not yet
  diagnosed.
- **#1268** — the combined R1–R6+P0 smoke-vehicle branch. Never a merge
  target itself; the individual lane PRs above are what merged. Safe to
  leave open or close.

## Bugs found live tonight (all filed, prompts prepared per below)

- **#1274** — Research tab empty on mobile (owner exact-match). **Fixed**,
  merged in #1276.
- **#1277** — residual T1 parity drifts: webhook self-URL host mismatch, MCP
  served from two different sources, provider/auth redaction pairing gap.
  Prompt ready, not yet dispatched.
- **#1278** — server's own boot sequence triggers a self-inflicted
  credential-reload engine bounce, producing misleading ERROR-level log
  noise. Cosmetic. Prompt ready, not dispatched.
- **#1279** — mobile could only ever see phone-created chats; desktop
  sessions were never claimed. **Root fix merged** (owner+project fallback
  in `mobile_opencode_security.ts` / `mobile_opencode_ownership_repository.ts`,
  verified against the #1175 two-account isolation test). **Follow-up gap
  found and prompted, not yet built**: every real historical session, and
  even brand-new sessions started from "All Sessions" today, have a NULL
  `project_id` — confirmed live, not stale data. The merged fix's fallback
  requires project match, so it doesn't help these. Decision recorded:
  [decisions/2026-07-30-mobile-session-visibility-null-project-fallback.md](decisions/2026-07-30-mobile-session-visibility-null-project-fallback.md).
- **#1280** — MSP-005 composer regression, confirmed on a real iPhone, not
  caught by Jest. Prompt ready (combined with #1281), not dispatched.
- **#1281** — Mobile Memories tool empty despite admin role and no
  server-side error; root cause not yet confirmed. Prompt ready, not
  dispatched.
- **#1282** — mobile session creation bypasses skill/MCP scoping entirely
  (10x token cost vs desktop for the same profile) — root cause confirmed
  (`mobile_opencode_proxy.ts`'s `session.create` never calls
  `OpencodeClientService.createSession`). Prompt ready, not dispatched.
- **#1283** — desktop-started sessions don't stream live to mobile; manual
  refresh works fine, so it's the push path, not visibility. Prompt ready,
  not dispatched.

## Test status

Every merged PR passed its own contract suite plus a live human smoke pass
(desktop: 6/6, evidence in `.agent-stack/evidence/desktop-smoke-2026-07-30/`;
mobile: 3 pass / 1 fail / 2 bugs found and one fixed live). The T1 parity
gate sits at 11/14 feeds matching (`.agent-stack/evidence/t1-parity-gate/`).

## Risks

- Dev api_server + desktop app are down (crash). Relaunch with
  `RHYTHM_OPENCODE_BIN_DIR` pointed at a built fork before resuming any
  desktop-facing smoke — see
  [runs/2026-07-30-live-smoke-and-merge-night.md](runs/2026-07-30-live-smoke-and-merge-night.md)
  for the exact command.
- #1266 and #1259 must not be merged on green CI alone; both have known,
  live-confirmed gaps CI didn't catch.

## Next step

Dispatch the five prepared Codex prompts (#1277, #1278, #1279 follow-up,
#1280+#1281, #1282, #1283) — each is self-contained in the run log below.
Once #1280 lands, redo the physical-iPhone composer walk before touching
#1259. Diagnose #1266's red check before merging it.
