# Issue #1237 recon and inferred blast radius

Captured 2026-07-28 on `issue/1237-paired-mac-status`. GitNexus analysis is
explicitly waived for this dispatch; this report is based on import/caller
searches and direct source inspection before editing.

## Current status computation

- `PairedHostProvider` owns the persisted paired-host state machine exposed by
  `usePairedHost()`. `PairedHostStore.refresh()` probes
  `/mobile-gateway/health` and distinguishes `connected`, iPhone `offline`,
  `tailscaleUnavailable`, `unpaired`, revoked, incompatible, and unhealthy
  states. Before this issue it refreshes only on restore, explicit refresh, and
  `AppState` becoming active.
- Settings renders two independent answers. `PairedMacSection` reads
  `pairedHost.state/message`, while the Settings header and Connection
  accordion read `opencode.connection.status/message`.
- Agents chat lists derive online state from
  `opencode.connection.status === 'connected'`. Activity and Rhythm tools also
  combine OpenCode transport state with paired-host availability.
- The chat landing route starts `ensureActiveSession()` only while OpenCode is
  connected, but otherwise always renders the “Opening OpenCode Mobile”
  spinner unless there is no active project. It only changes the supporting
  copy for `connection.status === 'error'`.
- The chat-detail route already maps non-connected OpenCode state to
  `offline-cache`, but it uses the second OpenCode state machine rather than
  paired-host reachability.
- `OpencodeProvider.connect()` independently sets
  `idle → connecting → connected/error`. Its automatic-connect effect keys on
  paired client/host identity, not reachability state, so an unchanged paired
  identity does not reconnect after a reachability-only transition.
- The SSE loop retries forever with backoff. Each successful subscription
  refreshes sessions, archived sessions, pending interactions, server
  features, and the current session. Stable event IDs are deduplicated within
  one effect lifetime, but independent paired-host and OpenCode recovery paths
  can overlap refreshes.

## Import/caller blast radius

`usePairedHost` / `PairedHostProvider` direct consumers:

- `apps/mobile/app/_layout.tsx`
- `apps/mobile/app/pair.tsx`
- `apps/mobile/app/(tabs)/settings.tsx`
- `apps/mobile/providers/opencode-provider.tsx`
- `apps/mobile/providers/agent-chat-provider.tsx`
- `apps/mobile/providers/activity-provider.tsx`
- `apps/mobile/providers/rhythm-tools-provider.tsx`

Paired-host state types/labels are also rendered by
`apps/mobile/components/settings/paired-mac-section.tsx`.

`useOpencode` / OpenCode connection state direct surface consumers include:

- Settings and Agents chat/session routes
- chat list/view/content
- workspace and terminal routes
- tool routes
- agent chat, activity, and Rhythm tools providers

## Risk assessment

Risk is **moderate**: changing the meaning of OpenCode `connection` can affect
all chat, tool, terminal, activity, and Settings gating. The narrow design is
to leave direct-web OpenCode behavior intact, make paired-host reachability
authoritative only when a paired host exists, deduplicate the health refresh,
and derive paired transport availability from that state. Mutations remain
guarded by the same derived online boolean.

The fake server needs a test-only reachability control that can make paired
gateway requests return errors or remain pending. This is limited to
`apps/mobile/tests/fake-opencode/*`.

## Regression correction recon

`tests/e2e/flows.spec.mjs` boots the exported web app against the fake OpenCode
server without ever pairing a host. The E2E runtime's credential map starts
without `PAIRED_DEVICE_SECURE_KEY`, so `PairedHostStore.restore()` resolves to
`unpaired` and must not probe `/mobile-gateway/health`. Base chat readiness in
this mode comes solely from OpenCode's direct-web `connection.status`.

The stalled draft incorrectly required `pairedHost.state === 'connected'` in
`AgentChatProvider`, even when `pairedHost.host` was null. That made
`chat.isOnline` false and disabled the real `Create chat` control across all
legacy flows. The corrected predicate applies paired-host reachability only
when a saved host exists. The provider also short-circuits bounded refresh,
AppState refresh, and cadence polling when no host exists.

For a genuinely paired host, the Agents landing route and session-detail route
now check the authoritative paired state before rendering a loaded chat or
loading spinner. Direct-web sessions retain their original OpenCode connection
fallback. The SSE retry loop reports a transport failure to paired reachability
once per outage rather than once per backoff iteration.

The paired client object also remains stable across health responses for the
same account/host/device/gateway scope. Without this identity guard, each
five-second probe would replace the client, restart the OpenCode SSE effect,
and repeat its initial recovery refreshes despite an unchanged connection.
