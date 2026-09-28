---
date: 2026-09-24
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
base: e93eac6e
fork: ajhochy/hermes-rhythm-plugin @ 8ea642db (branch mega/2026-09-18-rhythm-plugin-finish, PR17)
issue: 1569
status: design gate. Needs Astra review, then AJ approval, before GPT-6 Sol coding.
tags: [plan, rhythm, hermes]
---

# Plan #1569: Hermes + Rhythm shared provider readiness, brokered keys, and intentional memory

## Goal

Add one Rhythm AI-accounts screen that shows, for each provider, whether Rhythm and the embedded Hermes can use it and who owns the credential. From that screen the user can:

- opt a Rhythm-held **static API key** into the Rhythm-spawned Hermes backend, **in memory only**;
- opt Hermes into **read-only** search of Rhythm memory.

None of this copies refresh tokens anywhere. It does not expose the Keychain, write any Hermes credential store, or merge Rhythm users with Hermes profiles.

## Constraints

- Planning was read-only. No credential values were read. Nothing under `~/.hermes`, the vault, or any live service was changed. The only file written is this plan.
- Mega `e93eac6e` already embeds the pinned Hermes Desktop artifact (`PINNED_HERMES_DESKTOP_SOURCE_COMMIT = 8ea642db…`, `apps/electron/src/hermes-desktop-config.mjs:3`). A fork change therefore needs three things: a new fork commit, a rebuilt artifact with recomputed integrity, and a pin bump. There is no dirty-artifact path in packaged builds (`hermes-view.mjs:132`).
- Keep these issues separate: #1540 (plugin), #1541 (sidecar/bundled payload), #1542 (embed), #1543 (theme), #1570 (in-place artifact update). This plan only depends on them. It does not absorb them.
- This is a local-only feature (Electron main, local agent server, fork). No production API or Postgres surface. Draft PRs only; no merge, deploy or release.
- Tests use temporary HOME, `HERMES_HOME`, userData and vault directories plus synthetic keys. Real `~/.hermes` and the real vault are only touched by AJ's final manual gate, which is observation only.

## Product goal, resolved (AFK safe defaults)

"Whatever is accessible on one is accessible on the other" resolves to three different answers:

| Provider class | v1 behaviour | Why |
|---|---|---|
| Static API keys (OpenRouter, OpenCode Zen, API-key-type Anthropic, OpenAI, Google) | The user opts in per provider. The key is handed to the Rhythm-spawned Hermes backend as process env at spawn. Nothing is written to disk. | Static keys don't rotate, so there is no refresh race. |
| Claude subscription | Already shared upstream. Both apps read Keychain `Claude Code-credentials` / `~/.claude/.credentials.json` (Rhythm `credentials_bridge_service.ts:327,338`; Hermes `agent/anthropic_adapter.py:988-1071`). v1 shows this; it does not sync. | Finding 1 of #1569 is **confirmed**. |
| OAuth grants (ChatGPT/OpenAI OAuth, Google OAuth, Hermes `openai-codex`/`nous`) | Not shared. Each app signs in itself. The screen shows both sides and sends the user to the owner. | Rotating refresh tokens shared between two clients get revoked (RFC 9700 §4.14.2). The grants are also different clients. |

Memory: Rhythm's vault remains the store and Hermes' `MEMORY.md`/`USER.md` remain its per-profile working set. Hermes agents get explicit, opt-in, read-only ranked search. The vault is hardened against the external edits Hermes agents (and Obsidian) already make.

**Non-goals:**
- writing `~/.hermes/.env`, `auth.json`, `config.yaml` or `mcp-tokens/`;
- sharing with a standalone (non-embedded) Hermes, or with a borrowed backend;
- non-default Hermes profiles in v1;
- Hermes writes into Rhythm typed memory;
- a Flutter UI (Flutter has no embedded Hermes);
- a model-API proxy.

## Verified current state (source refs)

**Rhythm credential stores:** these are per OS user (`homedir()`). There is no per-profile or per-Rhythm-user scoping.
- opencode store: `~/.local/share/opencode/auth.json`, entries `{type:'api',key}|{type:'oauth',…}` (`opencode_auth_store.ts:26`).
- Anthropic multi-account store: `~/Library/Application Support/Rhythm/anthropic-accounts.json` (`anthropic_accounts_store.ts:28-32`).
- Google: `~/.gemini/oauth_creds.json`.
- Anthropic refresh is split between the api_server (`anthropic_accounts_service.ts:87-111`, `credentials_bridge_service.ts:372`) and the engine plugin (`rhythm-anthropic-accounts/dist/credentials.js:143-158`).

**Readiness routes:** `/opencode/auth` (`opencode_auth_routes.ts`: `GET /`, `/sources`, `/accounts`, `POST /:provider {apiKey}`). They never return values. They are protected only by `localAgentSurfaceGuard` (Host/Origin checks), with no `requireAuth`.

