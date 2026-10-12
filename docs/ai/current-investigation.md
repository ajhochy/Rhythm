# Investigation — chat-only bounded Coding Workflow

Date: 2026-10-06. Targeted read-only pass on baseline be1af7df90e499ad8ec0de3ec62cc619543407d2. Integration checkout, API, fork, and normal app were untouched.

- apps/mcp_server/src/tools/coordinatorConversation.ts has signed rhythm_get_coordinator_status and rhythm_start_coordinator_goal. The latter starts one ordinary async Coding Workflow child, not finite prepareWorkflowPlan.
- CoordinatorConversationModelStatusService verifies exact signed envelope and active native call. CoordinatorForegroundMcpAuthority binds the call to the current C2 foreground/root or narrow approved goal resume. Child callbacks are status-only.
- CoordinatorConversationService.preparePlan routes purpose workflow to prepareWorkflowPlan. Existing admission includes explicit soft total-token authorization, outer turns, wall limit, expiry, workflow coverage acknowledgement, and selected_reference_summary_v1 source ID/version. Server re-resolves the indexed memory-vault source, checks plan/non-bypass and current profile, persists finite authority, then dispatches through G2. Existing web CoordinatorConversationCard gathers these via a form.
- AgentApprovalsRepository has decision nonce, security action, payload digest, expiry, one-use consume, and queued continuation. Human PATCH requires separate capability plus signature. Existing taint approval helper returns no binding for clean/bypass sessions, so it cannot prove finite consent. Goal approval resume is limited to delegation.start-async/{goalId}/current taint.
- At the original baseline, live_coding_workflow_bounded.test.ts and tools/dev/live-coding-workflow-s8* proved direct-admission G2 with actual API/fork/MCP and synthetic external model; the new chat approval entry had not yet been tested.

Baseline conclusion: add a dedicated signed foreground proposal/start and always-human exact-payload approval card, reusing the existing G2 checked path and durable approval state. The C9 implementation and formal live result below close the previously open discovery, restart, and same-chat approval questions.


## C9 resolution and current status (2026-10-06)

Exact source `54888e924c5b31cb7700b6eb1f5da7c4c450e930` / apps tree `47f1828030f1b14c2175975e47e72a5796b0cb47` passed the full issue/PR gates and both browser suites. Formal actual API/fork/MCP qualification passed idle and stock restart: 111 tools, 19/20 qualification checks and 5 operational checks per case, exact criteria, ordinals 1/2, 65-second stop. External model and ranking were synthetic; provider semantics and real human-native P256 fixture remain unproven.

The C8 normal-profile signed app's blank Dayflow view was caused by global CSS overriding an equal-specificity one-row selector under production import order. C9 raises only the selector specificity; production-order tests and signed-app CUA now pass. The C9 CUA run at 1280×800, 1280×560 and actual 3440×1296 exercised native macOS scrolling, restored the Timeline top state, and retained original controls without outer Rhythm header/footer. Approximate screenshot geometry is explicitly not direct `NSRect` measurement. The exact receipt is `dayflow-C9-signed-native-CUA-receipt.json`.

Native AppKit C1–C3, compile-only wrapper, package/sign/stable-copy/verifier/signed-smoke/origin checks passed. Immutable source/payload inputs were 749/280 files. The signed app is not notarized. TestFlight 1.0.9 build 21 is valid/internal; C9 makes no mobile product change and physical phone proof remains unrun. Final-doc CI and owned worktree cleanup remain pending.
