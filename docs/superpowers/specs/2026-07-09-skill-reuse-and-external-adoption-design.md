# Skill Reuse & External Adoption — Design Spec

Date: 2026-07-09
Status: draft (brainstormed; awaiting review → writing-plans)
Related: harvest loop (#929/#959/#969), org-optimizer approval loop (#971, PR #982),
`#976` refine-skill, `#947` sole-source, `#873` context-injection scan, `#977` shadow retirement.

## 1. Goal & success

Agents should stop reinventing skills. When a user asks for something and a capable
skill already exists — first in the opencode library, then in the public
ecosystem — the system should **reach for the existing one** (wiring or adopting
it) instead of harvesting a fresh, usually-weaker bespoke draft. The bias is
toward a **richer recalled library**, acquired **eagerly on first encounter**.

**Success:**
- Fewer harvested-from-scratch drafts when a capable skill already exists.
- First-party library skills get auto-wired to agents that need them (reversibly).
- Genuinely-better external skills get adopted through a human-gated flow that
  then *proves* itself via behavioral measurement (kept only if it works).

## 2. Scope

**In scope (this spec, two stages):**
- **Stage A** — reuse an existing *library* skill before reinventing (auto-wire /
  revise-in-place).
- **Stage B** — discover a skill in the public ecosystem, adopt it human-gated,
  **including the real download + safety-scan + install** into the library, then
  behavioral keep/revert.

**Out of scope (explicit):**
- **Capturing outside Claude/other-session skills into the opencode config.** The
  user owns this separately. This spec assumes the library is populated by: the
  existing seed importer, the harvester's own drafts, Stage B adoptions, and that
  separate capture effort.
- **Cross-session recurring-intent clustering.** Rejected in favor of eager,
  single-encounter acquisition.
- **Runtime machine-scanning by opencode** for skills (see Invariants).

## 3. Load-bearing invariants (do not violate)

1. **The opencode config folder (`~/.config/opencode/skills`) is the owned
   library, and the improvement engine is its sole editor.** (#947.)
2. **Copy-in only, write-if-absent.** Any acquisition (Stage B adoption) only
   *adds* skills. It NEVER overwrites an existing library skill — the engine's
   version always wins. (Mirrors `populateWorkflowSkillsOnce` / ministry-seed.)
3. **opencode never scans the machine as a runtime source.** "What do we already
   have?" always means "what is in the library," never a live read of `~/.claude`,
   plugin caches, etc. (That live-scan is what risked clobbering engine work.)
4. **External content is human-gated** (autonomy policy: external tools gated) and
   passes the `#873` context-injection scan **before** it is written to the library.
5. **Everything is reversible** — auto-wire snapshots the allowlist; adoption
   reverts on behavioral regression.

## 4. Architecture

Two producers feed one decision ladder, reusing existing machinery.

```
session → harvester distills an intent (title/problem/solution/steps/tags/confidence)
        → check-first against the LIBRARY (opencode config files — Stage A)
            ├─ a managed library skill is an adequate match  → revise-in-place        [exists: refineExistingSkill]
            ├─ a library skill matches, agent NOT wired to it → AUTO-wire (+rollback)  [Stage A — new]
            └─ no adequate library match                      → harvest bespoke draft NOW  [exists]
                                                                 + emit capability-gap      [Stage B trigger, async]

capability-gap → org-optimizer external-discovery generator → skills.sh / mcp-registry search
        → LLM-judge candidate vs. the would-be bespoke draft (scored against the intent)
        → shortlist → external-adoption proposal (HIGH, gated; provenance + #873 pre-vetted)
        → human approve → REAL download → #873 scan → install into library → behavioral measure → keep/revert
```

## 5. Stage A — Reuse before reinvent (auto, library-only)

**Problem (verified):** the harvester's check-first (`skill_extractor.distillFromSession`)
resolves matches only against the `AgentSkillsRepository` DB store + the managed
drafts dir — not the actual file **library** the engine treats as sole source.
And "an existing skill matches this agent's need but the agent isn't wired to it"
is only detected when the agent's *system prompt names the skill in prose*
(`detectAgentSkillWiringMismatches`), not on an intent/relevance basis.

**Components:**
- **Library index** — an in-process view of the library (name + frontmatter
  description/whenToUse/tags) built from the opencode config skills dir. Source of
  truth for "what we already have." NOT a machine scan — only the owned folder.
- **Intent match** — reuse `getRelevantSkills`-style relevance (lexical + tag)
  against the library index, gated by the `refineExistingSkill` judge to confirm
  the existing skill is an *adequate* fit for the distilled intent (not just a
  fuzzy title hit).
- **Auto-wire action** — when a library skill is an adequate match for the intent
  but absent from the agent's `allowedSkillsJson`: add it, snapshot the prior
  allowlist for rollback, resync the agent file (`writeAgentProfileFile`). This is
  the auto lane (first-party, already-owned, low-risk, reversible).

**Decision ladder (in `distillFromSession`, before drafting):**
1. adequate managed match → `refineExistingSkill` (revise-in-place) — exists.
2. adequate library match, agent unwired → auto-wire — new.
3. no adequate library match → **harvest the bespoke draft now** (the immediate,
   unblocking answer — existing behavior) **AND** emit a `capability-gap` for
   async Stage B discovery. If Stage B later adopts+keeps a better external skill,
   it supersedes the draft (via the existing consolidate/revert path). Discovery
   is async + gated, so it never blocks the session.

Steps 1–2 short-circuit (no draft). Step 3 is the only path that drafts, and it
pairs the draft with the async gap — draft is the floor, adoption is the upgrade.

**Reuse:** `refineExistingSkill` (judge + rollback), `getRelevantSkills`,
`autoBindDraftToExtractingAgent` (the wiring write), `agent_profile_sync`.
**Build:** the library index, intent-driven unwired detection, the auto-wire
action + allowlist snapshot/rollback.

## 6. Stage B — Discover + adopt from the ecosystem (gated, full install)

**Problem (verified):** the discovery→adoption spine exists but is inert —
`runExternalDiscoveryGenerator` is never called in prod (the optimizer run skips
it), the `discoverCandidates` seam is unimplemented, the "Org External Discovery"
agent can search but has no tool that writes a proposal, and the adoption applier
is **hollow** (MCP = curated-reinstall only; skill = writes an *empty stub*, never
the real body). And `OrgAuditGap.kind` is a closed hygiene-only union with no place
for a capability gap.

**Components:**
1. **`capability-gap` gap kind** — a new `OrgAuditGap.kind` carrying the harvested
   intent (title/problem/tags/one representative sessionId) + a note that no
   adequate library skill exists. Emitted by Stage A's ladder step 3. Eager:
   emitted on first encounter (dedup by intent so re-asks collapse, not gate).
2. **Real `discoverCandidates`** — server-side search of `skills.sh/api/search`
   (skills) + `mcp-registry` (connectors) keyed on the gap's intent. Returns
   candidates with provenance (source, maintainer, license, install count,
   install command). This implements the existing injected seam.
3. **Generator wiring** — call `runExternalDiscoveryGenerator` from
   `runOrgOptimizer` (remove the deliberate skip) and give it a server-side write
   path, resolving the "seeded agent has no proposal-write tool" disconnect. Keep
   the existing gates: gap-grounding, provenance-completeness, dedup, per-run cap.
4. **Judge (hybrid, chosen)** — LLM-judge the candidate body vs. the would-be
   bespoke draft (or the incumbent), scored against the intent; only shortlist
   winners. Reuse `refineExistingSkill`'s scorer, repointed to candidate-vs-would-be.
5. **Gated proposal** — an `external-adoption` proposal (HIGH risk, `external=1`),
   pre-vetted: provenance complete AND the candidate body passes the `#873` scan
   *before* it is proposed. Enters the existing review queue (approve/reject/revert).
6. **Real adopt applier (the heaviest build — replaces the hollow stub):** on
   approve — **download** the real skill body from its source; run the `#873`
   scan (hard gate — block on high-confidence match); `writeManagedSkill` the real
   content into the library (write-if-absent, never clobber). For an MCP
   candidate, install/register the discovered server (beyond curated-only). Return
   `{ measurable: true, beforeSnapshot }`.
7. **Behavioral measure + keep/revert** — reuse the org-optimizer behavioral
   loop: replay the intent's originating scenario with the adopted skill; keep if
   the failure signature is gone, revert (remove the adopted skill/allowlist entry)
   otherwise. Human undo (#857) remains available.

**Reuse:** `external_discovery_generator` skeleton + its gates, the
`external-adoption` proposal spine/queue/validator, live `skills.sh`/`mcp-registry`,
the `#873` scanner, the behavioral-measure + revert loop (PR #982), `writeManagedSkill`.
**Build:** `capability-gap` kind, real `discoverCandidates`, generator→run wiring +
write path, the candidate-vs-would-be judge, and the **real download+scan+install
applier** (the hollow-stub fix — the single biggest piece).

## 7. Data flow (end to end)

1. Session runs → harvester distills an intent.
2. Stage A checks the library index → {revise | auto-wire | capability-gap | draft}.
3. On `capability-gap`: org-optimizer run → `discoverCandidates` searches the
   ecosystem → judge shortlists → `external-adoption` proposal (gated, pre-scanned).
4. Human approves → applier downloads + scans + installs the real skill into the
   library (write-if-absent) → wires it to the agent.
5. Behavioral measure replays the scenario → keep (active) or revert (remove).

## 8. Error handling / safety

- **Never-throw envelope** everywhere (matches harvester/generator/measure).
- **`#873` scan is a hard pre-write gate** for any external body; a high-confidence
  injection match blocks the write and the proposal.
- **Provenance required** (source/maintainer/license/popularity) before a proposal
  reaches the queue.
- **Write-if-absent** on every library write; engine-refined skills are never
  overwritten (invariant 2).
- **Auto-wire (Stage A)** snapshots the allowlist; **adopt (Stage B)** reverts the
  install + wiring on behavioral regression.
- **Budget/dedup:** discovery inherits the existing per-run cap + dedup; eager but
  bounded — dedup on intent so re-asks don't multiply proposals.
- Trust/injection surface is confined to the Stage B external path; Stage A touches
  nothing external.

## 9. Verification (live-probe; no unit tests, per project convention)

- **Stage A:** run a session whose intent matches a library skill the agent isn't
  wired to → observe the skill auto-wired to the agent (+ no bespoke draft written);
  run one with no library match → observe a `capability-gap` emitted.
- **Stage B:** from a `capability-gap`, run the optimizer → observe a real
  `skills.sh` candidate discovered → judged → a gated `external-adoption` proposal
  with provenance → approve → observe the **real body downloaded, scanned, and
  written** to the library (not a stub) + wired → behavioral measure produces
  keep/revert → on revert, the adopted skill is removed and the allowlist restored.
- Isolated env (DB copy + `RHYTHM_MANAGED_SKILLS_DIR` copy + agents-dir
  backup/restore), same harness as PR #982.

## 10. Build order

Each stage is its own writing-plans plan off this spec:
- **Plan A** — Stage A (reuse-before-reinvent). Independent; ships the cheap win.
- **Plan B** — Stage B (discover + real adopt). Depends on the `capability-gap`
  signal from Plan A; contains the heavy download+install applier.

## 11. Resolved decisions

- Full arc, one spec, staged build. · Hybrid judge (LLM shortlist → behavioral
  confirm). · Auto-reuse first-party (library), human-gate all external. · Eager,
  single-encounter (no clustering). · Library owned + copy-in-only + no runtime
  machine scan + never overwrite engine work. · Capture-from-other-sessions is a
  separate effort (out of scope). · Plan all the way through real download+install.
