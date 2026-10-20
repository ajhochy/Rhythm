# Current plan

Active: [month-wide AI feature inventory and coverage](plans/2026-10-20-ai-feature-test-inventory.md), based on 489 commits and primary issue/PR evidence from September 20–October 20. The [whole-app inventory](plans/2026-10-19-feature-test-inventory.md) remains broader context.

Local branch `test/feature-playwright-2026-10-19` tests the unchanged locally built d7fb554735 mega/calibration candidate. [Full run and triage](runs/2026-10-20-ai-feature-playwright.md): 46 passed / 109 failed at the first 155-case snapshot; 80 were coverage markers. Current inventory has 77 active/partial groups and five historical boundaries after G2 source review. Corrected Bot Crossing tests reproduce real revoked inventory channels. Qualification is failed, with separate findings/prerequisites/test-authoring evidence.

Next: repair/requalify session empty-project requests and Bot Crossing service lifetime, restore reviewed native Dayflow inputs/resolve app version compatibility, and provision supported disposable app state for primary/Coordinator/approval and remaining privacy/execution boundaries. Fill narrower safe test gaps separately; do not label all remaining claims as device/provider blocked.

[Grid/Luna calibration](contracts/2026-10-19-router-calibration.json) retains its scoped 17/17 real packaged receipt in the full run. This does not qualify the rest of the app or every account failover scenario. Existing integration target remains mega / PR #1598. No push, PR, merge, release or installation is authorized in this task.
