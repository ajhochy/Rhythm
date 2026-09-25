# MCP Apps

## Architecture

MCP Apps are an optional rendering layer for completed agent tool calls. The
fork negotiates `io.modelcontextprotocol/ui`, keeps app-only tools out of model
schemas, and persists the originating session, call, server, resource URI, cwd,
and expiry. The API accepts only the owned session/call path and asks the engine
to revalidate that provenance before one bounded resource read. Flutter fetches
only through `localhost:4001`; it has no MCP client, URI, server selector, token,
or raw proof.

The shipping view keeps the ordinary text/structured fallback outside the
WebView. Untrusted HTML runs in an opaque `sandbox="allow-scripts"` iframe
inside a trusted shell. Every view uses ephemeral storage, a network-denying
CSP, a boot nonce, fixed size/lifetime/message ceilings, a message rate limit,
and deterministic teardown. Device permissions, links, downloads, navigation,
and network requests are denied.

Interactive calls add a one-use API capability and engine-signed same-server
proof. The engine rechecks the current app-tool registry, profile allowlist,
input schema, proof/session/call/server/resource/cwd/expiry, and the existing
human permission UI before MCP execution. Capabilities and proofs never enter
the iframe.

## Supported methods

- `host.ping` — bounded liveness check in `readonly` and `interactive`.
- `host.next-gate` — requests the next server-owned capability gate; interactive only.
- `tools/call` — same-server app-visible tool call; interactive only and always subject to the existing human approval UI.
- Host-to-app initialization, tool input/result, theme, and size notifications are bounded and contain no credentials.

Unknown methods, malformed messages, stale nonces, closed views, excess rates,
and all calls in `off` fail closed. App-originated context updates are not wired
for GA: the checked-in policy documents the required explicit confirmation,
16 KiB bound, injection scan, durable taint record, and untrusted fence, but no
shipping UI may enable that path until all five steps are present end to end.

## Operations

`RHYTHM_MCP_APPS_MODE` accepts exactly:

Default mode is `off`; rollback mode is `off`.

- `off` — default and immediate rollback; no descriptor advertisement, resource rendering, capability issue, or app execution.
- `readonly` — resource rendering for negotiated pilots; all app-originated actions denied.
- `interactive` — explicitly opt-in after human smoke approval; uses capabilities, same-server proof, and the normal permission prompt.

Missing, mixed-case, whitespace-padded, or unknown values resolve to `off` at
every layer. Restart the engine/API and desktop app after changing the mode.

For a packaged app, fully quit Rhythm and launch the exact installed candidate
with the mode in its process environment (replace the app path when testing an
uninstalled signed candidate):

```bash
MODE=readonly
open --env RHYTHM_MCP_APPS_MODE="$MODE" /Applications/Rhythm.app
```

Launching from Finder does not set this variable and therefore leaves the mode
`off`. After Rhythm is ready, identify the packaged desktop, API child, and
engine child PIDs, then prove that each inherited the exact value:

```bash
DESKTOP_PID=$(pgrep -n -x Rhythm)
API_PID=$(pgrep -P "$DESKTOP_PID" -f 'dist/server.js')
ENGINE_PID=$(pgrep -P "$API_PID" -f 'opencode')
ps eww -p "$DESKTOP_PID" | tr ' ' '\n' | grep "^RHYTHM_MCP_APPS_MODE=$MODE$"
ps eww -p "$API_PID" | tr ' ' '\n' | grep "^RHYTHM_MCP_APPS_MODE=$MODE$"
ps eww -p "$ENGINE_PID" | tr ' ' '\n' | grep "^RHYTHM_MCP_APPS_MODE=$MODE$"
```

All three commands must print the same assignment. A missing PID, missing
assignment, or mismatched value means the packaged run is not valid evidence.
Repeat with a full quit and fresh launch for `off`, `readonly`, and
`interactive`; do not reuse processes between mode runs.

Roll back by setting `RHYTHM_MCP_APPS_MODE=off`, restarting, and confirming both
pilots retain useful text fallback. Do not enable `interactive` merely because
automated tests pass; it requires a named human approver and linked packaged
smoke evidence.

## Troubleshooting

- No app appears: verify the exact mode, restart all processes, confirm the peer negotiated the stable UI extension, and inspect the text fallback.
- Resource returns 404: this is the intended non-disclosing response for off mode, stale/expired provenance, ownership mismatch, call mismatch, cwd mismatch, changed descriptor, cross-server request, or malformed resource.
- Interactive request is denied: confirm interactive mode, pilot profile scope, same-server app visibility, fresh capability/proof, valid input schema, and the human permission decision. Never bypass a denial.
- View disappears: content/message/rate/view/lifetime bounds or teardown fired. Keep the fallback visible and collect sanitized logs; do not raise limits as a first response.
- Packaged behavior differs from Debug: stop rollout, return to `off`, and rerun the packaged malicious matrix. Debug-only evidence is not GA evidence.

The release gate is fail-closed: any unexpected successful attack, missing
fallback, raw credential/proof exposure, or unrecorded packaged result blocks
GA. This sandbox cannot produce packaged or live evidence; those checkboxes
remain deliberately unclaimed until the UI-capable orchestrator records them.
