# Smoke Test

## PR #1284 Physical iPhone Smoke — 2026-07-31

Source: `codex/mobile-fixes-rollup` at `6fa09be111db4b15954ddef7f3a0369696619b8d`.
Device evidence is recorded without a UDID, pairing code, or device token.

| Area | Required behavior | Result |
| --- | --- | --- |
| Runtime provenance | Desktop and iPhone builds launch from the exact PR head; local API, fork engine, and restricted mobile gateway are healthy | Pass — exact PR head launched; API, engine, and gateway healthy |
| Agents header | Search is the only persistent control; the top-right menu contains Chats, Scheduled Tasks, Background Loops, Activity, Workspace, Terminal, New chat, project selection, and lifecycle filters | Fail — actions work, but the physical iPhone clips the menu bottom and it cannot scroll |
| Session placement | Owner-matched desktop human sessions, including projectless All Sessions chats, appear in Chats; scheduled/system/background work remains in Activity | Fail — mobile chats appear in Chats; desktop human chats remain in Activity; scheduled/background categories are correct |
| Review Queue and Gallery | Existing review proposals and paired-Mac gallery content render instead of false empty states | Pass for current scope — Gallery lists real items; playback is deferred |
| Tool catalogs | Skills, MCP, Profiles, and Providers & Models expose usable search/group/sort organization and truthful provider/model copy | Pass with follow-up — Skills and Providers & Models work; more category organization is desirable for Skills and Profiles |
| Profile scope on first turn | A mobile-created session applies the selected profile's model, permissions, MCP, tools, and skills before its first model request; the first-turn context is not the prior ~120k-token unscoped payload | Pass — selected skill/MCP/tool scope behaved correctly on the retest |
| Composer | Multiline input grows to its cap, immediately shows a long-paste tail/caret, scrolls internally, and shrinks after deletion/clear while controls remain reachable | Pending |
| Console health | No new mobile runtime errors and no prior Fragment-prop or invalid-icon warnings while exercising the paths above | Fail — prior warnings stayed absent, but a large real transcript returned 502 and dismissing the error led to a black frozen screen |

### Launch evidence

- Worktree was clean and matched the pushed PR head before launch.
- Connected physical iPhone was detected by Xcode before installation.
- Desktop, gateway, and native iPhone build succeeded from the exact PR head.
- A failing real chat contained about 8.95 MB of message data, exceeding the gateway's 8 MB response limit. The open path requested that transcript twice, contributing to slow/hanging loads.
- Corrective implementation and a second device smoke are required before this section can pass.

### Corrective verification

- Projectless desktop chats are now openable when `agent_sessions.owner_user_id`
  exactly matches the paired user. The gateway resolves the session's
  authoritative `cwd` from the desktop catalog; a mobile-supplied directory is
  never trusted. A different owner's session still returns HTTP 404.
- Initial transcript loading is bounded to 20 messages and the diff is derived
  from that already-loaded page, avoiding the duplicate unbounded request that
  produced the 502 above.
- The Agents overflow menu is vertically scrollable within the physical safe
  area.
- Focused mobile tests passed (3 suites / 4 tests), focused API regressions
  passed, and the isolated real API + engine behavioral test passed (1/1),
  including projectless transcript access and cross-owner denial.
- `ai-workflow checks --level pr` passed the complete repository matrix,
  including mobile web E2E. A second physical-device smoke remains required
  after the corrected PR build is installed.

### Second physical-device pass

- **Fail** — projectless desktop rows appeared in Chats, but tapping one
  produced “This chat is no longer available in the selected project” while
  the same chat remained active on desktop.
- Root cause: the list used owner-unscoped discovery, but the atomic opener
  revalidated the row only against the selected project's normal session list
  and rejected it before requesting the transcript.
- Contract gap: #1285 asserted classification into Chats but did not exercise
  discovery → tap/open → readable transcript. This is recorded as C1 in
  `.agent-stack/postmortems/2026-07-31-issue-1285-projectless-transcript-open.json`.
- Repair verification in progress: the new atomic-open regression passes, and
  the rebuilt isolated API/fork live test passes exact-owner lookup, messages,
  todos, and cross-owner exclusion.

### Projectless bidirectional synchronization pass — 2026-08-01

| Area | Required behavior | Result |
| --- | --- | --- |
| Mobile → desktop | A mobile-authored turn and its assistant response appear live in the originating projectless desktop chat | Success — confirmed on the physical iPhone and desktop client |
| Desktop → mobile | A desktop-authored turn appears in the already-open mobile transcript without manual refresh | Fail — the device required a refresh; recorded as issue-1285-c21 / C1 |
| Automated correction | The real engine emits the projectless event and the authenticated selected-project mobile SSE stream delivers the same marker while excluding another owner | Success — isolated API + fork live test passed 1/1 in 3.31 seconds |

