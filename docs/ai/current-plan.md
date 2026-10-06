# Current plan — C9 chat-bounded workflow and Dayflow viewport

Date: 2026-10-06. Exact candidate: `54888e924c5b31cb7700b6eb1f5da7c4c450e930`; apps tree `47f1828030f1b14c2175975e47e72a5796b0cb47`; branch `integration/2026-10-06-resume`; draft PR #1604.

## Intent and constraints

Secretary can propose a captured goal against a current indexed reference, request an exact signed human decision, and run the bounded two-manager workflow through actual API/fork/MCP. Preserve exact current-source checks, one-use approval, usage accounting, reviewer membership, checked status, and stop after ordinals 1 and 2. The model does not grant budget or provide provider-semantic proof. Dayflow removes Rhythm-authored outer header/footer, retains original native controls, and scrolls its native timeline within short windows.

## C9 implementation and qualification

The four-file C9 cascade commit changes one selector to `.tool-workspace.dayflow-workspace`, aligns the browser harness with production CSS import order, and records the diagnosis and postmortem. Native wrapper lifecycle/ABI were unchanged. Production-order browser RED reproduced missing positive geometry; the selector repair passed the unchanged 16 browser cases.

Exact C9 verification passed: issue 4/4 stages, PR 22/22 stages, chat browser 1/1, Dayflow/Sol browser 16/16. Formal live actual API/fork/MCP passed idle and stock-restart (2/2), with 111 registered MCP tools, 19/20 qualification checks and 5 operational checks per case, exact checked criteria and manager ordinals 1/2, and 65 seconds without a third job. Synthetic external model and ranking responses were used.

The normal-profile signed C9 app rendered the original Dayflow Timeline with no outer header/footer and retained native controls. At 1280×560, native macOS scrolling down two pages reached Copy timeline, Settings, and Review cards while global navigation stayed fixed; scrolling up two pages restored Today/Timeline/Daily. At tall target 3440×1300, actual CUA window was 3440×1296 due macOS zoom; content remained visible and native wheel did not move the outer document. Restored to 1280×800, Timeline top. Approximate screenshot measurements: short purple surface 402px, visible document extent 576px, movement 174px; public native API does not expose exact `NSRect`/intrinsic values. No physical-human proof is claimed. Two pre-existing pending approvals remained untouched; no approval, onboarding, TCC, capture, provider, or settings action was performed.

C9 package/sign/stable copy, strict verifier, signed smoke, actual launch, and origin checks passed. Stable manifest SHA-256: `6302833146ba3edff3ffc31ae88d9c7e91d03ab454eca54ddf65e47d096915e9`. Package is signed, not notarized. Native sources/payloads (749/280) remained immutable; compile-only addon and AppKit C1–C3 receipts match exact C9.

TestFlight 1.0.9 build 21 is valid and in internal beta. C9 has no mobile product changes; physical phone testing remains unrun.

## Historical regressions retained

C6 formal idle/restart passed with exact two checked criteria and no third ordinal; its full PR gate exposed API/MCP test failures, repaired in test-only expectations/registration/role graph. C8 formal idle/restart again passed 2/2, and its full issue/PR gates passed, but the actual signed normal-profile Dayflow UI was blank at 1280×800. Preserve the original C6 red log/recovery note and `runs/2026-10-06-issue-1605-c8-cascade-postmortem.json` unchanged. Exact C9 formal, full gates, and native CUA now qualify the candidate; production-order RED and C9 CSS GREEN remain documented in `runs/2026-10-06-dayflow-production-cascade.md`.

## Remaining work

Root finalizes and pushes docs D; CI on final D remains pending. Provider-semantic behavior, human-native P256 fixture proof, physical phone proof, and the full native 16-screen matrix remain separate NOT RUN gates. Root-owned worktree/dependency cleanup remains pending; human merge remains out of scope.
