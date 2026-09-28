# #1573 preliminary source diagnosis

Read-only root inspection on mega27c61758. No production service, real vault, process configuration or provider inspected.

Current source can invoke Engraph and still guarantee no nonlexical semantic injection:
- memory_retrieval.ts:530–543 ignores every hit without explicit bounded confidence/similarity, intentionally refusing Engraph1.7.2 RRF scores as confidence.
- :592–594 separately requires clearsAutomaticGate, which at248–263 demands at least two matching query tokens and lexical score>=configured threshold.
- buildMemoryPreface :838,:856,:864 repeats this lexical requirement even after semantic retrieval.
- engraph_client.ts returns [] on URL refusal, HTTP error, malformed response and exceptions, erasing degradation reasons. Empty hits and errors are indistinguishable.

Both semantic blockers were introduced in15692f389 (July30), `fix(api): gate automatic memory injection on proven relevance; hidden-context persistence boundary`, after #1093's earlier wiring. Existing memory_retrieval_semantic tests explicitly prove RRF-only hits fail closed. This is evidence of an intentional gate incompatible with #1573's nonlexical acceptance, not proof of the specific September21 runtime failure operand.

Do not turn RRF rank into probability or simply delete relevance/owner/source/lifecycle protections to get a green test. Next needs acceptance/design for an explicit trustworthy semantic relevance signal and observable degradation (logs plus provenance), preserving owner visibility, managed path mapping and token budgets. A real sandbox prompt with lexical-disjoint synthetic memory must exercise the actual backend and persisted provenance. Search production is not needed for synthetic tests. No product edits yet.
