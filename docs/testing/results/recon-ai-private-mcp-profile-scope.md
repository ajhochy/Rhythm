# Private MCP profile-scope Recon

Two exact signed-app observations at source revision `4fda3121184411ade608582428d10e9295fe7b2e` used a disposable synthetic actor and a bounded real OpenAI `gpt-6-luna` loan. The private raw receipts are `observation-1792552702800.json` and `observation-1792552889335.json` under `/private/tmp/rhythm-mcp-profile-runtime-recon/`; this note records only credential-free outcomes. The checked-in packaged test is **Codify only; native Confirm has not run**.

Normal renderer reload acknowledged `/opencode/mcp/rhythm/ensure` with `registered: true`. API, engine, Settings, and Profiles Refresh showed the connected 114-tool catalog and the `rhythm_list_tasks` control. Three UI-created, normal-API/SQLite-confirmed profiles used inherited (`null`), selected (`{"rhythm":["rhythm_list_tasks"]}`), and None (`[]`) policies. A nonce-owned task and four fixed-Luna UI sessions were created; each completed SDK turn was linked to its exact UI user message and had accepted Luna dispatch provenance. Owned sessions, profiles, task, and fixture directory were removed in order.

| Scope | Actual SDK `mcp_dispatch` execution | Observed result |
| --- | --- | --- |
| Inherited | `rhythm_rhythm_list_tasks` with owned task ID | Completed; output contained the exact owned ID and title. |
| Selected allow | `rhythm_rhythm_list_tasks` with owned task ID | Completed; output contained the exact owned ID and title. |
| Selected deny | `rhythm_rhythm_ping` | Canonical execute returned an SDK tool-part error classified as allowlist denial. |
| None | `rhythm_rhythm_list_tasks` with owned task ID | Canonical execute returned an SDK tool-part error classified as allowlist denial, without task data. |

The first four-turn run's selected-deny case only produced an empty search; that is **not** enforcement evidence. The independent two-turn run supplied both canonical execute denials. These observations establish per-session enforcement for the exercised tools and policies, not all MCP tools, cold startup registration, account switching, or provider-independent model behavior.

Existing `packaged-ai-mcp-stdio.spec.ts` remains the separate connected catalog/stdio check. Fork allowlist tests remain useful source checks; they do not substitute for the packaged model's actual SDK tool parts.
