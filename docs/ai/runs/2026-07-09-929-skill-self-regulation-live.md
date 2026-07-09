---
date: 2026-07-09
repo: Rhythm
branch: issue-929-skill-self-regulation
pr: pending
issues: ["#929"]
status: verified-live-partial
tags: [run, Rhythm]
---

# Run — #929 skill self-regulation loop, live verification

## What #929 delivers

Five units close the loop that starts where #949 leaves off (a harvested
draft written to disk as a `SKILL.md` file, auto-bound to its source agent):

1. **Unit 1 — immediately usable drafts.** A harvested draft that clears
   the confidence gate materializes as a real skill file right away instead
   of waiting on manual promotion; it is visible and invocable the moment
   it lands.
2. **Unit 2 — real usage tracking.** `skill_usage_tracker.ts` counts actual
   skill-tool invocations by mining `agent_session_messages.parts_json`,
   not a synthetic counter — so "used 3 times" means the agent actually
   invoked the skill tool three times.
3. **Unit 3 — evaluation at the usage threshold.** Once a harvested draft
   hits ≥3 uses, `harvested_skill_evaluator.ts` calls
   `skill_refiner.scoreSkillBody` and buckets the result into keep /
   rewrite-needed / disable bands. Disabled drafts are archived to a
   `disabled/` namespace rather than deleted, so the evidence trail
   survives.
4. **Unit 4 — harvester-quality signal.** Three-in-a-row or 5-of-10 bad
   evaluation outcomes file one deduped high-risk row in
   `agent_org_proposals`, flagging that the harvester itself (not just one
   skill) is drafting badly.
5. **Unit 5 — minimal UI.** The existing Skills page surfaces harvested
   lifecycle status (draft / active / disabled) and use counts inline,
   no new page.

## Plan-doc obsolescence correction

The original #929 plan assumed harvested skills were `agent_skills` DB
rows (matching the pre-#949 world). #949 merged first and changed the
representation to files-on-disk with frontmatter-carried lifecycle state.
Units 2–4 were redesigned in place around that: usage tracking reads
session transcripts instead of a DB counter, and evaluation reads/writes
frontmatter on the skill file rather than a database row. Unit 1 and 5
were adjusted correspondingly to treat the file's frontmatter as the
single source of truth for status.

## Two live-gate bug fixes (commit 79620f35e)

The live E2E gate (`apps/api_server/src/__tests__/live_e2e_929.test.ts`)
surfaced two real bugs, both fixed in `79620f35e`:

1. **`opencode_skills_routes.ts` — frontmatter dropped for
   `withMetadata=true`.** `GET /opencode/skills?withMetadata=true` fell
   back to `DEFAULT_METADATA` (`status: active`) for any skill whose
   lifecycle lives only in frontmatter, because the fork's `content` field
   strips the YAML frontmatter block before handing it back. Fixed to read
   frontmatter straight off disk via `readSkillContentAtLocation(entry.location)`
   instead of trusting the fork's stripped `content`. The same class of bug
   exists in `lazy_deps_turn_hook.ts` (#876) — diagnosed here but spun out
   as its own follow-up, out of scope for #929.
2. **`ws_gateway.ts` / `opencode_stream_bridge.ts` — evaluation ran before
   the turn was persisted.** `evaluateHarvestedDrafts()` fired when
   `promptFn` resolved (turn SUBMITTED), not after the turn's messages were
   actually written to `agent_session_messages` (turn PERSISTED) — so the
   evaluator scored against a stale usage count. Moved into the
   `session.idle` handler, mirroring how `queueSkillExtraction` is already
   sequenced, so the evaluator now sees the correct post-persist usage
   count. This was #929's own core evaluation-timing bug.

Three unit test files were updated so their fixtures back mocked skills
with real on-disk `location`s instead of the (incorrect) assumption that
the engine's `content` field carries frontmatter.

## Verification outcome (honest, partial live pass)

- **Unit suite: green.** Full `api_server` unit suite — 292 files / 2482
  tests — passing. `tsc --noEmit` clean.
- **Official live gate: blocked on an upstream precondition, not a #929
  regression.** `live_e2e_929.test.ts` could not complete its Unit 1
  harvest precondition on this machine: the only working model provider is
  `openrouter/free` (a weak free tier model — openai/google are dead, see
  #952), and it declines to distill the seeded conversation into a draft
  skill. That harvest step is #949's already-merged distillation behavior,
  upstream of anything #929 adds — the gate is blocked before it reaches
  #929's own logic.
- **Mechanism proven live via an independent probe against the real fork
  engine**, bypassing the blocked harvest precondition by seeding a draft
  directly on disk:
  1. The seeded draft was surfaced with correct live status
     (`status=draft`, `source=harvested`, `confidence=0.9`) via the real
     `GET /opencode/skills?withMetadata=true` route.
  2. The draft was exercised 3× through the real skill tool, with the
     usage counter advancing `0 → 1 → 2 → 3` from real
     `agent_session_messages` telemetry.
  3. ~17s after the third use, the evaluator ran and produced a real LLM
     judge outcome of `rewrite-needed` with `postScore=25`.
  4. Units 1, 2, and 3 are verified live by this probe. Units 4 and 5 were
     not independently probed live (Unit 4 requires a bad-streak
     that this probe's single evaluation doesn't produce; Unit 5 is a thin
     read-only UI layer over the same route Unit 1 already proved).

## Follow-ups filed / noted, not in scope here

- **#951** — the harvester can distill injected memory prefaces instead of
  actual conversation content. This is exactly the class of bad harvest
  that #929's self-regulation loop (Units 3/4) exists to catch and flag —
  #929 is the safety net for #951, not a fix for it.
- **#876** — same frontmatter-strip bug class as fix (1) above, but in
  `lazy_deps_turn_hook.ts`. Diagnosed in passing during this run, spun out
  as its own follow-up.
- **#952** — openai/google providers are dead on this machine, leaving
  only `openrouter/free`, which is both weak (declines to distill) and
  flaky (rate limits). This is why the official live gate for #929 could
  not complete its harvest precondition end-to-end.
