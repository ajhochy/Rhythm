---
name: zen-free-models
description: Safely select and apply a currently-free OpenCode Zen model for eligible Rhythm agent profiles.
---

# Zen free models

## Privacy notice — read before selection

Every free model may retain or train on submissions during its free period. North Mini Code and Nemotron 3 Ultra explicitly warn not to submit personal or confidential data. All free access is temporary. Tell the human this before offering a free-model route.

## Privacy policy

### BLOCKED

Never auto-assign a free Zen model because these touch Gmail, Planning Center, private vault data, ProPresenter/private service data, finance/personal data, or cross-session content:

- secretary
- Sunday Prep - Email Triage
- Sunday Prep - PCO Checker
- Sunday Prep - ProPresenter Verifier
- worship-planning
- worship-production
- librarian
- theologian
- podcast-ingest
- fantasy-gm
- email-assistant
- money
- System Task Agent
- Org External Discovery
- Org Optimizer

### OPT-IN

Explain privacy and require explicit human confirmation before assigning:

- AI-Trend-Researcher
- Theological-Researcher
- Sunday Prep - Briefing Composer
- research (label Researcher)
- rhythm-setup

### DEFAULT-ON

Code/repo or non-PII workflows eligible by default after showing the privacy notice:

- coding-agent
- workflow-orchestrator
- planning-agent
- issue-writer
- verification-gate
- smoke-test-writer
- failure-triage
- config-doctor
- prompt-evolver
- ui-ux-designer
- creative-media
- graphic-designer
- project-state-updater
- workflow-retrospective

### NEVER TOUCH

- OpenCode built-ins: build, plan, explore, general, compaction, summary, title. They are reserved ids and may process whatever is in a session, including Gmail/PCO content.
- CLI presets: claude-code, codex, gemini-cli, opencode. Reserved ids.
- Local/on-prem profiles: local, local-lean, local-executor-30b-lean, local-planner-120b-lean. Moving these to cloud Zen would be a privacy downgrade.
- Rhythm Setup Agent v2: the audit-locked UUID-id duplicate/rogue profile. Only canonical `rhythm-setup` participates in onboarding.
- Any profile not named above defaults to BLOCKED until a human classifies it.

Bootstrap exception: rhythm-setup and config-doctor ship pre-routed to a free model only on a FRESH install so onboarding works without credentials. Tell the user at first launch. Existing profiles must not be mutated.

## Select and verify a live free route

No signup, key, or payment is needed for the free path. Build the live free list from the intersection of IDs in `GET https://opencode.ai/zen/v1/models` and `https://models.dev/api.json` OpenCode models where `cost.input === 0`.

Known live fallback IDs are `deepseek-v4-flash-free`, `laguna-s-2.1-free`, `longcat-2.0-free`, `mimo-v2.5-free`, `nemotron-3-ultra-free`, and `big-pickle`.

Always probe the selected ID before assigning it with an 8-token chat completion using `Authorization: Bearer public`; require a `choices` array. For example:

```sh
curl --fail-with-body https://opencode.ai/zen/v1/chat/completions \
  -H 'Authorization: Bearer public' -H 'Content-Type: application/json' \
  -d '{"model":"<model-id>","max_tokens":8,"messages":[{"role":"user","content":"Reply OK."}]}'
```

Use guidance rather than a static mapping: choose the strongest live coder for code; use nemotron or longcat for heavy/long-context work (both 1M); use mimo-v2.5 for image input (the only free `attachment:true` route); use the smallest live model for mechanical checks. North Mini Code looks natural but was dead on the last probe, so the probe wins.

## Apply and hand off

Show the privacy notice before offering or selecting a route. After explicit confirmation, Config Doctor may perform the confirmed profile mutation using only these existing mechanics skills: `update-rhythm-agent-model`, `bulk-migrate-agent-profile-models-via-rest-api`, `refresh-rhythm-s-config-cache-after-agent-profile-db-edits` (required), and `audit-rhythm-agent-picker`.

Rhythm Setup only explains the option in plain language and hands the confirmed request to Config Doctor. Do not widen Rhythm Setup's bash or tool permissions.

Done means the probe passed, cache refresh succeeded, and picker audit passed. The first real task can still expose tool/context failures, and free access can disappear.
