---
date: 2026-08-14
repo: Rhythm
branch: issue/approval-card-delivery
pr: https://github.com/ajhochy/Rhythm/pull/1393
issues: [1392]
status: blocked-on-auth
tags: [handoff, Rhythm]
---

# Handoff: PR #1393 manual smoke blocked on desktop auth

## Context

Draft PR #1393 (branch `issue/approval-card-delivery`, isolated worktree at
`/Users/ajhochhalter/Documents/Rhythm-approval-card-fix`) fixes issue #1392: pending
`rhythm_request_approval` cards never appeared anywhere in the Rhythm desktop UI. Root cause was
confirmed and fixed:

1. `app_shell.dart`'s notification-bell badge (`unreadCount`) only summed `NotificationsController`,
   never `AgentApprovalsController.pending.length` — zero passive signal a security approval was
   blocked, even though `NotificationPanel` rendered the card correctly once opened.
2. `AgentApprovalsController._poll()` swallowed every fetch error silently (`catch (_) {}`) — now
   logs via `debugPrint`.

All automated evidence is in: `flutter test` 1209/1209, `flutter analyze`/`dart format` clean,
`ai-workflow checks --level issue` green, live sandbox run of the real `/agent-approvals` API
(7/7 vitest), GitHub Desktop CI green. Full trace in
`docs/ai/runs/2026-08-14-issue-1392-approval-card-delivery.md`.

## What's blocking manual smoke right now

Manual click-through smoke (launch the app, trigger a real approval, watch the badge light up) is
**not yet done** and is currently blocked on desktop auth, not on the code fix:

1. A debug build was launched from this worktree via `flutter run -d macos` against the **live
   production API** (not sandboxed) to do a real click-through smoke test.
2. The live poll logs (now visible thanks to fix #2 above — previously silent) showed every
   `GET /agent-approvals?status=pending` failing with `401 { authUserId: null }`. This is the stale-
   cloud-token deadlock already tracked separately in **issue #1382** — unrelated to this PR's fix,
   but it blocks proving the fix live because the approvals list never successfully loads at all.
3. Attempting to fix it by logging out and back in surfaced two more problems:
   - **Likely side effect**: `AuthSessionService` in this app reuses the *same Keychain-persisted
     session token* as the user's regular installed production Rhythm.app (there's a code comment
     confirming it "pulls the persisted token straight from the same Keychain entry"). Logging out
     called `POST /auth/logout` against the real production API with that real token, which likely
     revoked the session server-side — i.e. **this probably also signed the user out of their normal
     production Rhythm app**, not just the debug build. This was NOT confirmed by the user before this
     handoff was written — **first action for whoever picks this up: ask the user whether their normal
     production Rhythm.app is also showing signed-out, and if so help them sign back in there.**
   - **Local dev can't complete Google sign-in at all**: the sign-in screen shows
     `Bad state: GOOGLE_DESKTOP_CLIENT_ID is not set; cannot start Google sign-in.` This value is a
     Dart compile-time constant (`String.fromEnvironment` in
     `apps/desktop_flutter/lib/app/core/auth/desktop_google_oauth_client.dart:21`) that only exists as
     a GitHub Actions secret (`secrets.GOOGLE_DESKTOP_CLIENT_ID`), injected via `--dart-define` in
     `.github/workflows/desktop_ci.yml` / `desktop_release.yml`. **There is no local secrets file for
     it anywhere in this repo** (confirmed by search). A plain local `flutter run` cannot complete
     Google OAuth without this value.

## What's still running

A debug build is currently running: `apps/desktop_flutter/build/macos/Build/Products/Debug/Rhythm.app`
(PID may have changed since — check `ps aux | grep Rhythm.app`), launched with:

```bash
cd /Users/ajhochhalter/Documents/Rhythm-approval-card-fix/apps/desktop_flutter
RHYTHM_OPENCODE_BIN_DIR=/Users/ajhochhalter/Documents/Rhythm/apps/opencode_fork/packages/opencode/dist/opencode-darwin-arm64/bin \
flutter run -d macos
```

The `RHYTHM_OPENCODE_BIN_DIR` override is required in this environment — without it the app resolves
the stock globally-installed `opencode` CLI from PATH (a different, older build that doesn't
understand this repo's `~/.config/opencode/opencode.json` `reference.vault` key and crashes with
`Server exited with code 1`). With the override, the local agent server (`:4001`) and engine both
start cleanly. This part is fully working and not part of the auth blocker.

## Next steps (in order)

1. **Ask the user**: is your normal production Rhythm.app still signed in? If not, sign back in there
   first — it has the real client ID baked in at release build time, so Google sign-in will work.
2. Restart the debug build (`Cmd+Q` it fully first, per the stale-spawned-subprocess warning — hot
   reload does not restart the spawned local api_server child) and see if it picks up the
   freshly-restored Keychain token automatically.
3. If it still shows the sign-in screen, ask the user for the actual `GOOGLE_DESKTOP_CLIENT_ID` value
   (Google Cloud Console → APIs & Services → Credentials → the "Desktop app" OAuth client; see
   `docs/plans/google-oauth-desktop-setup.md`) and relaunch with:
   ```bash
   flutter run -d macos --dart-define=GOOGLE_DESKTOP_CLIENT_ID="<value>" --dart-define=RHYTHM_OPENCODE_BIN_DIR=...
   ```
   (Note: `RHYTHM_OPENCODE_BIN_DIR` is read via `Platform.environment`, not `String.fromEnvironment` —
   keep passing it as a real shell env var, not `--dart-define`, alongside the Google client id
   `--dart-define`.)
4. Once signed in and `GET /agent-approvals?status=pending` returns 200 (check the running app's
   stdout/log for the `[api_server]` line, or `curl http://127.0.0.1:4001/agent-approvals?status=pending`
   with the app's real bearer), have the user (or an agent session) call `rhythm_request_approval`
   with a `security_action` and confirm the bell badge count increments within ~30s, the card is
   visible in the notification panel, and Approve/Reject both resolve it.
5. Record the smoke result (PASS/FAIL) in `docs/ai/runs/2026-08-14-issue-1392-approval-card-delivery.md`
   and hand PR #1393 to the user for merge. Do not merge it yourself.

## Do NOT

- Do not merge PR #1393.
- Do not attempt to fix issue #1382 (stale-cloud-token 401 deadlock) as part of this — it's a separate,
  already-tracked issue. Only unblock enough auth to smoke-test #1392.
- Do not guess or fabricate a `GOOGLE_DESKTOP_CLIENT_ID` value — it must come from the user or a
  legitimate secrets source.