**Electron main**
- Main is the only privileged process.
- The Hermes host module is `import()`ed into main (`hermes-view.mjs:39,135`). It is called with `createEmbeddedHermesHost({hostWindow, webContents, assetRoot, userDataPath, openExternal, log})` (`:149-153`).
- The Hermes view preload exposes no Rhythm IPC (`hermes-view-preload.cjs`).
- Rhythm renderer IPC is guarded by `ownsDocument` (`main.mjs:114-125`).
- `safeStorage` is used only for the Rhythm session blob (`main.mjs:85-97`).
- Provider API keys currently go renderer → HTTP → api_server. They never pass through main (`apps/web/src/gateway/sessions.ts:454-479`).

**Fork embedded host**
- It spawns `hermes [--profile p] serve --host 127.0.0.1 --port 0` with `...process.env`, `HERMES_HOME?`, a session token and `HERMES_DESKTOP=1` (`apps/desktop/electron/embedded-host.ts:423-437`).
- Connections are held per profile (`connect(profile)`).
- It borrows a running backend only via the opt-in `embedded-runtime.json` manifest (`:498-514`).
- The options interface already accepts Rhythm-supplied callbacks (`mediaConsent`, `openExternal`; `:32-43`).
- The embedded Desktop Settings UI writes Hermes' own `.env`, `auth.json` and `config.yaml` via its backend (`web_server.py:7922,11802`). That is Hermes-owned and stays as it is.

**Hermes env precedence**
- `$HERMES_HOME/.env` is loaded with `override=True` (`hermes_cli/env_loader.py:500`). A `.env` key therefore **beats** injected env.
- Inherited provider API keys are *not* scrubbed (`:114-145`).
- `secret_scope.get_secret` falls back to `os.environ` when multiplexing is off, which is the default for `hermes serve` (`agent/secret_scope.py:132-160`).
- Result: env injection works exactly when Hermes has no key of its own. That is the ownership rule we want.

**Memory vault**
- Guards in `memoryVaultWriteService.ts`: lexical plus lstat/realpath/inode checks (`:370-465`) and atomic `wx` tmp+rename (`:467-535`).
- `rememberToVault` (`:785-1045`) and `updateMemoryInVault` (`:1536-1620`) do read-modify-write **with no lock, even in-process**. Only `mutateMemoryLifecycle` is serialized (`:1047-1096`).
- Notes without frontmatter are indexed (`memory_note_format.ts:547-563`). `mutateMemoryLifecycle` would then stamp id/created/source onto such a note, which **enrols** it (`:1167-1169`).
- `index.md` is written with a plain `fs.writeFile` (`memory_vault_index_writer.ts:365`).
- There is no cross-process lock anywhere, and no `proper-lockfile` dependency.
- `/agent-memory` is unauthenticated under `AGENT_LOCAL` (`agentMemoryRoutes.ts:9`).

**Hermes memory lock:** Hermes locks with `fcntl.flock` on a persistent `<file>.lock` (`tools/memory_tool.py:279-300`). Node core has no `flock`, so a Node `wx` lockfile with the same name would *not* interoperate with it.

## Design

### Approaches

