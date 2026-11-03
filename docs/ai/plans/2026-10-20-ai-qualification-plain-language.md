# AI testing progress in plain language

The current locally built app is b7d5. Its router selection passed19 checks, including main-chat Auto and small-edit calibration. Hermes' new checked test passed a real Luna conversation through normal settings and verified its saved history and one model call. The one-time scheduler check and10 focused reload/search checks also passed. These are separate results, not a whole-app pass.

The broad60-case run still records54 passes and6 failures. Three failures came from tests observing the wrong browser document or navigating back before the prior screen had actually changed; their focused rerun passed. The remaining three involved tool-server startup reading before setup finished, including an error logged during the Hermes setup test. The candidate now waits for setup before reading; five targeted browser checks pass, but the rebuilt packaged app still needs to confirm it.

The two-job Coordinator check actually completed both jobs, made their separate commits, verified overlapping work and received both reports. Its overall test still failed because background skill extraction tried an unavailable Claude model. The repair uses the same live permitted-model list as normal routing, keeps explicit model choices, and refuses to invent an unauthenticated route.

Automatic naming succeeded in a fresh diagnostic after an earlier failure left the placeholder name unchanged. That success does not explain or erase the earlier failure. We also found that the old managed title-model selection checked provider login without checking that the model existed; the candidate checks live eligibility and refreshes managed settings after the engine is ready.

Local account-fallback checks now cover a healthy second Claude account, unusable accounts and explicit account pins. All15 bundled-plugin/local-server checks pass; this does not claim a paid call through the user's real Claude accounts.

Next is a fresh local build and signature check, an expanded86-case packaged run, real-model reruns and the isolated backend live gate. Catalog18 and conversation4 have older-build results; the expanded run restores the catalog coverage and includes navigation3 and tasks5. There is no all-feature green result:78 active coverage markers remain across83 inventoried groups, including recording/privacy, recurring schedule recovery, elapsed retention/approval jobs, reconnect/relay and device-specific behavior.

Only the original checkout and one active test worktree remain. Nothing has been pushed, merged, installed or released. See the dated run record for exact commands, revisions and reports.
