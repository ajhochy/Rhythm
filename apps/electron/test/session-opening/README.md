# Exact-session external opening

The source Electron host already accepts
`rhythm://app/index.html#/agents?sessionId=<local-session-id>` via startup argv,
`open-url`, and a same-profile second instance. The renderer consumes that local
ID after live session-list hydration and on hash changes. It reads the exact
detail route even if the row is absent from the first list page. A missing or
invalid target displays an error instead of falling back to another conversation.

The built `desktop-capabilities.json` advertises this renderer contract. External
callers should require that marker and an explicitly configured running source
Electron profile. This does not add a Flutter deep-link handler or register a
new operating-system URL association.

When replacing generated assets underneath an already running source shell,
perform one normal renderer Reload before qualification. A URL differing only in
its hash can retain the old document and old JavaScript even though the built
capability file exists. This refresh does not require restarting Electron's main
process, the API, or the engine. The existing main-process security policy clears
authentication on full main-frame navigation, including Reload, so use the normal
Google sign-in flow afterward. Same-document session links preserve that session;
do not inject credentials to avoid this authentication boundary.

Run the deterministic UI/parser contract from `apps/web`:

```sh
npm run test:session-opening
```

This dedicated configuration intercepts all local/production HTTP and WebSocket
traffic and bypasses the static HTML's shipping-port CSP. The native test below
uses the real Electron `rhythm://` protocol and host-generated CSP.

For native behavior, first generate the canonical synthetic fixture and launch
`tools/dev/sandbox.sh` per `docs/ai/testing-guide.md`. Use an explicitly owned
`RHYTHM_SANDBOX_DIR` beginning with `/private/tmp/rhythm-session-opening-`; the test
requires API4098/engine4097 already healthy. It creates only two no-prompt fixture
sessions and a disposable Electron profile inside that sandbox. Do not use live
stores or start API/engine manually.

```sh
# From apps/web: fixture-only token, never distribute this bundle.
VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_LIVE_TOKEN=e02-synthetic-session-not-a-secret npm run build
# From repo root, with the owned sandbox path exported:
RHYTHM_LIVE_E2E=1 node apps/electron/test/session-opening/live.mjs
```

The test launches the real source Electron executable with `--interactive-smoke`,
`--allow-test-runtime-ports`, and Chromium's test-only `--use-mock-keychain` flag.
It asserts the requested heading on cold launch, then invokes a second process
with the same `RHYTHM_SHELL_USER_DATA` and another exact URL. The second process
must exit zero while the first PID/window survives and shows the second heading.
Local IDs must differ from SDK IDs; opening must send no HTTP mutations and leave
transcripts empty and sandbox service PIDs unchanged. Screenshots remain in the
sandbox until copied. This qualifies the source shell used by this repair, not
signed packaging, production authentication, or real Keychain behavior.

After native testing, remove fixture build inputs before producing a live bundle:

```sh
# From apps/web:
env -u VITE_RHYTHM_API_BASE -u VITE_RHYTHM_ENGINE_BASE \
  -u VITE_RHYTHM_PRODUCTION_API_BASE -u VITE_RHYTHM_EXPECTED_API_BASE \
  -u VITE_RHYTHM_EXPECTED_ENGINE_BASE -u VITE_RHYTHM_LIVE_TOKEN \
  VITE_RHYTHM_GATEWAY_MODE=live npm run build
```

Scan the resulting files for fixture credentials before handoff. Tear down only
the owned sandbox with `tools/dev/sandbox.sh down`, preserving relevant evidence.
