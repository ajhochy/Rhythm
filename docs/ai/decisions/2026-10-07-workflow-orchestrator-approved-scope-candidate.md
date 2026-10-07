---
date: 2026-10-07
repo: Rhythm
branch: codex/coordinator-conversation-20261007
pr: null
issues: []
status: proposed
index: "[[Rhythm]]"
tags: [decision, rhythm, coordinator, workflow]
---

# Workflow Orchestrator approved-scope candidate

## Context

The active Electron Coding Agent profile already expresses the bounded feature-scope rule. The managed Workflow Orchestrator skill does not carry the corresponding durable handoff record: its planning instruction can reopen an already authorized scope, and its dispatch contract does not require task identity, authorization evidence, exclusions, or resolved decisions to accompany a coding-agent handoff or resume.

The host source file has SHA-256 `605394cfdae5aab82997a28bd06c9a5a79b3e996f2293766cf9673e34d65d791`; its frontmatter-stripped, normalized body has SHA-256 `7e4436246c0fa234afdb5818f5590eca99f5f87cb504850f996a0dc662324e4e`. The reviewed, offline unified diff is [workflow-orchestrator.approved-scope.patch](../../../tools/dev/fixtures/approval-scope/workflow-orchestrator.approved-scope.patch). Its raw host-file SHA-256 is `82e69ad3850e7e4cd80c2f2c8200b58bffa5d132a52b0e11eab1d643f7ea67a1`; its frontmatter-stripped, normalized candidate body has SHA-256 `c4bb6a0c376de4699265ef66b7c363d733f17070541c90884daa55ff0d31e984`.

## Candidate

The patch makes the planning stage apply only when the same task lacks a durable approved-scope record. It adds a dispatch section requiring task identity, repository/branch, objective, allowed work, exclusions, authorization evidence, and resolved decisions. It carries that record into coding-agent handoffs and same-task resumes, without transferring it to unrelated work.

It treats HIGH and CRITICAL GitNexus results as one consolidated impact/test/review obligation. They do not reopen approval for necessary in-scope symbols, routes, additive fields, tests, or bounded run artifacts. It keeps separate decisions for material expansion, new consequential risks, merge, deployment, destructive recovery, credentials, and live hardware. Host tool permission, including explicit bypass, remains distinct from workflow scope.

## Apply boundary

This change is not applied to an installed-app skill. The supported sandbox-only API accepts a frontmatter-stripped Markdown body and serializes managed frontmatter itself, so its full-file bytes are not a CAS representation of the host file. The safe comparison is the normalized body plus `name`, description, and tags. In L, the absent skill was created through `POST /opencode/skills`; that staged an earlier reviewed candidate body and normalized its frontmatter. After the final candidate revision, the supported idempotent `PUT /opencode/skills/workflow-orchestrator` sent `{ "description": "<current listed description>", "content": "<reviewed normalized candidate body>" }`, omitted `tags`, and read back the final normalized body digest `c4bb6a0c376de4699265ef66b7c363d733f17070541c90884daa55ff0d31e984`.

The endpoint has no compare-and-swap. A body or metadata mismatch is a hold and requires a fresh candidate review. The write reloads engine skills, but does not prove a new session follows the policy.

## Verification

The sandbox validation records the initial POST staging, then after engine-idle
control executes the idempotent PUT and reads back the normalized candidate body
digest. That verifies the supported sandbox projection only.

O continuation accepted the configured Coding Agent behavior separately: the
same SDK session completed a RED-to-GREEN snapshot edit and a resumed route
edit under `acceptEdits`, with `approvalBypassExplicit: false` and
`external_directory` denied. A separate Coding Agent session refused an
unrelated payroll request; the original session refused deployment, and the
toy sentinels were unchanged. The Coding Agent profile already contained the
bounded-scope rule. The model did not invoke Workflow Orchestrator, so this is
not behavioral proof of the candidate patch. A future candidate-specific test
must drive a final staged Workflow Orchestrator handoff and resume into Coding
Agent; no installed-app skill or profile was changed here.
