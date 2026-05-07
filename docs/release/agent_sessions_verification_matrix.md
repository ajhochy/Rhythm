# Agent Sessions — Manual Verification Matrix

This checklist covers the five canonical scenarios for the dual-endpoint architecture
(the bundled **CLI server** — the local Node process on port 4001 that talks to
`claude`/`codex` — plus the hosted production API on Synology at api.vcrcapps.com).
The bundled CLI server is a separate artifact from the hosted production API and
must be verified inside the packaged `.app`, not from a dev checkout. Work through
every scenario on a real macOS machine before publishing each release.

**Before you start:**
- Use a test account or clean workspace — do NOT run scenario 5 against real users' data.
- Download the **signed DMG** from the GitHub Release draft (or the local artifact
  produced by `tools/release/sign_and_notarize_macos.sh`). Do not verify against
  `flutter run -d macos` — `flutter run` resolves `apps/api_server` from the source
  tree and will mask bundling regressions that only appear in the packaged `.app`.
- Install `Rhythm.app` to `/Applications/` on a **clean macOS account** — not the
  developer account that built the app. Gatekeeper attestation differs between the
  signing account and a fresh user, so a clean account is the only honest test.
- Launch `Rhythm.app` from `/Applications/` (Finder → Applications → Rhythm). Do
  not launch from the DMG mount or a build directory.
- If any scenario fails, file a follow-up issue with reproduction steps and link it here.

---

## Bundle existence pre-check

Before working through any scenario, confirm the CLI server actually shipped inside
the `.app`:

```bash
ls /Applications/Rhythm.app/Contents/Resources/api_server/dist/server.js
```

- [ ] The file exists and `ls` returns a path (not an error).

**If the file is missing: STOP.** Do not publish this release. The CI smoke test
should have caught this; the bundling workflow is broken. File a release-blocking
issue, link it to this run, and halt verification until the bundle is fixed and a
new DMG is produced.

---

## Scenario 1 — Happy path on production

**Setup:** User signed in to api.vcrcapps.com. Local agent server running on 4001. Both
`claude` and `codex` binaries are installed and on PATH. On first launch, Settings →
Agent Server should reach the green/running state within 5 seconds. If it's still
spinning after 10 seconds or shows red, capture the **Copy diagnostics** output
before retrying.

- [ ] App launches and production data loads normally (tasks, projects, rhythms visible).
- [ ] Settings → Agent Server row shows **green / running**.
- [ ] Settings shows `claude`: **installed**, `codex`: **installed**.
- [ ] Agents view is visible in the sidebar and accessible.
- [ ] "New Session" dialog lists both **Claude** and **Codex** as options.
- [ ] Creating a session with Claude spawns a real PTY (terminal output appears in the session panel).
- [ ] Bubble overlay appears for the active session.

**Expected behavior:** Full feature set available. Both CLIs detected. Sessions create and
stream output successfully. Bubble overlay is visible for active sessions.

---

## Scenario 2 — Port 4001 already in use

**Setup:** Before launching Rhythm, occupy port 4001:
```bash
nc -l 4001 &
```
Then launch Rhythm.

- [ ] Production data loads normally (tasks, projects, rhythms visible — confirms production endpoint is unaffected).
- [ ] Settings → Agent Server row shows **red / failed** with a message indicating the port is in use (e.g. "port in use", "address already in use", or similar).
- [ ] Bubble overlay is hidden / not visible.
- [ ] Agents view shows **"Agent server unavailable"** with a link or button to open Settings.
- [ ] Kill the `nc` process (`kill %1` or find the PID) and click **Retry** in Settings.
- [ ] After retry, Agent Server row transitions to **green / running** without restarting the app.
- [ ] Agents view becomes accessible after the server starts.

**Expected behavior:** Production features degrade gracefully when the local agent server
cannot start. A clear error is surfaced and recovery via Retry works without an app restart.

---

## Scenario 3 — Only Claude installed

**Setup:** Ensure `codex` is not on PATH (uninstall via `brew uninstall codex` or
temporarily rename the binary). `claude` must still be installed and on PATH.

- [ ] App launches; production data loads normally.
- [ ] Settings → Agent Server row shows **green / running**.
- [ ] Settings shows `claude`: **installed**, `codex`: **not installed**.
- [ ] "New Session" dialog shows **only Claude** as an option (Codex option absent or disabled).
- [ ] Creating a Claude session spawns a real PTY and streams output.
- [ ] Bubble overlay works correctly for active Claude sessions.

**Expected behavior:** App gracefully handles a single CLI. No crash or error banner for the
missing `codex` binary. Session creation and streaming still work for the available CLI.

---

## Scenario 4 — Neither CLI installed

**Setup:** Ensure both `claude` and `codex` are absent from PATH (uninstall or rename both
binaries).

- [ ] App launches; production data loads normally.
- [ ] Settings → Agent Server row shows **green / running** (server itself starts fine).
- [ ] Settings shows `claude`: **not installed**, `codex`: **not installed**.
- [ ] Settings displays a **warning banner** indicating no supported AI CLI is detected.
- [ ] Agents view shows the **"No supported AI CLI detected"** empty state (not a crash or blank screen).
- [ ] Bubble overlay is hidden / not visible (no sessions can be created).
- [ ] "New Session" button is disabled or absent, or shows an appropriate error if tapped.

**Expected behavior:** The app remains stable and fully functional for non-agent features.
A clear, actionable empty state guides the user to install a supported CLI.

---

## Scenario 5 — Trigger from production task

**Setup:** User signed in to api.vcrcapps.com with the local agent server running (scenario 1
conditions). Use a test account so no real user data is affected.

- [ ] Write a row directly to the production `pending_claude_triggers` table, either via SQL
  (`INSERT INTO pending_claude_triggers ...`) or by triggering a task action in the UI that
  creates a trigger entry.
- [ ] Within approximately **10 seconds**, the bubble overlay surfaces the trigger as a
  **"trigger.fired"** bubble without any manual refresh.
- [ ] The bubble contains the expected trigger payload / task reference.
- [ ] After the bubble appears, confirm the corresponding row is **deleted** from the
  `pending_claude_triggers` table in production (verify via SQL or API query).
- [ ] No duplicate bubbles appear for the same trigger.

**Expected behavior:** The polling/push mechanism detects new triggers promptly, surfaces
them in the overlay, and cleans up the source row to prevent redelivery.

---

## Sign-off

| Scenario | Result | Notes / Follow-up issues |
|----------|--------|--------------------------|
| 1 — Happy path | | |
| 2 — Port 4001 in use | | |
| 3 — Only Claude installed | | |
| 4 — Neither CLI installed | | |
| 5 — Trigger from production task | | |

Once all five rows are marked **Pass**, the PR is ready to merge.