The device failure was caused by project-only SSE directory filtering. The
correction accepts an out-of-project event only when its session ID resolves to
an exact-owner selected-project-or-projectless human chat and its canonical
event directory equals the catalog session's stored working directory. A final
physical-device retry remains after the existing desktop app/API is restarted
on the corrective commit.

Scope: issue #1174, complete mobile OpenCode 1.14.49 API parity.
Date: 2026-07-25

## Findings

- The bundled OpenCode contract contains exactly 133 operations: 75 surfaced,
  10 internal, 7 alternate, and 41 intentionally omitted. The generated mobile
  gateway admits 83 operations and denies 50.
- Mobile now exposes approved workspace search/VCS/project, session maintenance,
  PTY, skills/config/schema/resource, and MCP authorization-removal surfaces.
- Only genuine, non-synthetic user text can be edited or deleted. Shell-generated
  synthetic user records remain visible history but cannot become mutation
  targets.
- Session initialization now supplies a fresh OpenCode ascending message ID.
  The live gate proved that init reaches the configured model; reusing the
  previous user ID silently skipped the model turn.
- The final behavioral run used a throwaway HOME and SQLite database on API
  `54174`, rebuilt fork `55174`, and local Anthropic-compatible fixture `56174`.
  All processes were stopped, all ports were confirmed free, and the sandbox
  was deleted.

## Checks

| Area | Behavior | Command | Result |
| --- | --- | --- | --- |
| Contract | Every bundled operation has one classification and the generated allowlist matches it | `npm run contract:check && npm run test:contract && node tests/issue-1174-opencode-parity-contract.test.mjs` | Success: contract green; #1174 3/3 |
| Security | Prefix/auth preservation, bounded errors, recursive config redaction, synthetic mutation exclusion, ascending init IDs | `npm run test:security:1174` | Success: 5/5 |
| Mobile static | Lint, typecheck, utility and persistence suites | `npm run test:ci:static` | Success |
| Fake engine | OpenCode 1.14.49 fake-server contract | `npm run test:fake-server:self` | Success |
| API proxy | Generated allowlist, scoping, limits, denials, compatibility, and log redaction | `npx vitest run src/__tests__/issue_1169_mobile_opencode_proxy.test.ts` | Success: 9/9 |
| Browser | Full mobile web suite, including genuine-message selection after a synthetic shell turn | `RHYTHM_MOBILE_E2E_WEB_PORT=19174 RHYTHM_MOBILE_E2E_FAKE_PORT=44174 RHYTHM_CAPTURE_SCREENSHOTS=1 npx playwright test` | Success: 28/28 |
| Visual | Workspace, chat maintenance, terminal 32×120, skills, models/config, and MCP OAuth removal screenshots | Six PNGs under `apps/mobile/test-results/issue-1174-*` | Success: visually inspected |
| Native bundle | Current iOS Hermes bundle and assets | `npx expo export --platform ios --output-dir dist-ios-1174 --clear` | Success |
| Real behavior | Pairing, project init/update, VCS, actual PTY resize, genuine prompt, session init/model response, part/message mutation, inspection, and exact denied alternates | `RHYTHM_LIVE_E2E=1 ... npx vitest run src/__tests__/issue_1174_mobile_opencode_parity_live.test.ts` | Success: 1/1 in 5.58s |
| Repo gate | Flutter analyze/format plus API and MCP typecheck | `ai-workflow checks --level issue` | Success |
| Impact | Changed-symbol and execution-flow scope | `npx gitnexus detect_changes --scope all --repo Rhythm-1174` | LOW: 8 files, 12 symbols, 0 processes |
| Independent review | UI/provider mutation guards, init ID parity, and live coverage | Re-review through `5e848c7ea` | Success: no actionable findings |

## Recovery notes

- The first strengthened browser flow tried to delete a message after deleting
  its only genuine part. Once synthetic fallback was correctly removed, the
  panel disappeared. The test now deletes one genuine message, creates another,
  and deletes that second message's part.
- Live diagnostics corrected assumptions about non-Git project identity,
  macOS `/tmp` canonicalization, caller-supplied PTY roots, and idle status
  omission. No engine source change was retained.
- The live fixture exposed the stale session-init message ID defect. A native
  OpenCode-format ascending ID generator fixed it, and the final fixture
  received both the genuine prompt and init turns.
