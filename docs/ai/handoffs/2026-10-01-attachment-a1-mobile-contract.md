# A1 mobile attachment boundary — resume contract

Owned source: `opencode/delivery-attachments-20261001`, baseline `c1b7e023fbd85774fe447078cfe410f228dee539`. Implementation and live acceptance are **not yet complete**.

## Selection / send (existing canonical wire shape)

```ts
{ type: "file", mime: actualMime, filename: selectedFilename,
  url: `data:${actualMime};base64,${actualSelectedBytesBase64}` }
```

- Send with the ordinary text part through the existing prompt surface. Encode actual bytes once. Neither a browser/mobile-local URI nor `file:<filename>` grants server filesystem authority. Do not fabricate `/filename`.
- Supported visual consumption remains conditional on the actual selected model's capabilities. Do not alter Astra/Luna capability metadata.
- Transcript `/artifacts/<id>` plus `artifactId` and `artifactProject` is display identity, **not** a provider URL or Read path. Fetch display bytes only through the existing scoped authenticated artifact route; do not forward credentials or arbitrary authenticated remote URLs to the engine/provider.
- A1 will publish any server normalization helper only after its user/project/session allow/deny contracts pass. No new resolver endpoint is promised by this receipt. M owns `mobile_opencode_proxy.ts`: its current `sanitizePromptFileUrl` accepts valid data URLs and project-owned file URLs, but rejects relative artifact display URLs. Any adapter must preserve that trust boundary and be validated by M.
- Replay the engine's existing persisted message/parts; do not upload again merely to refresh/reconnect a transcript.

## Ownership / approval

The resume handoff records AJ's exact informed approval: “reloaded, its not there. I approve the disclosed HIGH-impact mobile and attachment changes, and revalidate the existing Run Now patch for verification.” A accepts this as matching authorization for the previously disclosed attachment-only `message-v2.ts` (29 direct / 161 nodes) and `prompt.ts` (8 direct / 103 nodes). It is not approval for new HIGH symbols, permission changes, or mobile product edits by A. Cards `879da510` and `27db624a` remain UI-invisible; no signed-card decision is claimed.

## Runtime owner

A is sole owner of the 4098 API / 4097 engine / 4099 gateway sandbox for this resume. Do not launch a competing sandbox. Exact retained fixture/environment and teardown evidence will be supplied in A's run receipt; no integration-ready runtime claim yet.

## Final A receipt — BLOCKED, not a stable ready adapter

Current real API/WS/engine suite:9pass; Read/XLSX:55pass; web picker:3pass. Broader fork session suite:409pass/2patch-induced failures (existing public-image URL conversion and installed binary-reader discovery). Two bounded repair cycles exhausted; do not integrate as verified. Parser shared-string output budget before serialization and broader referenced-artifact blob/metadata lifecycle remain unqualified. Mobile gateway/UI, installed Electron and real provider entitlement are not proven by synthetic transport tests.

New helper (implemented, **not approved as verification-ready**):

```ts
normalizePartAttachments(
  parts: Array<Record<string, unknown>>,
  trustedSession: { id: string; projectId: string | null;
    sdkSessionId?: string | null; ownerUserId?: number | null },
  actorUserId?: number,
): Promise<Array<Record<string, unknown>>>
```

Located in API `services/attachment_hosting.ts`. For a server-authorized same-session/project reference, reads only a registered checksum-addressed blob and verifies size/hash; outputs canonical native data URL and authoritative stored MIME. Missing/denied errors are identical and path/token-free. No arbitrary authenticated URL fetch. M must invoke any resolver only AFTER its existing authenticated project/session ownership checks and with server-derived session/actor; never construct trusted scope from attachment fields. Preserve the current proxy's validation instead of relaxing it to accept display URLs indiscriminately. A has not edited the M-owned proxy/provider or changed permissions.

Sandbox is now DOWN; no4097/4098/4099 listeners at final probe. Fresh read-only sources retained:

- `RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-attachment-a1-fixture-20261001-resume`
- `RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-attachment-a1-fixture-20261001-resume/rhythm.db`
- `RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-attachment-a1-fixture-20261001-resume/opencode.json`
- `RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-attachment-a1-sandbox-20261001-resume`

Identical runtime settings and sanitized evidence paths: `../runs/2026-10-01-attachment-a1-resume.md`. Ports not reserved; the fixture's safe MCP command points at A's built payload, so the next single runtime owner must validate source/payload identity before reuse. Do not touch foreign sandboxes. No signed card decision or packaged/mobile delivery claimed.
