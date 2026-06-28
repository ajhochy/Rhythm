---
date: 2026-06-28
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
supersedes: ["#779"]
builds-on: ["#775", "#778"]
---

# Unify to ONE skill source (engine SKILL.md) + run self-improvement on ALL engine skills via propose → review → apply

## Context

PR #778 (`docs/ai/decisions/2026-06-28-unify-skills-source-of-truth.md`) made the opencode
engine's filesystem `SKILL.md` store the single source of truth that the model loads, and
added: `GET /opencode/skills` (proxy of the fork's `GET /skill`, with a `managed` flag), a
Rhythm-managed dir (`~/.config/opencode/rhythm-managed-skills`, additively registered via
`config.skills.paths`), `POST /skill/reload`, and **materialize-on-publish** for DB skills
(`skill_materializer.ts`). #775 (PR #776) enforces per-session `skillAllowlist` in the fork,
keyed on the SKILL.md `name`. `smoke_skill_alignment.sh` guards that derived allowlist names
stay a subset of the live `GET /skill` names (no-skill-lost + names-alignment).

Two skill stores still exist, joined only by the one-way publish pipeline:

- **Engine skills (System A)** — `OpencodeSkillEntry { name, description?, location, managed }`
  via `GET /opencode/skills`. The store the model actually loads. `managed` (Rhythm-owned,
  editable/deletable inside the managed dir) vs `external` (discovered: plugins,
  `~/.claude/skills`, superpowers, anthropic-skills — read-only). Surfaced + authored in the
  Agent Profile sheet picker (`_agent_profile_sheet.dart` + `_managed_skill_editor_sheet.dart`
  + `OpencodeSkillsDataSource`).
- **Self-improvement skills (System B)** — `AgentSkill` rows in `agent_skills`
  (`+ agent_skill_versions` history) via `GET /agent-skills`. The self-learning loop's
  proposed/curated skills: `confidence`, `version`, `status` (draft|published), `source`,
  `uses`, append-only version history + rollback. Proposed by `skill_extractor.ts`
  (distill from session), scored/judged by `skill_refiner.ts` (LLM "better/equal/worse"
  verdict, `reviseInPlace` on win), retrieved by `skill_retrieval.ts::buildSkillsPreface`
  (an **inert prompt hint**, never the capability gate). Surfaced in the standalone Skills
  menu (`agent_skills_view.dart` → `AgentSkillsController`, nested under Agents → Tools).

**The user's vision:** ONE skill source (engine `SKILL.md`); the self-improvement loop
improves **ALL** engine skills — handwritten, imported, external/discovered, AND managed —
not just its own DB staging rows; the standalone Skills menu surfaces ALL skills (one unified
list) with the right authoring/scope/publish/history actions. *"1 skill source,
self-improvement applying to all of them, even handwritten or imported ones."*

This is the skills twin of #783 (MCP unification) but bigger: it touches the self-improvement
loop, not only UI. It **subsumes #779** (de-hardcode/convert the standalone menu). #780's
ellipsis hardening already shipped.

### Prior art (synthesized from a research swarm — see current-plan.md `## Prior Art`)

Self-improving-skill-editor projects (BerriAI/self-improving-agent, Skill Evolver,
Microsoft SkillOpt, SICA/ICLR-2025) converge on three points that directly resolve our
design tensions:

1. **Metadata: hybrid.** Keep stable, portable, human-relevant identity in YAML frontmatter
   (name, description, version, status). Keep evolution data (confidence, rationale,
   before/after, trigger evidence, scores) in a **sidecar store** — frontmatter drift and
   merge conflicts are the recognized downside of putting churning metadata in-file.
2. **Narrow write scope.** Agents edit *skills only, never source code*, and an
   evidence/trigger reference is required before any edit.
3. **Propose → human-review → apply.** Minimal-diff, exact-match proposals; a draft/staging
   queue; a human-in-the-loop gate; a validation gate that must not regress before "apply."
   Failure modes to design against: instruction bloat, contradictory one-off fixes,
   runaway/kitchen-sink edits, and **corrupting hand-written files when a snippet matches
   non-uniquely** (BerriAI refuses unless the original snippet appears exactly once).

## Decision

**Engine `SKILL.md` becomes the single store. `agent_skills` is demoted from a parallel
*source* to a name-keyed *metadata sidecar* over engine skills, plus a *proposal queue*.**
The self-improvement loop targets engine skills and writes only via the existing managed-dir
write path; external/handwritten skills are improved **by forking into a managed copy, never
in place.**

### 1. Metadata location — name-keyed sidecar table joined to engine skills (hybrid)

Repurpose `agent_skills` as `skill_metadata` semantics keyed by the engine skill **`name`**
(the SKILL.md frontmatter name = the join key #775/#778 already align on). Do NOT add a
parallel canonical body. For each engine skill the unified API joins:

- **From the file (frontmatter + body):** `name`, `description`, `body`, `location`,
  `managed`/`external` (source-of-truth for identity and content).
- **From the sidecar row (metadata only):** `confidence`, `version`, `status`, `source`,
  `uses`, timestamps, and `agent_skill_versions` history.

Skills with no sidecar row (most handwritten/external ones, day 1) surface with **null/default
metadata** (confidence null, version 1, status reflecting origin). A sidecar row is created
lazily the first time the loop proposes an improvement, a user publishes, or history is
recorded. This avoids a giant migration and keeps the file store authoritative for content.

`version` and `status` are *mirrored* into the managed SKILL.md frontmatter on write
(portability per prior art), but the sidecar remains the queryable source for confidence /
scores / history (which would churn the file). For **external** skills (read-only files) the
sidecar holds metadata without touching the file.

*Why not pure frontmatter:* confidence/score/history churn the file and break the
"managed-dir-write-only" safety boundary for external skills. *Why not keep two separate
stores:* that is exactly the duplication the user is eliminating.

### 2. Self-improvement loop operates on engine skills, via fork-only-for-managed writes

- **Read/target set = `GET /opencode/skills`** (all engine skills), not `GET /agent-skills`.
  `skill_extractor` / `skill_refiner` find their revision target among **live engine skills**
  (by `name`), not only DB rows.
- **Writable set is explicit and enforced:**
  - **Managed skills** → improved in place: write a new SKILL.md body to the managed dir +
    bump version + snapshot prior version to history + `reload`. (Existing
    `writeManagedSkill` + `reviseInPlace`-style history.)
  - **External / handwritten skills** (location outside the managed dir) → **NEVER written in
    place.** The loop instead **forks a managed copy** (`name` collision resolved by an
    explicit managed override that shadows the external one in the picker, or a `name (rhythm)`
    convention — see Open Questions) and applies the improvement there. The original external
    file is untouched. `sync-globals` targets (`~/.claude/skills`, `~/.codex/skills`,
    `~/.config/opencode/skills`) can therefore never be written by Rhythm — guaranteed by the
    existing `isManagedLocation` boundary in `rhythm_managed_skills.ts`.
- **All loop writes go through `status='proposed'` first (propose → review → apply):**
  add a `proposed` status (and a `proposed_for_name` + `base_version` link). The extractor/
  refiner produce a **proposal row** (sidecar) holding the candidate body + rationale +
  confidence + the trigger/evidence reference. **Nothing touches a SKILL.md until a human
  approves** in the standalone menu (Approve → materialize/revise + reload; Reject → discard).
  This is the prior-art human-in-the-loop gate and the safety answer for touching
  handwritten/external content. Auto-apply stays **off by default** (an env flag may later
  allow auto-apply for high-confidence *managed-only* revisions — out of scope here).

### 3. Standalone Skills menu surfaces ALL engine skills (folds in #779)

Convert `agent_skills_view.dart` from `GET /agent-skills` to a unified list backed by a new
`GET /skills` (or extended `/opencode/skills?withMetadata=true`) that returns engine skills
joined with sidecar metadata + a separate proposals feed. Per skill show: name, description,
managed/external badge, confidence (if any), version, status, and provenance
("learned from failure" / source). Actions, gated by managed vs external:

- **Managed:** edit (reuse `_managed_skill_editor_sheet.dart`), delete, publish, view history,
  rollback, review pending proposals (Approve/Reject).
- **External/handwritten:** read-only content; show provenance/metadata; the only mutating
  action is **"Improve (fork to managed)"** which routes through the proposal queue.
- **New skill** authoring reuses `_managed_skill_editor_sheet.dart` + `OpencodeSkillsDataSource.create()`.

The Agent Profile sheet picker is unchanged in behavior (it already reads live `/opencode/skills`
and authors managed skills); it gains nothing new beyond consistency.

### 4. Migration of existing `agent_skills` rows

- **Published rows** already materialize to managed SKILL.md (#778) — they become managed
  engine skills with their sidecar row carried over by `name`. No data loss.
- **Unpublished/draft rows** (never materialized): keep their sidecar rows as
  `status='draft'` metadata; they appear in the unified menu under their `name` with no file
  yet. Publishing materializes them (existing path). A one-time backfill reconciles any row
  whose `title` collides with an existing engine skill `name` (join, don't duplicate).
- **`proposed`-status rows** are new (created by the loop post-migration); no historical rows
  to migrate.

### 5. Keep #778 single-source + #775 scoping + names-alignment intact

- The join key is `name` throughout — the same key #775 enforces and `smoke_skill_alignment.sh`
  checks. Forked-managed copies get a deterministic `name` that is added to the live set, so
  the names-alignment guard still holds (allowlist names ⊆ live names).
- Extend `smoke_skill_alignment.sh` with a propose→approve→materialize→reload round-trip and a
  "loop never writes outside the managed dir" assertion (attempt to improve an external skill
  ⇒ a managed fork appears, the external file is byte-unchanged).
- `buildSkillsPreface` stays an inert hint, now sourced from the unified set.

### 6. Postgres vs SQLite parity

Any new columns (`proposed`-status enum value is just data; new columns: `base_version`,
`proposed_for_name`, possibly `origin_location`/`is_external`) require **matching ALTERs in
both** `apps/api_server/src/database/migrations.ts` (SQLite, tests) **and**
`apps/api_server/src/database/postgres_bootstrap.ts` (prod). The known drift hazard: tests are
SQLite-only and pass even if the Postgres bootstrap is missing the column — prod then 500s. A
parity test asserting the two schemas match (column set for `agent_skills`/`agent_skill_versions`)
is required.

## Alternatives considered

- **Pure-frontmatter metadata (no sidecar).** Simplest mental model, fully portable. Rejected:
  confidence/scores/history churn the file (frontmatter drift, merge conflicts per prior art)
  and force writes to external files to record metadata — breaking the managed-dir safety
  boundary. Hybrid keeps content in the file, churn in the sidecar.
- **Fully retire `agent_skills`; engine files become the only store, metadata in frontmatter.**
  Cleanest "one store" but loses the curation loop's queryable scoring/history and is a large
  blast radius. Rejected for the same reason #778 rejected it.
- **Improve external/handwritten skills in place.** Matches "improve all of them" most
  literally. Rejected as dangerous: rewrites user-authored files and can clobber `sync-globals`
  targets. Fork-to-managed achieves the same user-visible outcome (an improved version exists +
  is loadable) without the risk — the prior-art consensus.
- **Auto-apply loop edits (no human gate).** Faster iteration. Rejected as default: prior art
  uniformly warns of runaway/contradictory edits; a human gate is the safety mechanism.
  Auto-apply for high-confidence managed revisions can be a later opt-in flag.
- **Keep the standalone menu on `/agent-skills` and only add a metadata column to the picker.**
  Smallest change; leaves two stores and never reaches "one unified list." Rejected — fails the
  user's #3.

## Consequences

- One conceptual store (engine `SKILL.md`); `agent_skills` becomes a metadata sidecar +
  proposal queue keyed by `name`. The standalone menu and the profile picker both reflect the
  same live skill set.
- The self-improvement loop can improve handwritten/imported/external skills — safely, by
  forking to a managed copy and routing every write through a human-reviewed proposal queue.
- New schema columns demand Postgres+SQLite parity (a parity test is added). `version`/`status`
  mirror into frontmatter; confidence/history live only in the sidecar.
- Shipping live still needs a fork rebuild + signed release (the `POST /skill/reload` path);
  fork logic is covered by fork unit tests + the real-binary smoke, so CI stays green without a
  signed release (same constraint as #775/#778).
- #779 is subsumed. #780 already shipped. This epic is sequenced *after* #776/#778 land.

## Open questions for the user (surfaced, not assumed)

1. **External-fork naming/shadowing:** when the loop forks an external skill `foo` into a
   managed copy, should the managed copy reuse `name: foo` (shadowing the external one in the
   picker — cleaner UX, but two files share a name) or use a distinct `name` like `foo (rhythm)`
   (no collision, but two entries)? Recommendation: **shadow with same `name`**, with the proxy
   preferring the managed entry — but confirm.
2. **Auto-apply policy:** keep human-gate-always for v1 (recommended), or allow auto-apply for
   managed-only revisions above a confidence threshold from day 1?
3. **Standalone-menu endpoint shape:** new `GET /skills` (unified) vs extending
   `GET /opencode/skills?withMetadata=true`. Recommendation: extend the existing proxy to keep
   one skills endpoint family.
4. **Sidecar table rename:** keep the table named `agent_skills` (less churn, lots of code
   references) vs rename to `skill_metadata` (clearer intent). Recommendation: **keep the name**,
   document the repurposed semantics.