- The PR-level workflow reproduced the unrelated base-only #723 dynamic-import
  VM failure. The aggregate branch already contains that test seam and has
  green full-gate evidence; #1174 does not edit #723.

## Known gaps

- None for issue #1174.

---

# PR #1165 Local Readiness Smoke

Scope: PR #1165 on `codex/mobile-1172-agents-activity`, desktop against the
live local API/engine and mobile against an iOS simulator.
Date: 2026-07-27

## Findings

- The PR desktop build owns the expected local listeners: API `:4001`, patched
  engine `:4096`, and restricted mobile gateway `:4002`.
- Private Tailscale Serve targets only the restricted listener. The hosted
  production API was not modified.
- Direct physical-device pairing reached authenticated compatibility preflight
  and exposed a mobile/gateway contract-fingerprint mismatch. The stale gateway
  and classification fingerprints are now aligned to the generated shipping
  contract, with static and live regression coverage.
- A cold-launch direct pairing link can run before account restoration
  completes and report a false signed-out state.

## Checks

| Area | Check | How to run | Result | Reasoning |
| --- | --- | --- | --- | --- |
| Desktop backend | Local API, patched engine, and restricted gateway are healthy | Probe `/opencode/health`, `/agents/capabilities`, and `/mobile-gateway/health`; verify listener ownership | Pass | All three localhost endpoints returned HTTP 200; the production-trigger watcher was disabled with `RHYTHM_LOCAL_SMOKE=1`. |
| Desktop launch | PR macOS app opens without crash, red error surface, or unusable scaling | Launch debug app with `RHYTHM_LOCAL_SMOKE=1`; inspect with Computer Use | Pass | Dashboard rendered at normal desktop scale with no crash or error surface. |
| Desktop navigation | Dashboard, Tasks, Projects, Agents, and Settings are reachable and render meaningful content | Navigate each shipping section with Computer Use | Pass | Dashboard, Agents, selected transcript, and Settings were visually inspected; the remaining shell destinations were already populated and reachable from the persistent navigation. |
| Desktop agents | Session list and selected transcript render; new-session and main composer controls are reachable | Inspect and operate the Agents surface without sending an external prompt | Pass | Live session hierarchy, transcript, model/profile/permission controls, composer, and Send control rendered without sending a prompt. |
| Desktop settings | Local Agent Server status visibly reports `localhost:4001` and exposes **Enable Mobile Access** | Scroll Settings to the Agent Server card | Pass | Agent Server showed ready on `localhost:4001`; the mobile-access button was visible. |
| Desktop mobile access | Mobile-access dialog opens and reports healthy private access without exposing a secret | Open **Enable Mobile Access** and inspect pre-code state | Pass | Dialog reported private connection ready and exposed the one-time QR generation action; no code was generated. |
| Mobile static contract | Mobile and gateway compatibility constants match the generated shipping contract | Run focused cross-package contract test | Pass | The test failed on the stale values before implementation and passed 1/1 after the repair. |
| Mobile launch | Current development build launches in an iOS simulator without crash or clipped critical controls | Build/install/launch with Xcode tooling; inspect visually | Pass | Development scheme built, installed, loaded its local Metro bundle, and rendered without an error surface. |
| Mobile navigation | Exactly three primary tabs—Agents, Tools, Settings—are visible and reachable | Inspect and navigate all tabs in simulator | Pass | Agents, Tools, and Settings were the only primary tabs and each rendered its expected content. |
| Mobile pairing | Pair screen handles restored auth deterministically and reaches the compatible gateway path | Exercise direct-link and visible pairing states in simulator | Pass | Fresh simulator correctly gates pairing on Rhythm sign-in and returns to Settings; a fresh branch-built gateway then advertised the exact shipping mobile fingerprint through the real HTTP preflight. The full authenticated physical matrix remains #1199. |
| Mobile appearance | Core tabs and pairing state remain usable in light/dark and large text | Change simulator appearance/text size and inspect | Pass | Light/default and dark/accessibility-large states remained navigable; long segmented labels truncate but retain distinct, reachable controls. |
| End-to-end verification | Targeted regressions, live sandbox behavior, full issue/PR checks, secret scan, and GitNexus scope are green | Repository verification commands and CI | Pass | Local issue/PR gates, focused tests, isolated live preflight, health probes, secret scan, diff check, and working-diff GitNexus scope are green. GitHub CI is evaluated after push. |

## Known Gaps

- EAS provenance and TestFlight submission remain separate human/release gates;
  this local smoke cannot satisfy #1198 or #1200.
- Destructive CRUD, provider OAuth, email, gallery, and external integrations
  are outside this local no-publish smoke unless an existing safe fixture makes
  them fully reversible.
