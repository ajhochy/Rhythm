---
name: customize-rhythm
description: Use when configuring the Rhythm app's agent engine — agent profiles, skills, MCP/tool scope, scheduled tasks, playbooks (slash-commands), or recipes. Rhythm is a fork of opencode with DB-backed agent profiles and a hot-reload API; this documents how those actually work, correcting the generic customize-opencode skill. Use ONLY for the Rhythm fork, not vanilla opencode.
---

# Customizing Rhythm (the opencode fork)

Rhythm embeds a **forked opencode engine** driven by a local API server (`rhythm-api-server`, default `http://localhost:4001`). The generic `customize-opencode` skill describes *vanilla* opencode and is correct about the base config schema — but it is **wrong or incomplete** about several Rhythm behaviors. This skill is the source of truth for the fork. When they disagree, this one wins.

## The single most important correction: hot reload, no restart

The generic skill says "config is loaded once at startup — tell the user to quit and restart." **In Rhythm that is false.** The fork memoizes its global config (the agent registry) and skill discovery with an effectively infinite TTL, and exposes an endpoint to invalidate both:

```
POST http://localhost:4001/system/refresh
```

Returns `{"status":"ok","refreshed":["skills","agent-profiles"]}`. It calls the engine's `reloadSkills()` (re-scans the skills dir) and `reloadConfig()` (re-merges agent `.md` files). On the local agent server, loopback is the trust boundary, so **no auth token is needed**; on hosted prod a Bearer session token is required.

**After editing any agent `.md`, skill `SKILL.md`, playbook, or recipe on disk, call `POST /system/refresh`** instead of asking the user to restart. Caveat: `/system/refresh` only invalidates the skill + agent-profile caches. Changes to the top-level `opencode.json` itself (plugins, MCP server definitions, providers) are NOT covered by that endpoint and still need an engine restart.

## Agent profiles ≠ hand-written agent files

In vanilla opencode you author `~/.config/opencode/agents/<name>.md` by hand. In Rhythm the **Agent Profile (a DB row in `agent_configs`) is the source of truth**, and the `.md` file is a *projection* written by the api_server (`opencode_agent_writer.ts`) whenever a profile is saved in the designer. Editing the `.md` by hand works and is respected on merge, but a later profile save will re-project over the managed keys.

**How a profile projects into the `.md` frontmatter:**

| Profile field (DB) | Becomes in `.md` |
|---|---|
| `label` | `description:` (only seeded if absent — a richer existing description is preserved) |
| `systemPrompt` | the file **body** (skipped by a prompt-injection context scan; a flagged prompt is NOT written) |
| `modelProvider` + `modelId` | `model: provider/id` |
| `schedulable` (falls back to `sessionSelectable`) | `mode: all` if true, else `mode: subagent` |
| `corePermissionsJson` | the `permission:` block (bash/read/edit/etc. — action string or `{pattern: action}` map) |
| `allowedMcpsJson` | `options.mcpAllowlist` (expanded) |
| `allowedSkillsJson` | `options.skillAllowlist` |
| `reasoningEffort` | `options.effort` |
| `imageGenerationEnabled` | `permission.image_generation: allow` |
| `isManager` + `allowedDelegatesJson` | `permission.task` map + a routing preamble prepended to the body |

**`mode` semantics (fork-specific):** the enum is `subagent | primary | all`. A **schedulable** profile is written `all` (runnable headless via `agent: <id>` AND delegatable via the `task` tool). A non-schedulable one stays `subagent` (delegation only). Scheduling a `subagent`-mode profile is blocked at config time, because the engine throws "Agent not found" when resolving a subagent as a top-level `agent:` target.

**Reserved ids never projected:** the opencode built-ins `build, plan, explore, general, compaction, summary, title`, and the CLI model-selector presets `claude-code, codex, gemini-cli, opencode`. Don't create profiles with those ids.

**Merge safety:** when the `.md` already exists, only the managed keys (`description`, `mode`, `model`, and the profile-derived permission/options keys) are updated; any *other* frontmatter you added by hand (extra permission keys not in the profile, `color`, etc.) is preserved, and the body is kept if the profile has no `systemPrompt`. Stale permission keys no longer in the profile are pruned so a reduced config converges.

**Local-only:** projection runs on the local SQLite deployment only. Production Postgres has no local engine, so `shouldWriteAgentFile` is a no-op there.

## Frontmatter that survives BOTH parse paths (or you 500 the whole engine)

