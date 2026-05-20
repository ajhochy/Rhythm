# fix(agents): Google OAuth dialog hangs — route + Flutter UI both assume auto-callback when plugin requires paste-back

## Problem

Clicking **Authorize** on Google Gemini in Agent Settings opens the Google consent flow in the browser. After the user signs in and grants consent, Chrome lands on `http://localhost:8085/oauth2callback?code=...&state=...` (which is unreachable, since nothing in Rhythm listens on `:8085`). The Flutter dialog continues to show "This dialog will close automatically when the auth flow completes" indefinitely until the 5-minute timeout. `~/.local/share/opencode/auth.json` never receives a `google` entry, and `/opencode/auth` continues to omit `google` from `providers`.

## Root cause

Two co-existing mistakes in opposite ends of the same flow:

1. **Route default is wrong for Google.** [opencode_auth_routes.ts](apps/api_server/src/routes/opencode_auth_routes.ts) defaults `methodIndex=0` (auto/in-process) for every provider except OpenAI. The opencode `google` provider only supports method=1 (PKCE + paste-back / loopback redirect). When called with method=0, the SDK returns `method: "code"` anyway, but the route doesn't surface that — it just relays the auth URL and `instructions: "Complete OAuth in your browser, then paste the full redirected URL..."` — and Flutter never reads `method` from the response.

   The route already special-cases OpenAI in its comment:
   > Default is 0 for all providers except openai which must use 1.

   Google needs the same treatment. Same provider class.

2. **Flutter UI ignores `method: "code"`.** The `Complete sign-in — google` dialog only renders the "waiting for auto-callback" mode. It needs a branch that, when the route response carries `method: "code"`, shows:
   - The instruction text from the response (already returned).
   - A `TextField` for the user to paste the redirected URL or bare code.
   - A "Submit" button that POSTs / GETs `/opencode/auth/google/callback?code=...&method=1`.
   - The same "Cancel" affordance.

## Reproduction

1. Fresh `vbeta.18.32` install, opencode SDK ready, three other providers already authed.
2. Agent Settings → Free API Options → Google Gemini → **Authorize**.
3. Sign into Google in the spawned browser, grant consent.
4. Browser lands on `localhost:8085/oauth2callback?...` → "Site can't be reached".
5. Rhythm dialog stays open until 5-minute timeout. No `google` entry in `auth.json`.

## Verified ad-hoc

`curl -s http://localhost:4001/opencode/auth/google/authorize` returns `method: "code"` and a `redirect_uri=http://localhost:8085/oauth2callback`, confirming the SDK only offers paste-back for this provider. Calling `/google/callback?code=<code from browser>&method=1` directly completes auth and adds the `google` entry to `auth.json` — proving the server side already works once the right method is used.

## Scope

**Server (api_server):**
- `apps/api_server/src/routes/opencode_auth_routes.ts` — change the default method selection so `google` (alongside `openai`) defaults to `methodIndex=1`. Keep the existing `?method=` override for callers that want to force a flow.

**Client (desktop_flutter):**
- The Agent Settings OAuth dialog — likely under `apps/desktop_flutter/lib/features/agents/` (the same area that owns `AiAccountSection`). Add a `method == "code"` branch that swaps the "waiting" body for a paste input + Submit, and POSTs the callback with `method=1`.

## Acceptance criteria

- [ ] `GET /opencode/auth/google/authorize` returns `method: "code"` (already does — no functional regression; just ensure the route's default-method logic treats google like openai).
- [ ] After **Authorize**, the Flutter dialog shows the paste input + the SDK's instruction string, not the "auto-close" message.
- [ ] Pasting the full `localhost:8085/oauth2callback?code=...&state=...` URL or the bare `code=...` value submits a successful callback.
- [ ] `auth.json` gains a `google` entry of type `oauth`; `/opencode/auth` adds `google` to `providers`; dialog closes; Agent Settings shows the green checkmark.
- [ ] Existing OpenAI paste-back flow is unchanged (regression check).
- [ ] Anthropic / GitHub-Copilot / OpenRouter auto-bridged + API-key flows are unchanged.
- [ ] api_server `tsc --noEmit`, `npm run build`, `vitest run` all clean.
- [ ] `dart format` + `flutter analyze --no-fatal-infos` clean; relevant Flutter widget test if practical.

## Out of scope

- Replacing the paste-back flow with a real loopback listener bound to `:8085` (would be cleaner UX but requires a port the .app may not have permission to bind, and matches no existing pattern in the codebase).
- Auto-recovery from stale opencode subprocess on `:4096` (spiritual sibling of #614, still open as the follow-up I noted in [fix-opencode-binary-path-discovery.md](fix-opencode-binary-path-discovery.md)).

## Manual verification

After the fix lands and a new DMG is built: fresh install → Authorize Google Gemini → complete consent in browser → paste redirected URL into the Rhythm dialog → dialog closes → Gemini appears as authed → `/opencode/auth` lists `google` in `providers`.
