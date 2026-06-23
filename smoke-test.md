# Smoke Test

Scope: PR #649 (`workflow/run-2026-05-27`) for issues #648, #638, #635, and #630.
Date: 2026-05-27

## Findings

- Launched the branch build from `/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter/build/macos/Build/Products/Debug/Rhythm.app` after confirming the process path with `ps`; avoided the installed `/Applications/Rhythm.app` process that initially attached through the same bundle ID.
- Local smoke guard was enabled with `RHYTHM_LOCAL_SMOKE=1` via `launchctl setenv` and the Flutter build used `--dart-define=RHYTHM_LOCAL_SMOKE=1`.
- The local agent server on `localhost:4001` was healthy and reported all four capabilities as true: `claude-code`, `codex`, `gemini-cli`, and `opencode`.
- #648 passed manually: a new Gemini CLI session used `openrouter/google/gemini-3-flash-preview`, reached `Idle`, and did not show `ProviderModelNotFoundError`.
- #638 passed manually using a live Gemini session: with chat output present, the full transcript pane showed `Error: Rhythm API error 401: [object Object]`, proving WS/system error frames are visible in the hasChat=true path.
- #635 passed manually: the expanded mini-bubble showed `bubble smoke check` immediately after Send, before the assistant response arrived; the assistant response appeared below afterward.
- #630 passed manually: the Claude Code session rendered the AskUserQuestion card with `Quick` and `Thorough` option buttons. Clicking `Quick` submitted the answer back into the transcript as a user message.
- Contract tests passed for all four issues, and all four live smoke checks are green.

## Checks

| Area | Check | How to run | Result | Reasoning |
| --- | --- | --- | --- | --- |
| Setup | Use requested branch and PR head | `git status --short --branch`; `gh pr view 649 --repo ajhochy/Rhythm --json headRefName,baseRefName,mergeStateStatus,statusCheckRollup` | Success | Checkout was `workflow/run-2026-05-27` at `origin/workflow/run-2026-05-27`; PR #649 head matched and CI checks were green. |
| Setup | Launch app from branch build, not installed app | `flutter build macos --debug --dart-define=RHYTHM_LOCAL_SMOKE=1`; `open -na apps/desktop_flutter/build/macos/Build/Products/Debug/Rhythm.app`; `ps -p <pid> -o args=` | Success | Running process path was `/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter/build/macos/Build/Products/Debug/Rhythm.app/Contents/MacOS/Rhythm`. |
| Backend | Local agent server is healthy | `curl http://localhost:4001/health`; `curl http://localhost:4001/agents/capabilities` | Success | Health returned ok; capabilities returned true for claude-code, codex, gemini-cli, and opencode. |
| Frontend/API #648 | Start Gemini CLI with simple prompt and no invalid model error | Agents -> New -> pick Gemini/OpenRouter `google/gemini-3-flash-preview` -> send `hello`; inspect UI and `GET /agent-sessions` | Success | Session row became `agentKind=gemini-cli`, `providerId=openrouter`, `modelId=google/gemini-3-flash-preview`, status `idle`; transcript did not show `ProviderModelNotFoundError`. |
| Frontend #638 | WS error frame appears in full transcript when chat messages exist | Observe Gemini transcript after live run generated chat output plus dashboard tool error | Success | Full pane showed `Error: Rhythm API error 401: [object Object]` below SDK chat/tool output, not only in the mini-bubble. |
| Frontend #635 | Expanded mini-bubble shows user message immediately and assistant later | Expand floating session bubble, send `bubble smoke check`, observe bubble | Success | The user message appeared immediately as a purple message in the expanded bubble; later assistant output appeared below it. |
| Frontend #630 | AskUserQuestion card renders option buttons and submits an answer | New Claude Code session; send prompt asking for an AskUserQuestion with `quick` and `thorough` options; click `Quick` | Success | The card rendered `Response depth`, `How would you like me to approach this?`, and `Quick`/`Thorough` buttons. Clicking `Quick` inserted a `Quick` user message in the transcript. |
| Automated support | Contract tests for #630/#635/#638 pass | `cd apps/desktop_flutter && flutter test test/features/agents/issue_630_contract_test.dart test/features/agents/issue_635_contract_test.dart test/features/agents/issue_638_contract_test.dart` | Success | 8 Flutter tests passed, including AskUserQuestion dispatch and Map option label parsing contracts. |
| Automated support | Contract tests for #648 pass | `cd apps/api_server && /usr/local/bin/npm test -- --run src/__tests__/issue_648_contract.test.ts` | Success | 3 Vitest tests passed, confirming `google/gemini-3-flash` is absent and preview fallback remains. |

## Known Gaps

- Initial observation stopped too early while the question card was still hydrating. A later screenshot and live app state showed the card fully rendered; the `Quick` option was clicked and submitted successfully.
- Follow-up issue https://github.com/ajhochy/Rhythm/issues/650 was filed from the premature failure read and then closed after the live smoke passed.