This is as load-bearing as hot reload. A **single** malformed agent `.md` can take down the **entire** agent config load — not just its own agent — leaving every session stuck on "Starting" and MCP listing at 502. Whenever you hand-write or hand-edit an agent `.md`, the frontmatter must be valid in **both** of the loader's parse paths.

**How the loader parses each agent `.md` frontmatter:**
1. **Strict YAML first.** If it parses, the object is schema-checked.
2. **Permissive fallback on throw.** If strict YAML *throws*, a fallback sanitizer runs: it rewrites any **top-level** `key: value` whose value contains a colon into a `|-` block-scalar **string**, then re-parses.
3. **Two very different failure modes:**
   - A **parse** failure (nothing usable comes out) = that one file is **skipped** — the agent silently goes missing.
   - A **parse-OK-but-schema-invalid** file = **FATAL**. The loader throws, killing the whole agent config load → the engine **500s** → every session hangs on "Starting" and MCP listing **502s**.

The dangerous route is (2)→(3): a `description` with a stray colon-space makes strict YAML throw, the fallback stringifies your inline-JSON `options`, the schema then rejects a string where it wants an object, and the **entire runtime goes down**. (Real incident: one agent's `description` held a `": "`; its `options: {...}` inline JSON got stringified by the fallback → schema fail → all sessions dead, MCP 502.)

So author frontmatter that is valid in **both** paths. Six rules:

**1. `options` is ALWAYS nested YAML — never inline JSON, never a quoted string.**

GOOD:
```yaml
options:
  mcpAllowlist:
    servers:
      - rhythm
    tools: []
  skillAllowlist:
    skills:
      - some-skill
```
BAD (a scalar on the `options:` line — the fallback turns it into a STRING, schema wants an object → FATAL):
```yaml
options: {"mcpAllowlist":{"servers":["rhythm"],"tools":[]}}
```
WHY: with nested YAML the `options:` line has an **empty value** and the indented children are continuations — both the strict parser and the fallback sanitizer preserve that as an object. Inline JSON is a single scalar *on* the `options:` line, so the fallback (which only asks "does the value contain a colon?") rewrites the whole thing to a `|-` string.

**2. Never leave an unquoted colon-space `": "` inside a plain scalar value.**

Especially in `description` — a bare `": "` is exactly what makes strict YAML throw and drops the file into the fragile fallback path. If a colon is needed, wrap the **entire** value in double quotes:
```yaml
description: "Runs end-to-end: discovery, planning, build."
```
Em-dashes, periods, and commas in a plain scalar are fine — `": "` (colon then space) is the specific hazard.

**3. Any map KEY that starts with a YAML indicator char must be quoted — the wildcard key is always `"*"`, never bare `*`.**

GOOD: `"*": ask`
BAD: `*: ask`  ← `*` begins a YAML **alias**, so this is a parse error.
Same for keys beginning with `& ? : - { } [ ] , # | > ! % @` or a backtick.

**4. A permission sub-key with nested rules is a MAPPING with NO scalar after the colon.**

GOOD (per-item rules):
```yaml
permission:
  skill:
    "*": deny
    systematic-debugging: allow
```
GOOD (no per-item rules — flat form):
```yaml
permission:
  skill: allow
```
BAD (invalid "bad indentation" — a scalar `allow` AND child keys under the same key):
```yaml
permission:
  skill: allow
    "*": deny
```

**5. One frontmatter block, no duplicate keys, consistent 2-space indent.**

Exactly ONE `--- … ---` block at the top of the file — never stack two. Never repeat a key inside the same mapping. Indent in steps of 2 spaces, spaces only (never tabs).

**6. Scope the allowlists to least privilege.**

`mcpAllowlist.servers` should list ONLY the MCP servers the agent actually needs — this both shrinks blast radius AND avoids loading a server whose tool schemas a given model may reject (a rejection can be what tips a file into the failure path above). `tools: []` means "no per-tool narrowing" — all tools of the allowed servers are exposed; list tool names to narrow further. Same idea for `skillAllowlist.skills`: only the skills the agent needs.

**Validate before you ship.** Don't trust "it looks fine" — replay the loader and assert `options` parses to an **object**. Use the on-disk js-yaml:
```
JSY="$HOME/.config/opencode/tools/node_modules/js-yaml"   # the js-yaml Rhythm seeds alongside the config-doctor tools
```
In a Node script: read the file, slice the frontmatter between the first `---\n` and the next `\n---`, `yaml.load` it strict; on throw, apply the fallback sanitizer (each top-level `key: value` whose value contains a colon → a `|-` block scalar) and `yaml.load` again; then assert `typeof parsed.options === 'object'`. If that assertion fails, the file would 500 the engine — fix it before it goes live.

**And note:** editing an agent `.md` does NOT take effect via `/config/reload` (the generic endpoint) — it never re-reads agent files. Profile-file frontmatter changes are only guaranteed to apply on a **fresh boot**, so **the Rhythm app must be relaunched** to pick up a hand-edited profile (and to recover the runtime if a bad `.md` has already 500'd the config load — at that point `/system/refresh` can't help, since the engine is already down). `/system/refresh` covers the skill + agent-profile caches, but a full relaunch is the sure path for profile frontmatter.

## Managers, delegation, and the routing preamble

A profile with `isManager: true` gets:
- `permission.task` = `{ "*": "deny", <each delegate id>: "allow" }` — fail-closed delegation scoped to `allowedDelegatesJson`.
- A **routing preamble** prepended to its body. Two variants: a *hub* preamble (when it has a non-empty delegate roster — handle-directly-by-default, delegate only when a specialist is materially required) and a *dev-only* preamble (no roster — hand coding work to `workflow-orchestrator`). `workflow-orchestrator` itself gets a self-safe variant so it never delegates to itself.

Delegation uses the engine-native **`task` tool** with `subagent_type="<agent-id>"` (a real nested subagent), **not** the `rhythm_delegate` MCP tool (which creates an orphaned top-level session with no parent link). Always name the specialist explicitly; never `"general"`, never omit `subagent_type`.

## Skills — the sole source is `~/.config/opencode/skills`

Rhythm manages `~/.config/opencode/skills` directly and it is the **only** skill source the model loads (decision #947). Key facts that differ from the generic skill:

- The engine **auto-scans** `~/.config/opencode/{skill,skills}/**` via its hardcoded config-dir scan, so this dir needs **no `skills.paths` registration**. (An explicit `skills.paths` entry pointing at it is harmless but redundant.)
- Rhythm sets `OPENCODE_DISABLE_EXTERNAL_SKILLS=1` on the engine, so `~/.claude/skills` and `~/.agents/skills` are **NOT** scanned (the generic skill lists these as auto-loaded — untrue in Rhythm). Skills are imported into the managed dir explicitly, never blanket-pulled.
- Skills are keyed by frontmatter **`name`**, not by directory name. The dir is just a filesystem-safe slug.
- A skill body is **prompt-injection scanned** before write; a flagged body is refused (the file is not written).
- Reserved subfolders inside the managed dir are NOT live skills (no `SKILL.md` at their root, invisible to the engine): `drafts/` (harvested candidate skills), `disabled/` (archived bad harvests), `.rhythm-rollback-snapshots/` (pre-apply byte snapshots for auto-revert).
- **Org skills**: a shared library hosted on the production API at `<prodBase>/org-skills` in the engine's `skills.urls` index format (`index.json` listing `{name, files[]}` + per-file GET). Point the engine's `skills.urls` at that base to pull the org library. Reads are unauthenticated by design; publishing requires auth. (This is a real use of `skills.urls` — distinct from the local dir, which needs no registration.)

**Per-agent skill scope (the enforced gate):** an agent can load a skill only when it is BOTH (a) in that agent's `allowedSkillsJson` allowlist AND (b) an enabled/discovered skill whose frontmatter `name` matches exactly. `null` allowlist = unrestricted; `[]` = deny-all (agent gets NO skills). The **three-name contract** (issue #958): the name referenced in the agent's body prose, the entry in its allowlist, and the live skill's frontmatter `name` must all match, or the agent silently runs without the skill.

## MCP / tool scope

Two allowlist shapes are accepted for `allowedMcpsJson`:
1. **Server-name array**: `["rhythm","gmail-work"]` → each named server included with all its tools.
2. **Tools-map**: `{"rhythm":["rhythm_list_tasks"]}` → explicit per-server tool allowlist.

Contract: `null` = **unrestricted** (all tools); any present-but-malformed/empty value = **deny-all** (never fail-open). Deny-all is a valid, logged, degraded state (agent gets no MCP tools that run). This expands into `options.mcpAllowlist` on the projected `.md` so the `task` tool can scope delegated subagent sessions too.

Those `allowedMcpsJson` shapes above are the **DB column** values (JSON is correct there). When they land in a hand-edited `.md`, `options.mcpAllowlist` must be **nested YAML**, never inline JSON — see "Frontmatter that survives BOTH parse paths." List only the servers an agent truly needs (least privilege): it shrinks blast radius and avoids loading a server whose tool schemas a model may reject.

Never put core tools (`bash`, `read`, `edit`, `filesystem`, `computer`, `editor`) in an MCP allowlist — those are opencode **core permissions** (`corePermissionsJson` → `permission:` frontmatter), not MCP server names. MCP scope names are case-sensitive: `rhythm`, never `Rhythm`.

## Scheduled tasks

Rows in `agent_scheduled_tasks`; a cron tick (every minute) finds `next_run_at <= now` and inserts a `pending_claude_triggers` row that the trigger watcher runs through the normal engine path (tasks emit triggers — they never run a shell directly). Schedule types: `daily | weekly | monthly | cron | once`.

**Scope inheritance:** a scheduled task **inherits its bound profile's MCP + skill scope at run time**. The task's own `allowedMcps`/`allowedSkills` are only an **override** — omit them to inherit (recommended), set them to narrow for that run. Same for model: omit to use the profile's model, set `modelProvider`+`modelId` together to override. The bound profile must be schedulable (`mode: all`).

## Playbooks = custom slash-commands (OCU-09)

Playbooks are engine slash-commands stored at `<config-dir>/commands/<name>.md`, CRUD'd via `/opencode/commands` (list/content/create/PUT/delete). Kebab-case names; a create that collides with a built-in / MCP-prompt / skill-sourced command is refused (409). Only Rhythm-managed command files are editable/deletable — built-ins (`init`, `review`), MCP-prompt, and skill-sourced commands are read-only. Frontmatter keys modeled: `description`, `agent`, `model`, `subtask`; unknown keys are preserved on edit. Each write/delete triggers a `reloadConfig()` so it goes live without restart.

## Recipes = the cookbook (`agent_cookbook`)

A recipe is a DB row (`agent_cookbook`) holding a `title`, `description`, `stepsJson` (an array of steps), and optional `boundConfigId`. CRUD via `/agent-cookbook`; `POST /agent-cookbook/:id/run` **compiles the description + steps into a single prompt** and runs it through AgentRunner as a session. Recipes are reusable multi-step prompt patterns — distinct from playbooks (slash-commands) and from skills (loadable instruction modules). The org-optimizer can propose `create-recipe`/`refine-recipe` from repeated cross-session prompt patterns.

## Quick reference — what lives where

| Concept | Storage | Edit surface | Goes live via |
|---|---|---|---|
| Agent profile | `agent_configs` DB row → `~/.config/opencode/agents/<id>.md` | designer / REST `/agent-configs` (or edit `.md`) | `POST /system/refresh` |
| Skill | `~/.config/opencode/skills/<slug>/SKILL.md` (sole source) | file / REST `/opencode/skills` | `POST /system/refresh` |
| Org skill | production API `/org-skills` | authenticated publish | engine `skills.urls` pull |
| MCP / tool scope | profile `allowedMcpsJson` / `corePermissionsJson` | designer / REST | re-projected on save + `/system/refresh` |
| Scheduled task | `agent_scheduled_tasks` | REST `/agent-schedules` | scheduler tick |
| Playbook (slash-command) | `<config-dir>/commands/<name>.md` | REST `/opencode/commands` | `reloadConfig()` on write |
| Recipe | `agent_cookbook` DB row | REST `/agent-cookbook` | run compiles to a prompt |

## When editing config

- The base `opencode.json` schema still applies — for field shapes, defer to the generic `customize-opencode` skill and `https://opencode.ai/config.json`. This skill only covers the **Rhythm-specific** layer on top.
- Prefer the **DB/designer/REST** path for anything profile/skill/recipe/playbook-related, since those are the sources of truth. Hand-editing the projected `.md` works but can be overwritten on the next save.
- If you DO hand-edit an agent `.md`, obey "Frontmatter that survives BOTH parse paths" — nested-YAML `options`, quoted `"*"` keys, no bare `": "` in scalars — and validate before shipping. A single malformed profile 500s the whole engine, not just its own agent.
- After any on-disk change to agents or skills, `POST http://localhost:4001/system/refresh` — do **not** tell the user to restart (that's the vanilla-opencode instruction and is wrong here). Only genuine `opencode.json` plugin/MCP/provider changes need a restart.
