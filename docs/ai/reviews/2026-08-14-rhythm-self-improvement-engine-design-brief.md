# Open Design Build Brief — Rhythm Self-Improvement Engine Audit

Build a polished, responsive, self-contained single-page HTML decision artifact titled **“Rhythm Self-Improvement Engine Audit”**. The audience is the product owner and engineering team deciding what to change next. The page must prioritize **concrete implementation actions** over diagnosis detail.

Use the selected **Taste Editorial** design kit: warm monochrome/paper canvas, elegant serif display typography, highly legible grotesque body copy, one restrained aubergine or signal-violet accent, hairline dividers, muted pastel status chips, generous macro-whitespace, and subtle ambient motion. It should feel like a premium engineering field report, not a generic admin dashboard. Keep body text high contrast and at least 16px. Avoid gradients, glassmorphism, excessive cards, huge title text, fake product chrome, stock imagery, emoji, and decorative chart junk.

## Artifact requirements

- Produce one self-contained `index.html` that works without a build step.
- Responsive and polished at desktop, tablet, and mobile widths.
- Semantic HTML, visible keyboard focus, skip link, correct heading hierarchy, accessible labels, reduced-motion support, and WCAG AA contrast.
- Add a restrained sticky section navigator with anchor links.
- Use progressive disclosure: the action plan is always visible; supporting evidence may use native `<details>` sections.
- Include useful, working interactions only. Suggested: priority filter (All/P0/P1/P2/P3), expand/collapse evidence, and a “Copy implementation checklist” control with honest success feedback. Do not add nonfunctional buttons.
- No external analytics, network calls, frameworks, credentials, or secrets.
- Add a compact footer: “Read-only audit · live server, Rhythm DB, OpenCode DB, and source reviewed · 14 Aug 2026.”

## Core message

Use this verdict verbatim and prominently:

> Rhythm has a strong safety-oriented foundation, but it is not yet a reliable self-learning system.

Supporting explanation:

> Today it behaves more like telemetry → heuristic/LLM suggestions → occasional mutation → narrow proxy check than observed user outcome → causal diagnosis → controlled experiment → durable measured improvement → learned policy.

Prominent decision banner:

> **Approve none of the 25 current proposals as written. Put the optimizer in shadow mode while the evidence, lifecycle, and measurement loop is repaired.**

## Information architecture

### 1. Hero / executive decision

- Eyebrow: `ENGINEERING DECISION BRIEF · 14 AUG 2026`
- Title: `Rhythm Self-Improvement Engine Audit`
- Verdict and decision banner above.
- Compact “What this means” text: Rhythm currently gets busier as it is used, but does not consistently get smarter.
- Four highly legible classification figures:
  - `0` approvable as written
  - `2` partially correct; re-author
  - `11` unsupported or no-op
  - `12` harmful if approved
- Small source note: 25 current live proposals independently audited against sessions, tool events, configuration, skills, databases, and source code.

### 2. Immediate containment — P0

This must be the first and strongest action section. Render it as an ordered intervention list, not generic cards.

1. **Disable automatic scope prune/tighten**
   - Why now: 69 of 109 active proposals are scope tightening/pruning; observed tool aliases caused false “unused” findings; 29 of 46 checked scope removals were contradicted by actual tool calls (63%).
   - Implementation: hard-disable low-risk auto-apply for `tighten-scope` and `prune-scope`; require canonical capability evidence and human review.
   - Exit gate: no scope removal can promote unless canonical tool identity proves zero use over a defined observation window and task replay shows no regression.

2. **Quarantine and supersede the current queue**
   - Why now: independent audit graded 0/25 approvable, 11 unsupported/no-op, 12 harmful, and 2 needing re-authoring.
   - Implementation: reject/supersede current proposed rows with a machine-readable reason; preserve evidence for regression tests; re-enter only as fresh hypotheses.
   - Exit gate: every regenerated proposal cites source events, target state hash, expected outcome, experiment, and rollback rule.

3. **Run the optimizer in shadow mode**
   - Implementation: continue observation and proposal generation, but do not mutate production state; score precision against human adjudication and replay outcomes.
   - Exit gate: sustained proposal precision threshold, zero silent high-severity regressions, and clean lifecycle reconciliation before any auto-apply family is re-enabled.

4. **Exclude internal/self-improvement sessions from harvesting**
   - Why now: evaluator, smoke, measurement, scheduled, and self-improvement sessions contaminate learned skills and signals.
   - Exit gate: provenance filters are enforced at ingestion and covered by tests.

### 3. Repair the evidence — P1

Show these as a concise implementation queue with `Problem → Change → Proof` rows.

- **Canonical capability identity**: normalize MCP server IDs, operation IDs, aliases, and tool names into one capability ID before gap, scope, and usage calculations. Proof: alias-equivalent calls resolve to one identity and do not generate false gaps/removals.
- **Behavioral retry telemetry**: replace keyword counting with structured attempt spans, tool errors, recovery transitions, repeated equivalent calls, and unresolved failure signatures. Proof: successful outputs discussing “retry policy” do not create retry-loop proposals.
- **Evidence bundles**: every proposal carries immutable source event IDs, observation window, counter-evidence, target snapshot/hash, confidence calibration, and expected user outcome. Proof: reviewers can reproduce the diagnosis from the proposal alone.
- **Freshness and conflict control**: add expiry, optimistic concurrency, target hashes, mutation locks, stale/no-op detection, and conflict/supersession rules. Proof: drifted targets cannot be applied or rolled back over newer state.
- **Lifecycle reconciliation**: repair stale `active`, `applied`, and `measuring` rows; make one state machine authoritative. Current observed state includes 248 total proposals, 109 active, 80 rejected, 27 reverted, 25 proposed, 5 measuring, and 2 stuck at applied.

