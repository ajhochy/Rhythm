# Track 7 contract — artifact push-on-produce + relay serve (S3.1–S3.3)

Artifacts are immutable blobs — the easiest state to host on the NAS. The Mac
pushes bytes once at generation time; the relay serves them locally (works
with the Mac asleep) and falls back to tunnel-and-cache. Health gains a
presence timestamp.

## Deliverables

1. **Mac push (S3.1).** `relay_uplink_client.ts` gains
   `pushArtifact(input: { artifactId: string; meta: Record<string, unknown>; filePath: string }): Promise<void>`:
   read the file; if the base64 payload is ≤ 8 MB send
   `file/artifact {artifactId, meta, dataB64}`, else send the same frame with
   `dataB64: null` (metadata-only). Never throws to callers; a read/send
   failure logs and returns.
   `opencode_stream_bridge.ts`: in the `registerGeneratedMediaPart(...).then((artifact) => …)`
   block (~line 1276), after the existing handling, fire-and-forget
   `getRelayUplinkClient()?.pushArtifact(...)` mapping the store's artifact
   record to {artifactId, meta (at minimum contentType + filename if the
   record has them), filePath}. Read `media_artifact_store.ts` to map fields
   — do not guess.
2. **Relay store (S3.2).** `relay_uplink_server.ts`: on `file/artifact`,
   validate `artifactId` against `/^[A-Za-z0-9_-]+$/` (reject otherwise);
   write bytes to `${resolveLiveArtifactStorageDir()}/<artifactId>` and meta
   to `<artifactId>.meta.json` beside it (mkdir -p the dir). Metadata-only
   frames write only the sidecar. Overwrites are fine (immutable content,
   idempotent push).
3. **Relay serve (S3.2).** `relay_gateway_routes.ts`, device-authed, BEFORE
   the catch-all: `GET /mobile-gateway/artifacts/:id`:
   - invalid id (fails the regex) → 400;
   - local bytes exist → 200, body = bytes, `content-type` from the sidecar
     meta (fallback `application/octet-stream`);
   - no local bytes + Mac online → tunnel via the existing rpc path AND, on a
     200 response, cache bytes + content-type into the store before/while
     answering (next offline read must hit the cache);
   - no local bytes + Mac offline → 404 `{error:'mac_offline'}`.
4. **Presence (S3.3).** The relay health body (`/mobile-gateway/health` and
   `/health`) gains `lastUplinkAt: string | null` — ISO timestamp updated at
   least on hello, ctrl/health, and resync-done. Null before any uplink.
   (This is additive; the verbatim-passthrough contract for the fingerprint
   fields is unchanged and its tests must stay green.)

## Acceptance tests (do not modify)

`apps/api_server/src/__tests__/relay_artifacts_contract.test.ts`.

## Verification loop

- `cd apps/api_server && npx tsc --noEmit`
- `npx vitest run src/__tests__/relay_artifacts_contract.test.ts src/__tests__/relay_uplink_server_contract.test.ts src/__tests__/relay_uplink_client_contract.test.ts src/__tests__/relay_repl_contract.test.ts src/__tests__/relay_mirror_reads_contract.test.ts src/__tests__/relay_role.test.ts`
- Sandbox can't bind sockets? tsc clean + contract fidelity; flag it.

## Constraints

- No new dependencies. apps/mobile untouched (artifact URLs already flow
  through the tunneled/mirrored read paths).
- Flag demonstrable contract-test defects loudly instead of editing them.
