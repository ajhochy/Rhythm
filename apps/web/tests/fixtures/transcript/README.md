# #1582 S0 transcript evidence (frozen for S1)

Seven `*.jsonl` files are **captured** records from commit
`e93eac6e7f9007eb4f4be4a434784a5fe7e2d3da` (one JSON object per line).
They are not fabricated reducer expectations. Each record contains the scenario,
source commit, exact capture command, `expectedFinal`, ordered real bridge
`frames`, `mid` and `final` REST `/agent-sessions/:id/messages?limit=50`
responses, count summary, provider observation, and canonical local/SDK IDs.
`capture-results.json` gives the scenario qualification status. Run
`node apps/web/tests/live/capture-transcript-frames.mjs --verify` offline to
validate the frozen wire/identity/privacy contract. To regenerate, run the
same command **without** `--verify` from this branch's root with locked local
dependencies; it creates a new fixture and launches the canonical sandbox.
`--verify --require-all` is intentionally red with `UNVERIFIED` until the
blocked scenarios are captured; this is the explicit failing qualification
check rather than silently passing a prose-only gap.

Provenance: `tools/dev/sandbox_fixture.mjs` created a fresh admin/member/session
SQLite fixture and a local-only MCP map; no live database, HOME, prompts, auth,
browser data, or external provider is copied. The recorder overrides only
the fixture's MCP API URL to 6998 and adds a loopback OpenAI-compatible provider
on 6996, with a public synthetic key. The provider uses the streaming-chunk
shape documented by the vendored tests at
`apps/opencode_fork/packages/opencode/test/lib/llm-server.ts` (revision above),
but the server/harness here is independently written; license retained in
`VENDORED-MIT-LICENSE.txt` for attribution. Sandbox uses API6998, engine6997,
gateway6999, temporary HOME and the built fork. `kind: captured` is mandatory;
future derived transforms must name the input fixture and transformation, and
source-derived synthetic unit shapes must have `kind: synthetic`, never
`captured`. No derived or synthetic transcript fixtures are claimed here.

Sanitization mapping per record: canonical synthetic session/message/part IDs
and WS ordering are unchanged; generated S0 prompts only; provider logs scenario,
tool names and tool-result presence, not HTTP headers/bodies; bearer absent from
the recorder output by construction; URLs are loopback. `--verify` additionally
rejects bearer markers, key-like patterns and external URLs; this scan is a
defense in depth, not the basis of the privacy claim. The `pwd` tool returns
only the newly generated sandbox fixture directory. Never treat these synthetic
session tokens as usable outside this fixture.

**S1 frozen contract:** a WS part snapshot has identity in `part.id`,
`part.messageID`, `part.sessionID` (SDK ID); a delta has top-level `messageId`,
`partId`, `field`, `delta`; a message info event has `info.id` and
`info.sessionID`. Every frame's `id` is the local Rhythm session ID. Reasoning
uses `field: "text"`; append identical/repeated Unicode deltas without
deduplication. REST is independently sampled during streaming and after the
terminal turn; retain ordered WS history and treat final snapshots as
authoritative. PASS: plain, reasoning, tool, permission, question, cancel,
provider error. **BLOCKED for live qualification:** compaction (no bounded
scripted trigger), attachment-only/mixed inputs (no approved synthetic
attachment/entry-point flow). Optimistic user text originates in the client
and cannot be claimed as a bridge WS event; the captured user part is the
engine's canonical user identity. S1 can unit-test hypothetical cases as
`synthetic`, but must not report them as live-qualified.