### 4. Make learning causal — P2

Make this the conceptual centerpiece. Include a clear, horizontal future-loop diagram that stacks vertically on mobile:

`User task → outcome telemetry → evidence-quality gate → hypothesis → shadow candidate → controlled replay / A-B → risky-change review → measured promotion → learned policy`

Concrete changes:

- Replace immediate proxy checks with **task-level baseline vs candidate experiments**.
- Define outcome metrics per proposal family before generation: task success, correction rate, latency, cost, tool failures, user acceptance, and regression set.
- Require minimum sample size or controlled replay; label inconclusive results rather than treating them as success.
- Feed reverts, regressions, approval decisions, and structured rejection reasons back into generator evaluation.
- Treat `active` as “deployed,” never “proven”; only measured user-outcome improvement earns `verified` promotion.
- Create family-specific measurement harnesses instead of one generic evaluator.

Add a small “Do / Don’t” comparison:

**Do**
- Verify task outcome improvement.
- Run controlled baseline/candidate comparisons.
- Capture structured human decision reasons.
- Promote only after measurable benefit.

**Don’t**
- Count textual mentions of retry as retry behavior.
- Treat a smaller allowlist as proof of improvement.
- Treat `active` or a high textual score as proven value.
- Bulk approve the live queue.

### 5. Grow skills and tools safely — P3

- Gate skill extraction on successful, user-relevant sessions with clean provenance.
- Deduplicate against existing capabilities before creating a draft.
- Sandbox external candidates; require stack relevance, security review, and task replay.
- Promote a harvested or external skill only after observed reuse and benefit; archive candidates that never demonstrate utility.
- Current evidence to show compactly: 92/119 harvested skills had zero use (77.3%); 112/120 remained draft/pending (93.3%); 11/13 external adoptions had zero use (84.6%).
- Keep external adoption human-gated.

### 6. Current queue disposition

Use a scannable table or ledger with columns `Proposal family`, `Disposition now`, `Replacement standard`.

Rows:

- Scope removals → **Quarantine** → canonical identity + observation window + task replay.
- One-line “reduce retry loops” recipes → **Reject / supersede** → structured retry trace + executable steps + behavioral replay.
- Full coding-agent prompt replacement based on apparent truncation → **Reject** → inspect complete target state and propose minimal patch.
- Secretary timeout/resilience changes → **Reframe as experiment** → reproduce timeout, baseline latency/error rate, bounded candidate, replay.
- Directly verifiable missing-file/config inconsistencies → **Focused human review** → confirm target hash and minimal patch.
- Stack-relevant external skills → **Sandbox evaluation only** → security/relevance checks and demonstrated task benefit.

### 7. Acceptance gates / definition of “getting smarter”

Present as a release checklist with explicit gates:

- Proposal precision is measured against human adjudication and exceeds an agreed threshold for a sustained window.
- No stale `active`, `applied`, or `measuring` lifecycle rows.
- Every measurement references a real task outcome or controlled replay.
- Every mutation has target hash, lock, expiry, rollback, and conflict protection.
- Reverts and rejection reasons influence future proposal scoring/generation.
- Harvested skills demonstrate reuse and measurable benefit before promotion.
- Auto-apply is enabled per proposal family, not globally, only after that family passes regression gates.
- The north-star metric is **verified user-outcome improvement per promoted change**, not proposal count, artifact count, or smaller allowlists.

### 8. Preserve these foundations

Keep this supportive and brief:

- Centralized risk classifier; unknown proposal kinds fail closed to high risk.
- Human gate for external code/capability adoption.
- Privileged change shapes override misleading low-risk labels.
- Revalidation at approval time.
- Before snapshots and rollback paths.
- Proposal state machine and per-run generation/model-call caps.
- Attempt-aware re-diagnosis exists for some reverted proposals.

### 9. Evidence appendix

Use expandable disclosure for secondary metrics and architecture observations:

- 248 total proposals; 109 active; 69/109 active are scope tightening/pruning (63.3%).
- 80 rejected; 27 reverted; 25 proposed; 5 measuring; 2 stuck at applied.
- Proposal-family revert rates: workflow-prompt-fix 83.3%; refine-skill 72.7%; external-adoption 18.8%; refine-scope 16.7%.
- 26/90 active configuration proposals had target drift (28.9%).
- 37/39 active high-risk rows lacked a recorded deciding actor (94.9%).
- 98/2360 self-improvement sessions errored (4.2%); 1577/2360 were score sessions (66.8%).
- 12/119 harvested skills had contaminated source provenance (10.1%).

Include two compact false-positive examples:

1. A completed PCO sync task contained ordinary discussion of HTTP retry policy; keyword matching found 13 “retry” mentions and generated a one-line “reduce retry loops” recipe despite successful delivery.
2. A successful issue-writing session discussed selective retry/resume features; 15 textual matches produced another retry-loop proposal even though the agent loaded its skill, used task tracking, recovered from one missing template, and delivered the requested issues.

## Tone and copy rules

- Direct, calm, evidence-backed, and implementation-oriented.
- Prefer verbs and explicit gates over abstract recommendations.
- Make the concrete plan readable in under five minutes; details remain available for engineers.
- Do not overstate source/build parity: note that live schema and behavior aligned with inspected source, but packaged-binary-to-repository cryptographic parity was not established.
- Do not expose credentials, connection strings, secrets, tokens, private runtime paths, or raw database contents.
