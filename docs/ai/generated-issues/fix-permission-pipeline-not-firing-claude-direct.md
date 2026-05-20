# fix(agents): #608 permission pipeline not firing — Claude direct in default mode runs bash without PermissionCard

## Problem

PR #617's #608 claim:
> "Permission pipeline end-to-end: permission.asked SDK events → WS broadcast → Flutter PermissionCard → accept/deny endpoints calling respondPermission. Destructive tools surface as modal dialogs when the toggle is on."

In vbeta.18.36 smoke: new session with **Claude direct (Anthropic provider)** as the model, permission-mode pill set to **default**, asked the agent to run `ls -la /tmp`. The bash command **executed immediately with no PermissionCard** appearing. There was no Accept/Deny prompt at any point. The full pipeline appears not to be wired through for this provider, at least.

## Reproduction (vbeta.18.36)

1. Create a new session.
2. Pick **anthropic** provider + any Claude model in the composer picker.
3. Confirm permission-mode pill is set to **default** (the most restrictive — should always prompt for bash).
4. Send: *"Run `ls -la /tmp` and tell me what you see."*
5. Observe: Claude calls the bash tool → bash runs immediately → output shows in tool-call card. **No PermissionCard at any point.**

## What we don't yet know

- Is `permission.asked` actually being emitted by the opencode SDK? (Check the opencode log.)
- Is the stream bridge in [opencode_stream_bridge.ts](apps/api_server/src/services/opencode_stream_bridge.ts) routing the event to WS? (Add a `[bridge] permission.asked` log line.)
- Is the WS frame reaching Flutter? (Network panel / WS sniffing.)
- Is the Flutter handler in `agents_controller.dart` consuming it and pushing a PermissionCard? (UI inspection / breakpoint.)

The whole chain needs to be walked. Likely it's a single break in one of those four hops.

## Scope (broad — fix any one of these likely culprits)

- **SDK side:** opencode's permission mode might require explicit per-session config in the `session.prompt` call body. We may not be passing it. Check what `opts.permissionMode` or similar field the SDK actually consumes vs. what we're sending.
- **Stream bridge:** see lines 78+ in [opencode_stream_bridge.ts](apps/api_server/src/services/opencode_stream_bridge.ts) (PendingPermission interface is already declared) — confirm the SSE event for `permission.asked` is being received and forwarded as a WS `permission` frame.
- **Flutter:** `agents_controller.dart` WS dispatch — confirm `permission` frames are being handled and pushed into the per-session permission state list that drives the PermissionCard widget.

## Acceptance criteria

- [ ] Repro above: PermissionCard appears before bash runs.
- [ ] Accept → bash runs, output streams.
- [ ] Deny → "user denied" appears in transcript; agent does not run the tool.
- [ ] acceptEdits mode: write/edit tools auto-accept, bash still prompts.
- [ ] plan mode: destructive tools auto-deny.
- [ ] bypassPermissions: first selection confirms, subsequent tools fire without prompts.
- [ ] All four modes verified against bash, write, and edit tools.

## Severity

**High — this is the #608 deliverable.** PR #617 cannot honestly claim "Closes #608" without this working. It's also a safety feature: the user can't trust the agent to not run destructive commands without their approval, which is one of the explicit motivations of #608/#611.

## Related

The permission-mode pill UI exists (the composer renders it; the four modes are selectable). The DB column was added in the migration. So the data layer + UI layer are in place — only the live event pipeline is broken.
