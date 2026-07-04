---
date: 2026-07-03
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# #856 (reopened, second attempt): change-gated Keychain poll replaces the `~/.claude/.credentials.json` file-watch

## Context

The first reopen fix for #856 (commit `15f36db38`) added a second
`AuthCredentialWatcher` on `~/.claude/.credentials.json`, reasoning that a
`claude` CLI re-auth writes fresh tokens to that file (and the Keychain), and
that watching it would let the api_server detect the change and force a
re-bridge into the live opencode engine.

Live manual smoke of an actual `claude` re-auth proved this diagnosis wrong:

- The current `claude` CLI stores credentials in the macOS **Keychain
  ONLY** (`security` item `"Claude Code-credentials"`). It does **not**
  persist `~/.claude/.credentials.json` — a `claude logout`/`login` deletes
  any stale copy of that file and never recreates it.
- The file-watcher therefore essentially never fires on a real re-auth. In
  smoke it fired exactly once, by luck, on the stale file's *deletion*
  during the logout step, and that single firing landed on a transient
  `keychain_denied` read (the split-second window of the logout→login
  transition) rather than a clean re-bridge.
- In steady state, the api_server can read the Keychain fine — a manual
  force re-bridge after re-auth succeeds
  (`{"success":true,"provider":"anthropic","subscriptionType":"pro"}`).
- The macOS Keychain cannot be `fs.watch`ed — there is no OS-level
  notification hook for a keychain item changing.

So the actual gap is not "we don't react to a file change" — it's "we have
no trigger at all for a Keychain-only credential rotation." The fix needs a
different signal source, not a fix to the existing watcher.

## Decision

Replace the `~/.claude/.credentials.json` watcher with a lightweight
periodic poll on `CredentialsBridgeService` itself
(`startKeychainPoll`/`stopKeychainPoll`, default 60s, env-overridable via
`CLAUDE_KEYCHAIN_POLL_MS`):

1. Each tick reads the CURRENT Claude refresh token via the bridge's
   existing Keychain-first/file-fallback reader (`readClaudeCreds`), then
   hashes it (`refreshTokenFingerprint`, SHA-256 — the raw token is never
   logged or held past the hash).
2. Compares that fingerprint to `lastBridgedRefreshFingerprint`. Unchanged
   → no-op (no `setOAuthCredentials` or Anthropic refresh call churn every
   minute). Changed → calls `bridgeAnthropic(client, { force: true })` and,
   only on success, updates the baseline.
3. A transient read failure (null read or thrown `keychain_denied` during
   the logout→login transition) is swallowed at info/warn level, the
   existing bridged token is left untouched, and the next tick retries —
   self-healing, matching the exact failure mode observed in smoke.
4. `bridgeAnthropic` itself now also updates
   `lastBridgedRefreshFingerprint` on ANY successful bridge — launch-time
   auto-bridge, the Settings "Reconnect" button, the pre-existing #658
   15-minute refresh loop, or the poll's own force-bridge — so the poll
   never redundantly re-fires on its next tick for a token some other
   caller already bridged.
5. The poll is started unconditionally at launch (even when
   `hasClaudeCode()` is false at that moment), so a first-time `claude`
   sign-in that happens *after* the server is already running is also
   picked up, not just account switches on an already-authed machine.

The pre-existing `#856` `AuthCredentialWatcher` on opencode's own
`~/.local/share/opencode/auth.json` is untouched — it watches a real,
persisted file for opencode's own provider-credential flows and continues
to work as designed. Only the Claude-Code-specific companion watcher (added
by the wrong diagnosis) is removed.

## Alternatives considered

1. **Fix the file-watch to also react to Keychain reads on a timer,
   keeping the `AuthCredentialWatcher` abstraction.** Rejected: the
   watcher's entire design (fs.watch + debounce + snapshot diffing) exists
   to solve "detect a file change," which isn't the problem here — there is
   no file. Reusing it would mean stripping out all the fs-specific
   machinery and reimplementing a poll inside it anyway; simpler to add a
   poll directly to `CredentialsBridgeService`, which already owns the
   Keychain read path and the `bridgeAnthropic` call.
2. **Shorten the existing #658 15-minute refresh loop instead of adding a
   second timer.** Rejected: #658's loop exists for a different purpose
   (pre-expiry access-token freshness) and always force-rebridges every
   tick regardless of whether anything changed — running that on a 60s
   cadence would multiply Anthropic refresh-endpoint calls needlessly. The
   two loops are complementary (this decision keeps both) rather than
   merged, per the dispatch's explicit priority: correctness of #658 over
   consolidation.
3. **Poll unconditionally without change-gating (always force-rebridge
   every tick).** Rejected: churns `setOAuthCredentials` and risks
   triggering Anthropic's single-use refresh-token rotation on a timer
   instead of only on a genuine re-auth, which is unnecessary load and a
   needless dependency on the refresh endpoint's availability.

## Consequences

- A real `claude` re-auth is now detected within one poll interval (60s
  default) instead of never, at the cost of a low-frequency `security`
  keychain read every interval. This is the same command
  `loadFromKeychain()` already runs today on every cache-miss `readClaudeCreds()`
  call — the poll does not introduce a new privilege boundary, only a new
  caller of an existing code path.
- Risk flagged for manual smoke, not fixed here: `security` reads can
  trigger a one-time macOS keychain-access permission prompt on some
  machines/OS versions depending on how the item's ACL was created. This
  has not been observed in this environment (the existing #658 loop
  already polls the same command every 15 minutes without incident), but a
  tighter interval increases exposure if it ever does occur. See
  `docs/ai/project-state.md` Risks for the manual-smoke follow-up.
- The `~/.claude/.credentials.json` file-fallback read path in
  `CredentialsBridgeService.loadFromFile` is intentionally left in place
  (untouched) — it's a legitimate fallback for older `claude` CLI versions
  or non-macOS environments that DO persist that file, even though the
  poll's trigger no longer depends on it being written on every re-auth.
