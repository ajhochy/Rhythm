# EPIC — Unify skill source + self-improvement on ALL engine skills (skill-unify2)

Tracking epic. Decision record:
`docs/ai/decisions/2026-06-28-unify-skill-source-and-self-improvement.md`.
Plan: `docs/ai/current-plan.md`.

## Epic body (paste into the GitHub epic issue)

**Goal:** Collapse the two skill stores into ONE (the opencode engine's `SKILL.md`
filesystem store) and make the self-improvement loop improve **every** engine skill —
handwritten, imported, external/discovered, AND managed — not just its own DB rows.
Surface one unified list in the standalone Skills menu.

**Why:** After #775 (per-session skill scoping) + #778 (engine store = single source of
truth, materialize-on-publish), skills still live in two stores joined only by a one-way
publish pipeline. The self-improvement loop (`skill_extractor`/`skill_refiner`) only
touches its own DB rows, never the handwritten/imported/external skills the user
actually wants improved. This is the skills twin of #783 (MCP unification), but bigger:
it touches the self-improvement loop.

**Approach (see decision doc):**
- Demote `agent_skills` from a parallel *source* to a `name`-keyed *metadata sidecar +
  proposal queue* over engine skills. Hybrid metadata: identity/version/status in
  SKILL.md frontmatter; confidence/scores/history in the sidecar.
- Re-target the loop at the live engine skill set. Every loop write goes through a
  `status='proposed'` row and a **human review (approve/reject)** gate.
- **Managed** skills are revised in place; **external/handwritten** skills are improved
  by **forking a managed copy — never written in place** (the original file stays
  byte-identical; `sync-globals` targets are never mutated).
- Convert the standalone Skills menu to ONE unified list with managed/external badges,
  provenance, and gated actions.

**Subsumes #779** (de-hardcode/convert the standalone menu). **#780 already shipped.**
Sequenced AFTER #776/#778 land.

**Invariants preserved:** #778 single-source-of-truth, #775 per-session
`skillAllowlist` scoping, the `name`-based names-alignment guard
(`smoke_skill_alignment.sh`), Postgres/SQLite schema parity.

### Sub-issues (in dependency order)
- [ ] skill-unify2-01 — Sidecar metadata model over engine skills (dual-DB)
- [ ] skill-unify2-02 — Unified read: join sidecar metadata onto live engine skills
- [ ] skill-unify2-03 — Proposal queue + re-target the loop at engine skills
- [ ] skill-unify2-04 — Apply path: review → managed write / fork-to-managed + reload
- [ ] skill-unify2-05 — Standalone Skills menu → ONE unified list (folds in #779)
- [ ] skill-unify2-06 — Migrate existing `agent_skills` rows to the unified model
- [ ] skill-unify2-07 — Guards: names-alignment + no-in-place-external-write + parity smoke

### Open questions for the user (answer before/while implementing 01/02/04/05)
1. External-fork naming: same-`name` shadow (recommended) vs `foo (rhythm)` distinct?
2. Auto-apply for managed-only high-confidence revisions, or human-gate-always (rec.)?
3. Unified endpoint: extend `GET /opencode/skills?withMetadata=true` (rec.) vs new `GET /skills`?
4. Sidecar table: keep `agent_skills` (rec.) vs rename to `skill_metadata`?

---

## Dependency order
```
01 ─┬─ 02 ─┬─ 03 ── 04 ─┬─ 05
    │       │            │
    └───────┴── 06 ──────┴── 07
```
01 → 02 → 03 → 04 → 05; 06 after 01+02; 07 after 04+06.

## Ready-to-run `gh issue create` block

Run from the repo root. Create the epic first, then the sub-issues; optionally edit each
sub-issue to reference the epic number. Do NOT auto-create — review bodies first.

```bash
cd /Users/ajhochhalter/Documents/Rhythm
ISSDIR=docs/ai/generated-issues

# 1) Tracking epic (body = the "Epic body" section above; trim to taste)
gh issue create \
  --title "EPIC: Unify skill source + self-improvement on ALL engine skills (skill-unify2)" \
  --label epic \
  --body-file "$ISSDIR/skill-unify2-00-EPIC.md"

# 2) Sub-issues, in dependency order
gh issue create \
  --title "skill-unify2-01: Sidecar metadata model over engine skills (dual-DB)" \
  --body-file "$ISSDIR/skill-unify2-01-sidecar-metadata-model.md"

gh issue create \
  --title "skill-unify2-02: Unified read — join sidecar metadata onto live engine skills" \
  --body-file "$ISSDIR/skill-unify2-02-unified-read-join.md"

gh issue create \
  --title "skill-unify2-03: Proposal queue + re-target self-improvement loop at engine skills" \
  --body-file "$ISSDIR/skill-unify2-03-proposal-queue-retarget-loop.md"

gh issue create \
  --title "skill-unify2-04: Apply path — review → managed write / fork-to-managed + reload" \
  --body-file "$ISSDIR/skill-unify2-04-apply-path-fork-to-managed.md"

gh issue create \
  --title "skill-unify2-05: Standalone Skills menu → ONE unified list (subsumes #779)" \
  --body-file "$ISSDIR/skill-unify2-05-unified-standalone-menu.md"

gh issue create \
  --title "skill-unify2-06: Migrate existing agent_skills rows to the unified model" \
  --body-file "$ISSDIR/skill-unify2-06-migrate-existing-rows.md"

gh issue create \
  --title "skill-unify2-07: Guards — names-alignment + no-in-place-external-write + parity smoke" \
  --body-file "$ISSDIR/skill-unify2-07-guards-and-smoke.md"
```

After creating, consider `gh issue edit #779 --add-comment "Subsumed by the skill-unify2
epic (#<epic>) — converting/de-hardcoding the standalone Skills menu is sub-issue
skill-unify2-05."` and closing #779 as superseded once the epic is filed.
