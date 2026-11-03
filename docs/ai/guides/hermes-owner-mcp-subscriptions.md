# Owner MCP update subscriptions (source implementation; not live-qualified)

Use the existing protected owner bearer configured for the official Rhythm MCP
client. No new login, Bridge capability, registrar enrollment or HumanCAP is used.
The source must already exist and be owned by the normalized local user.

```json
{"tool":"rhythm_subscribe_updates","arguments":{"sourceKind":"agent_session","sourceId":"ACTUAL_DURABLE_SESSION_ID","hermesSessionId":"SAVED_HERMES_SID","profile":"default"}}
```

For a canonical workflow use `sourceKind: workflow_run` and its real run ID. A
plain agent session uses its actual durable ID as V2 `runId`/`workflowId` transport
identity, **not** as a verified coding-workflow run. Control responses explicitly
return `sourceKind`, `sourceId`, and nullable `workflowRunId`. No fake workflow row,
agent dispatch or approval authority is created. Notification cards remain opaque
canonical approval references; approval tools and explicit owner consent remain
separate. Event envelopes retain the fixed installed V2 keys and labels.

Disable with `rhythm_unsubscribe_updates` and the same sourceKind/sourceId. The
outbox and immutable saved-chat binding are retained. Reassignment is rejected.
Current owner/project/SDK/membership authority is checked again for delivery/ACK.

## Trusted local operator provisioning

Extend an approved protected600 fixture manifest with `sourceKind` and `sourceId`;
omit Bridge capability, manager/target/prompt fields. Retain existing owner/default
profile/native pins/state/endpoint references. Use a NEW native birth receipt only;
existing chats are never adopted. Native cookie-enabled mapping still fails closed.

```sh
# NOT RUN against live4001. Existing protected owner reference only; no secret argv.
COMMON=(--attach-existing-owned-source --allow-private-relay
  --api http://127.0.0.1:4001 --token-file "$EXISTING_OWNER_FILE"
  --state-dir "$NATIVE_STATE" --native-source "$PINNED_OWNED_STAGE"
  --native-endpoint http://127.0.0.1:8787 --approved-fixture-manifest "$APPROVAL")
python3 -B tools/dev/hermes_fixture_provision.py "${COMMON[@]}" # dry-run
python3 -B tools/dev/hermes_fixture_provision.py "${COMMON[@]}" --create-native-owned-fixture
python3 -B tools/dev/hermes_fixture_provision.py "${COMMON[@]}" --execute-owned-fixture
```

Intended writes: supported NEW native birth+rename, owner subscription metadata and
outbox, matching Receiver.link and additive own registry entry. No job/projection/
runtime/registrar/delegation requests. No arbitrary callbacks. Redirect and proxy
protections remain. Owner bearer must be an existing owned600 non-symlink file;
config JSON-pointer credential references are not implemented in this slice.

**Source qualification PASS on canonical4898:** actual API-created owned source →
official MCP subscribe → real rename/engine SSE/outbox → pinned unchanged native
receiver → unobscured Chromium receipt → source-visible ACK. One selected progress
event produced one native provider effect, zero source model requests and zero Bridge
jobs; busy duplicate/subscriber-DB reopen and owner/NULL-owner/SDK/project revocation
plus unsubscribe passed. Native-process restart and delivery of every source event
kind were **NOT RUN**. Snapshot107 core + patch7 overlap: union110 files, unchanged
receiver and fixed V2 wire, not114 native files. See
`../runs/2026-10-15-hermes-owner-subscription-project-fixture.md` and
`../runs/2026-10-15-hermes-owner-subscription-final-contract.md` (parent independent
gate34996 also passed aggregate/native ACK; no product bug found). CLI owner attach
and MCP subscribe are notification control, **not agent dispatch** or Bridge
enrollment; audited owner MCP execution made no capability-file reads or
registrar/projection/delegation requests. The actual source session ID is an agent
record, not a verified workflow ID. Existing project intent, provisioning inputs,
snapshots and flags remain prerequisites; API source rename is metadata-only, with
zero provider effects before delivery. No missing story/input values are inferred.
Live4001 operator activation was **NOT RUN**, nothing created live: installed
0.18.78 has the old two-tool baseline112; new source inventory112+2=114 is pending
parent commit/new CI and future0.18.79 qualification (report114 in PR1617). Parent
observed the existing protected Cloud-owner bearer accepted by local identity200,
owner1; this is not activation proof. Cookie-enabled auth mapping still STOPs;
actual deployed `auth_enabled=false` permits the existing private-LAN operator mode,
without a new login field. Minimal identity stays version1. No release, app switch,
restart, enrollment or Hermes rewrite authorization is implied.