| | A. Rhythm writes `~/.hermes/.env` (issue's original) | **B. Host-brokered, in-memory capability grants (recommended)** | C. Loopback model-API proxy |
|---|---|---|---|
| Mechanism | Manifest-tracked `.env` keys; read `auth.json` for display | Main holds opt-in grants and hands granted static keys to Rhythm-spawned backends via a new `backendEnv` host option. Readiness comes from reading names only. | Hermes custom providers point at `127.0.0.1` with a per-launch token; Rhythm injects the credential on each request |
| Hermes store writes | Yes, into a foreign store | **None** | Needs `config.yaml` provider entries (foreign) |
| Key copies at rest | 2 plaintext copies, stale after rotation or revocation | **1** (Rhythm's) | 1 |
| Refresh tokens | Excluded by rule | Excluded by construction (`type:'api'` only) | Could forward OAuth, but that is a ToS and SSRF risk |
| Works offline / api_server down | Yes | Yes (main reads the file) | No. Hermes turns die with the api_server |
| Standalone Hermes | Covered | Not covered (non-goal) | Covered if configured |
| Cost / risk | Ownership manifest, take-over UX, per-profile `.env` ambiguity, shell exports look identical | Fork option + pin bump; restart needed to apply or revoke | Every wire protocol plus streaming; large new attack surface |

**Recommendation: B.** It is the smallest design that meets every constraint. It supersedes the issue's `.env`-write recommendation; decision D1 records this.

Two variants were rejected:
- A Hermes `SecretSource` plugin reading from a main-owned socket or fd. It needs `config.yaml` enablement and #1540's plugin install, and it gains nothing, because Hermes puts `.env` keys into `os.environ` anyway.
- stdin/fd handoff. Same reason: Hermes' own keys already live in its env.

### Components and boundaries

```text
Rhythm renderer (untrusted for secrets)
  └─ IPC rhythm:ai-accounts:hermes-status / hermes-grant   (ownsDocument, strict schema, DTOs without values)
Electron main (TCB: main + pinned Hermes host)
  ├─ hermes-accounts.mjs            names-only inspection of $HERMES_HOME/.env + version-gated auth.json keys
  ├─ hermes-credential-broker.mjs   grants store (userData, 0600) + resolveHermesBackendEnv({profile})
  │                                  reads ~/.local/share/opencode/auth.json, keeps type:'api' entries only
  └─ hermes-view.mjs → createEmbeddedHermesHost({..., backendEnv})
Pinned Hermes host (fork embedded-host.ts)
  └─ connect(profile): spawn env = sanitize(process.env) + filter(await backendEnv({profile})) + host-fixed keys
     (never called for borrowed runtimes)
Hermes backend (semi-trusted, prompt-injectable): granted static keys in env, plus RHYTHM_AGENT_URL only if memory-read is granted
  └─ plugins/rhythm rhythm_search_memory → GET http://127.0.0.1:<port>/agent-memory/search   (S6, after #1540)
api_server (owns Rhythm credentials + vault) ← unchanged credential paths; vault hardening in S5
```

**Env mapping.** Only `auth.json` entries with `type === 'api'` and a string `key` are eligible:

| Rhythm id | Hermes env var | Source |
|---|---|---|
| `openrouter` | `OPENROUTER_API_KEY` | #1569 table |
| `opencode` | `OPENCODE_ZEN_API_KEY` | Fork `hermes_cli/auth.py:466-471`. **UNVERIFIED:** that Rhythm's `opencode` id is OpenCode Zen. S2 proves it or drops the row. |
| `anthropic` (api type only) | `ANTHROPIC_API_KEY` | #1569 table |
| `openai` (api type only) | `OPENAI_API_KEY` | #1569 table |
| `google` (api type only) | `GOOGLE_API_KEY` | #1569 table (first-listed var) |

**Never read or forwarded:**
- any `type:'oauth'` entry;
- `anthropic-accounts.json`, `~/.gemini/*`, `~/.claude/*` and the Keychain;
- Copilot device tokens;
- the Rhythm session token and approval material.

**Grants file:** `userData/hermes-credential-grants.json`, mode 0600, atomic `wx` tmp+rename, symlinks rejected. It is created on first grant, and an absent file means no grants.

```json
{"schemaVersion":1,"grants":[{"rhythmUserId":"<id>","hermesProfile":"default","capability":"provider-key","provider":"openrouter","grantedAt":"<ISO>"},{"rhythmUserId":"<id>","hermesProfile":"default","capability":"memory-read","grantedAt":"<ISO>"}]}
```

**IPC contracts.** Both handlers are guarded by `ownsDocument`, and both return 403-style `{ok:false}` when there is no signed-in Rhythm user.

- `rhythm:ai-accounts:hermes-status`: no payload. Returns:
  `{schemaVersion:1, profile:'default', hermesHome:'ok'|'missing'|'unreadable', lastApplied:{at:ISO|null, providers:string[], memoryRead:boolean}, providers:[{provider, hermesEnvVar, rhythm:'api-key'|'oauth'|'none'|'unknown', hermesEnvFile:true|false|null, hermesAuthStore:true|false|null, granted, state:'shared'|'shared-pending-restart'|'shadowed-by-hermes'|'removed-pending-restart'|'not-shared'|'ineligible'}], claudeCode:'shared-upstream', memoryRead:{granted, state:'on'|'on-pending-restart'|'off'|'off-pending-restart'}}`
- `rhythm:ai-accounts:hermes-grant`: payload is exactly `{capability:'provider-key'|'memory-read', provider?:string, enabled:boolean}`; unknown keys are rejected. Enabling requires a native `dialog.showMessageBox` confirmation from main. The dialog text reads: "Hermes and its tools and plugins will be able to use and read this key until Hermes restarts". Returns the status DTO.

**Fork host option.** This is additive and optional, following the `mediaConsent`/`openExternal` precedent:

```ts
/** In-memory env for Rhythm-spawned backends only; never called for borrowed runtimes. */
backendEnv?: (request: { profile: string }) => Promise<Record<string, string>> | Record<string, string>
```

The host must enforce the following:
- 2 s timeout. On throw or timeout, spawn with **no** extras. Sharing never blocks Hermes start.
- Allowed names are `/^[A-Z][A-Z0-9_]*_API_KEY$/` or `RHYTHM_AGENT_URL`. Values must be strings of ≤ 4096 chars with no NUL/CR/LF.
- Strip inherited `HUMAN_APPROVAL_*` and `RHYTHM_RELAY_BEARER` from the `process.env` copy.
- Host-fixed keys (`HERMES_HOME`, `HERMES_DASHBOARD_SESSION_TOKEN`, `HERMES_DESKTOP`) are applied last.
- Injected values are added to `redactBackendLog`.

### Threat model

| Threat | Mitigation | Residual (stated honestly) |
|---|---|---|
| Rhythm renderer compromise (XSS) | No IPC returns values. Grants need the strict schema plus a native confirm dialog. | Pre-existing: `rhythm:auth:current-session` returns the session token to the renderer (`main.mjs:271-274`), and `POST /opencode/auth/:p` accepts keys. Filed as follow-up F1; not fixed here. |
| Hermes renderer / plugin-panel compromise | It has no Rhythm IPC, only the host MessagePort. The broker is unreachable from it. | Hermes' own `/api/env` reveal endpoint (`web_server.py:8438`) and process env expose granted keys **exactly as much as Hermes' own keys**. That is why sharing is opt-in per provider and the confirm copy says so. |
| Sidecar or agent-tool compromise (prompt-injected terminal) | Only the granted static keys are present. No refresh tokens, no session token (stripped), no approval material (stripped), no Keychain broker. | It can read granted keys from env. Same-UID code can read every credential file anyway, because macOS has no app sandbox (entitlements `mac.plist`) and same-user env is readable (xnu `kern_sysctl.c`). Same-UID malware is out of scope. |
| Tampered artifact or host | Existing pin, SHA manifest, symlink rejection. | Host runs as main (TCB). `OnlyLoadAppFromAsar` and library validation are off. #1570 owns publisher signing. |
| Symlinks / path traversal | Inspector: profile fixed to `default` (`~/.hermes`). `lstat` rejects symlinks, requires a regular file owned by `getuid()`, size ≤ 1 MiB, realpath confined to `~/.hermes`. Grants file uses the same checks. Vault keeps the existing guards; README and index use `validatedVaultDestination`. | None known. |
| Hermes `auth.json` schema drift (#1570 updates) | Read only `version` and the top-level `providers` key names. Unknown version, or any parse error, yields `hermesAuthStore:null`. The inspector never throws and never writes. | Display only. |
| Stale credentials / revocation | The DTO computes `*-pending-restart` from `lastApplied` versus the current grants and keys. Copy tells the user to revoke at the provider for real invalidation. | A running backend keeps the old key until restart, logout (the view is disposed) or quit. |
| Refresh-token races | OAuth is never shared. | **Pre-existing:** Claude Code, Rhythm (bridge plus engine plugin) and Hermes can all refresh and write back the Claude Code grant (`anthropic_adapter.py:1253-1260`). This plan doesn't worsen it. Follow-up F3. |
| Multi-user / profiles | Grants are keyed by `rhythmUserId` and `hermesProfile`, so a different Rhythm user gets none applied. v1 uses the `default` profile only. Other Hermes profiles never receive grants. | Stores and vault stay per OS user, which is pre-existing. |
| Secrets in logs, artifact or production | Names only, in every log or DTO. Redaction test. Artifact credential scan. Nothing is sent to the production API. | None. |
| Memory: external edit clobbered / untyped note rewritten | S5 digest CAS, refusal of untyped notes, index tmp+rename. | A millisecond window remains between the CAS check and the rename, marked with a `ponytail:` comment. |
| Memory: untrusted note text reaches Hermes | S6 tool is read-only, returns ≤ 10 items of ≤ 500 chars each, and labels content as untrusted data. | Pre-existing: a direct unauthenticated local `POST /agent-memory` bypasses the approval gate (it is only enforced in the MCP process, `external_content_boundary.ts:356-403`). Follow-up F2. S6 exposes no write path. |

### Lifecycle, restart and offline behaviour

| Event | Behaviour |
|---|---|
| First open of the Hermes tab | `connect('default')` calls `backendEnv`, main records `lastApplied`, then the backend starts. |
| Grant, ungrant, or key rotated or deleted while the backend runs | Status shows `*-pending-restart`. No auto-restart, because that would disrupt a running turn. The change applies on the next owned spawn: after logout/login (the view is disposed), after quit and relaunch, or after a backend crash and reconnect. |
| Borrowed backend (`embedded-runtime.json`) | `backendEnv` is not called and `lastApplied.at` stays null. Status reads "not applied: Hermes backend not started by Rhythm". |
| api_server down or borrowed | Broker is unaffected (it reads the file directly). The Rhythm column falls back to the existing route states. |
| Offline | Inspection and injection are both local. Provider calls fail as they do today. |
| Unreadable or corrupt opencode `auth.json` | No extras injected, and the status shows `rhythm:'unknown'`. Hermes still starts. |
| Old artifact | Impossible, because the exact pin couples Rhythm and host. If #1570 lands, `backendEnv` must be part of its `hostApiVersion` (noted there). |

### Migration and backward compatibility

- No data migration. An absent grants file behaves exactly like today, and no Hermes files are touched.
- `.env` keys keep precedence and show as `shadowed-by-hermes`. On this machine, `.env` already defines OpenRouter and Google keys (#1569 Finding 2), so those rows will read "Hermes uses its own key".
- Vault behaviour changes:
  - A read-modify-write whose note changed on disk retries once, then returns 409 `MEMORY_NOTE_CONFLICT`.
  - Lifecycle, update, forget and merge refuse notes with no valid frontmatter (`MEMORY_NOTE_UNMANAGED`).
  - `README.md` is created once in `AGENT-MEMORY` and never rewritten.
  - This is intended fail-closed behaviour. It becomes visible in the real vault only after AJ installs a build.
- The issue's own acceptance criteria are amended by D1–D3 below. Every other issue criterion is kept.

### User journeys

Entry point: Rhythm Mega Desktop Candidate (Electron), Settings → Agent Settings → Accounts (`apps/web/src/components/tools/AgentSettingsTool.tsx`).

| Job | Visible success | Slice |
|---|---|---|
| J1: See what each app can use | Each provider row shows a Rhythm state, a Hermes state, and a source label (Rhythm / Hermes `.env` / Hermes sign-in / Claude Code Keychain) | S1, S4 |
| J2: Share my OpenRouter key with Hermes | Toggle, confirm, then "Shared: applies next Hermes start". After restart, a Hermes prompt uses it | S2, S3, S4 |
| J3: Stop sharing | "Removed: Hermes keeps it until restart". After restart the key is gone from Hermes | S2, S4 |
| J4: Hermes already has its own key | Row reads "Hermes uses its own key (set in Hermes)" and the toggle is labelled shadowed | S1, S4 |
| J5: Claude subscription | Row reads "Rhythm uses your Claude Code sign-in (macOS Keychain). Hermes uses the same sign-in when its Anthropic provider is set to Claude Code. Managed by Claude Code." Hermes only auto-discovers it when configured (fork `credential_pool.py:2514-2524`), so no stronger claim is made. | S4 |
| J6: Let Hermes search Rhythm memory | Toggle is off by default. With it on, a Hermes agent's `rhythm_search_memory` returns Rhythm notes. With it off, the tool reports "disabled in Rhythm" | S2, S3, S6 |
| J7: A Hermes agent or Obsidian edits a note mid-update | Rhythm aborts and retries instead of clobbering, and untyped notes are never rewritten | S5 (no UI) |

## Decisions taken under AFK safe defaults (reversible; flagged for Astra/AJ)

- **D1:** Use in-memory host brokering instead of Rhythm writing `~/.hermes/.env`. This supersedes the #1569 criteria "Setting an API key writes `~/.hermes/.env`" and "Removing … removes only Rhythm-written `.env` keys". The new criteria are A-S2-1 and A-S2-3. S0 records a decision doc.
- **D2:** v1 supports the `default` Hermes profile only, grants keyed by Rhythm user. To add later: a profile picker.
- **D3:** Replace the criterion "`<path>.lock` sidecar matching `MEMORY.md.lock`" with in-process serialization of every read-modify-write path plus an optimistic digest check. Reasons:
  - Node has no `flock`.
  - A `wx` lockfile with Hermes' name gives false interop with Hermes' persistent flock files.
  - No cooperative external writer exists.
  - The CAS covers a second Rhythm process as well.
  - To add later: `proper-lockfile`-style mkdir locks, if two api_servers ever legitimately share a vault.
- **D4:** No auto-restart of Hermes on grant changes. To add later: a host `restartBackend(profile)`, if pending-restart proves confusing in smoke.
- **D5:** Memory access for Hermes is read-only search. Writes wait on F2.

## File structure map

**Rhythm (mega worktree)**

| File | Responsibility |
|---|---|
| `apps/electron/src/hermes-accounts.mjs` (new) | Names-only inspection of Hermes `.env` and `auth.json` for the default profile; safe file reads |
| `apps/electron/src/hermes-credential-broker.mjs` (new) | Grants store, the eligible-key reader for opencode `auth.json`, the env mapping, `resolveHermesBackendEnv`, `lastApplied`, and building the status DTO |
| `apps/electron/src/main.mjs` | Register the two IPC handlers (`ownsDocument`, strict schema, native confirm) |
| `apps/electron/src/preload.cjs` | Expose `rhythmShell.aiAccounts.hermesStatus()` and `rhythmShell.aiAccounts.setHermesGrant(p)` |
| `apps/electron/src/hermes-view.mjs` | Pass `backendEnv` (and the agent URL when memory is granted) into `createEmbeddedHermesHost` |
| `apps/electron/src/hermes-desktop-config.mjs` | Pin bump to the new fork commit (S3 hand-off) |
| `apps/electron/test/hermes-accounts.test.mjs`, `hermes-credential-broker.test.mjs` (new); `apps/electron/package.json` | Unit tests, appended to the explicit `test` script list |
| `apps/electron/test/hermes-credential-sharing-live.test.mjs` (new) | `RHYTHM_LIVE_E2E=1` behavioural gate (S7) |
| `apps/web/src/components/tools/AgentSettingsTool.tsx` | Hermes column, toggles, pending-restart copy, Claude Code note. Hidden when `window.rhythmShell.aiAccounts` is absent. |
| `apps/web/src/components/tools/aiAccountsBridge.ts` (new) | Local-intersection accessor and DTO types for `window.rhythmShell.aiAccounts`, following the pattern in `apps/web/src/pages/hermes/bridge.ts` |
| `apps/web/tests/pages/agent-settings-list-inspector.spec.ts` | Accounts cases J1–J5 with a stubbed `rhythmShell.aiAccounts`, run through `tests/agent-settings-accounts-playwright.config.ts` |
| `apps/api_server/src/services/memoryVaultWriteService.ts` | Digest-CAS parameter on `writeVaultNoteAtomic`; locking and CAS on `rememberToVault`/`updateMemoryInVault`/`mutateMemoryLifecycle`/`forgetFromVault`; untyped-note refusal; merge-candidate filter |
| `apps/api_server/src/services/memory_vault_index_writer.ts` | `index.md` tmp+rename; `README.md` create-if-absent (`wx`) |
| `apps/api_server/src/services/memory_vault_log.ts` | Digest CAS on `log.md` read-modify-write |
| `apps/api_server/src/services/memoryVaultSyncService.ts` | Skip root `README.md` like `index.md`/`log.md` |
| `apps/api_server/src/__tests__/memory_vault_external_edit.test.ts`, `memory_vault_external_edit_live_e2e.test.ts` (new) | Unit tests and the `RHYTHM_LIVE_E2E` sandbox gate |
| `docs/ai/decisions/2026-09-24-hermes-credential-broker.md`, `docs/ai/contracts/issue-1569.json` (new) | D1–D5 and the acceptance IDs |

**Hermes fork (`hermes-rhythm-plugin`)**

| File | Responsibility |
|---|---|
| `apps/desktop/electron/embedded-host.ts` | `backendEnv` option, sanitize/strip/redact, never for borrowed runtimes |
| `apps/desktop/electron/embedded-host.test.ts` | Spawn-env assertions against a fake `hermes` binary that dumps env *names* |
| `plugins/rhythm/` (S6 only, after #1540) | Read-only `rhythm_search_memory` over a loopback-validated `RHYTHM_AGENT_URL` |

## Issue table

**Where each slice lands:**
- Rhythm slices go onto the mega branch and draft PR #1544, each from its own isolated worktree off `e93eac6e`.
- Fork slices S3 and S6 go onto fork branch `mega/2026-09-18-rhythm-plugin-finish` (PR17).
- The S3 pin bump is a Rhythm commit made only after the fork commit exists and the artifact has been rebuilt from it.
- S6's plugin edits are sequenced after #1540's plugin work, never alongside it.

Parallel groups: **{S1, S3, S5}** own disjoint files and can start together. S2 needs S1 and uses the S3 interface. S4 needs S1 and S2. S6 needs S2, S3 and #1540. S7 needs everything it qualifies.

| # | Slice | Likely files | Acceptance (falsifiable) | Depends | Required validation |
|---|---|---|---|---|---|
| S0 | Decision and contract | `docs/ai/decisions/2026-09-24-hermes-credential-broker.md`, `docs/ai/contracts/issue-1569.json` | Decision records D1–D5 and the rejected A/C. Contract lists every A-* ID below with its command. #1569 gets a comment linking to both. | none | Doc review by Astra |
| S1 | Hermes readiness inspector + status IPC | `hermes-accounts.mjs`, `main.mjs`, `preload.cjs`, `test/hermes-accounts.test.mjs`, `package.json` | **A-S1-1:** a fixture `.env` with `OPENROUTER_API_KEY=sk-synthetic-XYZ` yields `hermesEnvFile:true`, and the serialized DTO does not contain `sk-synthetic-XYZ`. **A-S1-2:** a symlinked `.env`, a file owned by another uid, or one over 1 MiB yields `null`. **A-S1-3:** `auth.json` `version` 999 or a truncated file yields `hermesAuthStore:null` for every provider, with no throw. **A-S1-4:** after inspection the fixture tree's (path, size, mtime, sha256) set is identical. **A-S1-5:** IPC from a non-owning sender, a subframe, or with any payload is rejected. | none | `cd apps/electron && npm test && npm run typecheck` |
| S2 | Grants store + backend-env broker | `hermes-credential-broker.mjs`, `main.mjs`, `preload.cjs`, `hermes-view.mjs`, `test/hermes-credential-broker.test.mjs` | **A-S2-1:** with a grant for `openrouter` and a fixture opencode `auth.json` of `{openrouter:{type:'api',key:K}, openai:{type:'oauth',refresh:R,access:A}}`, `resolveHermesBackendEnv({profile:'default'})` returns exactly `{OPENROUTER_API_KEY:K}`. R and A never appear, even when `openai` is granted. **A-S2-2:** a different `rhythmUserId`, or profile `work`, yields `{}`. **A-S2-3:** removing the grant makes the next call return `{}`, and the status shows `removed-pending-restart` until the next call. **A-S2-4:** the grants file is mode 0600, a symlinked grants path is refused, and a corrupt file means no grants. **A-S2-5:** an enable payload with an extra key, or without native confirmation (the test stubs the dialog to "Cancel"), leaves the grants unchanged. **A-S2-6:** the `opencode`→`OPENCODE_ZEN_API_KEY` mapping is proven from the opencode provider id source or the row is removed. | S1; S3 interface | `cd apps/electron && npm test && npm run typecheck` |
| S3 | Fork: `backendEnv` host option + pin | Fork `embedded-host.ts`, `embedded-host.test.ts`; artifact rebuild; Rhythm `hermes-desktop-config.mjs` | **A-S3-1:** the fake `hermes` binary's recorded env names include `OPENROUTER_API_KEY` when supplied, and exclude `DYLD_INSERT_LIBRARIES`, `PATH` overrides, `HUMAN_APPROVAL_X` and `RHYTHM_RELAY_BEARER`. **A-S3-2:** a `backendEnv` that throws or takes more than 2 s still results in a spawned backend with no extras. **A-S3-3:** a borrowed runtime never invokes `backendEnv`. **A-S3-4:** an injected value printed by the child appears as `[redacted]` in the host log. **A-S3-5:** the standalone Desktop path is unchanged, i.e. the existing fork desktop tests pass. **A-S3-6:** the rebuilt artifact passes `resolveHermesDesktopArtifact` with the new pin, and the artifact credential scan finds no secrets. | none (interface frozen in this plan) | Fork: `cd apps/desktop && npx vitest run electron/embedded-host.test.ts electron/embedded-host-initialization.test.ts && npm run typecheck`; Rhythm: `cd apps/electron && node --test test/hermes-desktop-artifact.test.mjs test/hermes-view.test.mjs` |
| S4 | Accounts UI | `AgentSettingsTool.tsx`, `aiAccountsBridge.ts`, `tests/pages/agent-settings-list-inspector.spec.ts` | Each of J1–J5 renders the exact state copy from the DTO. The Hermes column is absent when `rhythmShell.aiAccounts` is undefined (browser build). The toggle for an `oauth` provider is not rendered (it shows "Sign in inside Hermes"). No DTO value or Rhythm key reaches the DOM (asserted against a synthetic key). | S1, S2 | `cd apps/web && npm run typecheck && npx playwright test --config tests/agent-settings-accounts-playwright.config.ts && npm run test:electron-slices` |
| S5 | Vault external-edit safety | `memoryVaultWriteService.ts`, `memory_vault_index_writer.ts`, `memory_vault_log.ts`, `memoryVaultSyncService.ts`, tests | **A-S5-1:** a test edits the note on disk between the read and write of `updateMemoryInVault`, `mutateMemoryLifecycle` and `rememberToVault` merge. The external bytes survive and the call retries once, then returns `MEMORY_NOTE_CONFLICT`. **A-S5-2:** verify, deprecate, update, forget or merge against a note without frontmatter leaves its bytes unchanged and returns `MEMORY_NOTE_UNMANAGED`. The note is still returned by search. **A-S5-3:** two concurrent in-process `rememberToVault` calls on the same slug produce one note containing both attributions. **A-S5-4:** `index.md` is never observed torn (tmp+rename). `README.md` is created once, is not overwritten after a user edit, and is not indexed. **A-S5-5:** no Hermes file or `~/.hermes` path is touched (the test HOME tree is unchanged). | none | `cd apps/api_server && npx vitest run src/__tests__/memory_vault_external_edit.test.ts src/__tests__/memory*.test.ts && npx tsc --noEmit`; live: `RHYTHM_LIVE_E2E=1` test through `tools/dev/sandbox.sh up`, which already sets `MEMORY_VAULT_PATH=$SB/vault` |
| S6 | Hermes read-only memory search | Fork `plugins/rhythm/*`; Rhythm `hermes-credential-broker.mjs` (`RHYTHM_AGENT_URL` only when `memory-read` is granted) | **A-S6-1:** with the grant on, the tool returns ≤ 10 items of ≤ 500-char snippets from the sandbox vault. **A-S6-2:** with the grant off (env absent) it returns "disabled in Rhythm" and makes no HTTP request. **A-S6-3:** a non-loopback `RHYTHM_AGENT_URL` is refused. **A-S6-4:** the plugin exposes no write or forget tool. | #1540 merged into fork branch; S2, S3 | Fork plugin tests (`pytest plugins/rhythm -q`); live sandbox query |
| S7 | Integrated qualification | `test/hermes-credential-sharing-live.test.mjs`; run log `docs/ai/runs/YYYY-MM-DD-1569-qualification.md` (execution date) | Details in the next section | S1–S5 (S6 if landed) | The qualification gates below |

## Qualification gates

1. **Sandboxed live behaviour** (`RHYTHM_LIVE_E2E=1`), all in temporary directories:
   - **Setup:** temp HOME; temp `HERMES_HOME` (default profile) whose temp `.env` sets `OPENROUTER_BASE_URL` (read at fork `hermes_cli/runtime_provider.py:1273`) to a local mock HTTP server; temp Rhythm userData; synthetic opencode `auth.json`; sandbox API/engine via `tools/dev/sandbox.sh up`.
   - **Grant:** grant `openrouter` and open the embedded host, then send one synthetic prompt. The mock asserts that `Authorization` carries the synthetic key (J2).
   - **Ungrant:** ungrant and restart. The mock now sees no Rhythm key (J3).
   - **Shadowing:** add `OPENROUTER_API_KEY=sk-hermes-own` to the temp `.env`. The mock sees `sk-hermes-own` and the status reads `shadowed-by-hermes` (J4).
   - **Invariants:** the hashes of temp `.env`, `auth.json`, `config.yaml` and `mcp-tokens/` are unchanged. Neither the host log nor the DTO contains a synthetic key.
2. **Packaged:** a locally signed candidate is rebuilt from the committed fork pin and launched with a clean `PATH`. `hermes-desktop-native.test.mjs` plus the new live test pass against the packaged app. This is local signing only, not notarization, which stays separate.
3. **Manual (AJ, real profile, observation only):**
   - Record before and after (size, mtime, sha256) for `~/.hermes/{.env,auth.json,config.yaml}`, without printing contents.
   - Open Accounts and confirm J1, J4 (OpenRouter and Google shadowed) and J5.
   - Verify the hashes are unchanged.
   - Optionally grant a provider Hermes lacks, restart, and confirm it works.
   - The Rhythm Google login and approval identity still work (the #1544 regression gate).
   - Steps go in `docs/testing/manual-smoke.md`.
4. **Pre-commit per slice:** GitNexus `detect_changes({scope:"compare", base_ref:"mega/2026-09-18-mobile-electron-hermes"})` shows only the expected symbols, and `ai-workflow checks --level pr` runs before the draft PR update.

## GitNexus impact (mega index @788e7ccc; fork index unavailable due to a LadybugDB version mismatch)

- `rememberToVault`: LOW, 2 direct callers.
- `mutateMemoryLifecycle`: LOW, 2.
- `updateMemoryInVault`: LOW, 1.
- `writeVaultNoteAtomic`: LOW, 3 direct / 13 total.
- `regenerateMemoryVaultNavigation`: **MEDIUM**, 7 direct / 19 total. S5 changes only its write primitive (tmp+rename) and README creation, and the navigation writer's own tests must pass unchanged.
- `registerHermesView`: LOW, 1.
- No execution flows affected.
- Before S3, rerun `impact` for fork `createEmbeddedHermesHost`/`createSpawnRuntime` after `node .gitnexus/run.cjs analyze` in the fork.

## Doubt review

**What would make B wrong:**
1. `hermes serve` scrubs or ignores inherited provider env under some config. Seen so far: `.env` override plus `get_secret` fallback, with multiplexing off by default.
2. The embedded Desktop uses a profile-multiplexing gateway rather than per-profile `serve`.
3. Hermes Desktop's provider readiness UI reads only `.env`, so injected keys work but *look* unconfigured inside Hermes, which would confuse users.

**Cheapest probe:** the first S3 test runs the real installed `hermes serve` under a temp `HERMES_HOME` with an injected synthetic `OPENROUTER_API_KEY`. It calls `GET /api/providers` or the model list with the session token and records whether OpenRouter reports as configured. Run it before S2/S4 build UI on the assumption. If (3) holds, S4's copy says "Shared from Rhythm (Hermes settings may show Not set)".

**Primary sources checked:**
- fork `hermes_cli/env_loader.py:470-555`, `agent/secret_scope.py:132-160`, `apps/desktop/electron/embedded-host.ts:410-470`;
- RFC 9700 §4.14.2;
- xnu `kern_sysctl.c` (same-user env readability);
- MCP authorization spec 2025-06-18 "Access Token Privilege Restriction" / token passthrough (supports never forwarding Rhythm's tokens);
- `proper-lockfile` README and the Node `fs` API (no `flock`, supporting D3).

## Coverage matrix (issue #1569 acceptance criteria → slice)

| Issue criterion | Slice / ID |
|---|---|
| Keychain link confirmed | Done during planning (`credentials_bridge_service.ts:327`); recorded in S0 |
| Never opens `~/.hermes/auth.json` for writing, with a test | A-S1-4, gate 1 hash invariant |
| Accounts lists, per provider, holder and source | S4 (J1) |
| API key takes effect in Hermes on next start | **Amended (D1)** → A-S2-1, gate 1 J2 |
| Hermes-owned `.env` key never replaced | A-S1-4, J4, gate 1 shadowing |
| Removing in Rhythm removes only Rhythm-written keys | **Amended (D1)** → A-S2-3, gate 1 J3 |
| `.env` atomic/0600/preserve lines | **Moot (D1):** no `.env` writes. Replaced by A-S2-4 for the grants file |
| Unknown `auth.json` version degrades | A-S1-3 |
| No refresh token in any Hermes store | A-S2-1, gate 1 hashes |
| No credential value logged or sent | A-S1-1, A-S3-4, S4 DOM check, gate 1 |
| `<path>.lock` sidecar | **Amended (D3)** → A-S5-1, A-S5-3 |
| Digest-drift abort with external-edit test | A-S5-1 |
| Untyped note indexed, never rewritten | A-S5-2 |
| `index.md`/`log.md` Rhythm-owned + README | A-S5-4 |
| Nothing writes into `~/.hermes` | A-S5-5, gate 1, gate 3 |
| No Hermes SQLite read or write | Implied by construction (no code path touches them). Gate 1 also hashes `state.db` presence and size in temp `HERMES_HOME` before and after the Rhythm-only steps |

## Follow-ups (out of scope, to file separately)

- **F1:** `rhythm:auth:current-session` returns the raw session token to the renderer (`main.mjs:271-274`).
- **F2:** the unauthenticated local `POST/PATCH/DELETE /agent-memory` bypasses the MCP-side approval gate.
- **F3:** three refreshers share the single-use Claude Code refresh token (Claude Code, Rhythm, Hermes).
- **F4:** the embedded host inherits the whole Electron main env. S3 strips only the known Rhythm secrets; a full allowlist would be the upgrade.

## Open questions

None blocking. D1–D5 are the AFK defaults; Astra should challenge D1 and D3 specifically.

Recommend a fresh context for Sol implementation, starting with S0, then S1/S3/S5 in parallel worktrees derived from mega. This planning run produced large exploration output.
