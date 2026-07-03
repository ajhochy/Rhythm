# org-optimizer-07: Recipe generator

## Goal

Generate `create-recipe` (high-risk, gated) and `refine-recipe` (low-risk, auto)
proposals from repeated multi-step prompt patterns vs the existing
`agent_cookbook`.

## Context

Per decision doc §4: a repeated multi-step prompt pattern across sessions with no
matching cookbook entry → propose a new recipe (gated, because it is a new prompt
the org will run); an existing recipe that is improvable → propose a refinement
(auto, body-scored like a skill).

## Likely files

- NEW `apps/api_server/src/services/generators/recipe_generator.ts`
- reuse `apps/api_server/src/repositories/agent_cookbook_repository.ts`
  (`AgentCookbook`: `title`, `description`, `stepsJson`, `boundConfigId`)
- proposals repo

## Acceptance Criteria

- [ ] A repeated prompt pattern with no matching cookbook entry → one
  `create-recipe` proposal (HIGH); `change_json` carries the proposed title /
  description / steps_json; never auto-applied.
- [ ] An existing recipe whose body can be improved → one `refine-recipe` proposal
  (LOW); measured/kept via the body scorer in org-optimizer-05.
- [ ] Risk tier of each emitted proposal matches `classifyProposalRisk`
  (create-recipe=high, refine-recipe=low).
- [ ] `dedup_key` set; duplicates skipped.

## Required tests

- generator contract: repeated pattern w/o recipe → create proposal (high);
  improvable existing recipe → refine proposal (low); no proposal when an adequate
  recipe already exists.

## Dependencies / order

Depends on 03, 04, 05. `create-recipe` apply happens via the queue (10); only
`refine-recipe` rides the auto path.

## Safety notes

A new recipe is a new prompt the org will run — gated. Refinements are body-only
and reversible.
