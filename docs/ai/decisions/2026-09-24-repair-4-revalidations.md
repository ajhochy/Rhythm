---
date: 2026-09-24
tags: [decision, rhythm]
---

# Repair 4: user revalidated each remaining candidate

## Context

After repair 3 review, AJ requested plain-language questions one at a time. AJ answered yes to all eight questions. This supersedes the repair-3 cap only for one bounded pass on each listed scope. Existing integration branch and draft PR #1544 remain the destination; no merge, deployment, worktree cleanup, real credential access, or signed/packaged native qualification is added.

## Decision

- #1577: another message to an existing chat keeps that chat's assigned agent and allowed tools; repair invalid engine-agent selection.
- #1574/#1573: clean up Rhythm-owned indexing helpers after shutdown/crash; find earlier leftovers, stop only provably owned processes, report uncertain ones. Prove parent death during indexing.
- #1565: useful timestamps across affected screens in the local time zone.
- #1491: preserve occupied composer drafts, hold incoming webhook drafts, prevent repeated frame refresh.
- #1582: streamed reply fragments appear once and in correct order, including React StrictMode replay.
- #1572: keep working model choices until a new direct-provider connection is confirmed usable.
- #1468: verify the existing integrated Gemini fix first. Change code only if a remaining problem is reproduced. Missing proof alone is not authorization to assume a product defect or integrate the old S1 candidate.
- #1569: add explicit plan/contract checks for no write-capable open/mutation of Hermes credential stores and no transmission of values/fingerprints to Rhythm production/telemetry. Independent re-review required. The S0 repair is docs-only. The prior explicit conditional authorization in 2026-09-24-swarm-repair-3-authorizations.md remains: after independent S0 PASS, freeze the contract and unchanged plan, then branch S1/S3/S5. This revalidation does not revoke that authorization.

## Execution

Preserve existing candidate worktrees and exact original issue criteria. Add a failing regression before product repair, run focused checks, independent read-only review, then parent reads every product diff. Parent coordinates any real backend qualification through tools/dev/sandbox.sh with the approved synthetic fixture; never hand-start API or touch live 4001/4096. Run one integrated gate after accepted slices land, then push and watch CI. Rejected work is preserved; no unbounded additional repairs.
