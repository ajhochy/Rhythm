# skill-unify2-05 — Standalone Skills menu → ONE unified list (folds in #779)

## Context
Epic: one unified skills list. Decision:
`docs/ai/decisions/2026-06-28-unify-skill-source-and-self-improvement.md`.
**This issue subsumes #779** (which asked only to convert/de-hardcode the standalone
menu).

The standalone Skills menu (`agent_skills_view.dart` → `AgentSkillsController`, nested
under Agents → Tools) currently reads `GET /agent-skills` (DB store, System B). Convert
it to the unified read (issue 02, `GET /opencode/skills?withMetadata=true`) so it lists
**every engine skill** — handwritten, imported, external, managed — with provenance and
the right per-skill actions, plus the proposal review queue (issue 04).

The Agent Profile sheet picker already reads live `/opencode/skills` and authors managed
skills — it is unchanged; this issue makes the standalone menu consistent with it and
reuses its editor sheet + data source.

## Acceptance criteria
- The standalone Skills menu lists skills from the unified endpoint (issue 02), each row
  showing: name, description, a **managed/external badge**, and metadata when present
  (confidence, version, status, provenance e.g. "learned from failure"/source).
- Per-skill actions are **gated by managed vs external**:
  - **Managed:** edit (reuse `_managed_skill_editor_sheet.dart`), delete, publish,
    view history, rollback, and review pending proposals (Approve/Reject via issue 04).
  - **External / handwritten:** content is read-only (no edit/delete); the only mutating
    action is **"Improve (fork to managed)"**, which enqueues/opens a proposal (issue 04)
    rather than editing the file.
- A **"New skill"** button authors a managed skill, reusing
  `_managed_skill_editor_sheet.dart` + `OpencodeSkillsDataSource.create()`.
- Pending proposals (`hasProposals` / `GET /skills/proposals`) are surfaced — e.g. a
  badge on the skill + a review affordance that opens Approve/Reject.
- Empty state, loading, and error states render (no crash, no hardcoded fallback list).
- Data source targets the local agent server (`http://localhost:4001`), never
  `serverConfigService.url`.
- The old `/agent-skills`-only path is removed or re-pointed; no dead reference to the
  retired DB-only list remains (the names-alignment / single-source goal).

## Likely files
- `apps/desktop_flutter/lib/features/agent_skills/views/agent_skills_view.dart`
- `apps/desktop_flutter/lib/features/agent_skills/controllers/agent_skills_controller.dart`
- `apps/desktop_flutter/lib/features/agent_skills/data/agent_skills_data_source.dart`
- `apps/desktop_flutter/lib/features/agent_skills/models/agent_skill.dart` (add
  managed/external + metadata fields, or adopt `OpencodeSkillEntry` + metadata)
- reuse `apps/desktop_flutter/lib/features/agents/views/_managed_skill_editor_sheet.dart`
  + `apps/desktop_flutter/lib/features/agents/data/opencode_skills_data_source.dart`
- `apps/desktop_flutter/lib/features/agents/views/_agents_nav_column.dart` (label only,
  if the menu name changes)

## Dependencies / order
After 02 (unified read) + 04 (proposals approve/reject endpoints).

## Safety notes
- External skills must be visibly read-only — no edit/delete affordance that could imply
  Rhythm will write the original file. "Improve" must route to the proposal flow.
- All traffic stays on `localhost:4001`.

## Required tests
- flutter widget tests on the REAL `AgentSkillsView` surface (per project convention —
  not isolated widget tests):
  - unified list renders managed + external + a row with a pending proposal;
  - managed rows show edit/delete/publish/history; external rows show read-only +
    "Improve"; tapping "Improve" routes to the proposal flow (mock data source asserts
    the call);
  - "New skill" opens the managed editor and round-trips;
  - empty/error states.
- `flutter analyze --no-fatal-infos` clean; `dart format .` applied.

## Open question that changes this issue
If external forks use a distinct `name` (Known Ambiguity), the list shows the external
and the managed-fork as two rows; if shadowing, one row with a "managed override" badge.
