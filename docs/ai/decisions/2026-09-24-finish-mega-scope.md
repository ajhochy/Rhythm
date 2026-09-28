---
date: 2026-09-24
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
tags: [decision, rhythm]
index: "[[Rhythm]]"
---

# Finish the combined Rhythm feature set

## Context

After the fourth bounded revalidation, AJ explicitly requested: "can you finish that too. finish all the unfinished rhythm work." The referenced feature was Bot Crossing as a tab inside Rhythm. AJ then required: "I want everything stacked onto the mega PR. I want to smoke test it all as one."

## Decision

Resume unfinished Rhythm work and previously held-back repairs. Include the embedded Bot Crossing/Colony tab, Hermes shared memory, the same named agents/settings in both applications, and two-way agent delegation (AJ selected "Both"). Reconcile existing implementations before adding code; Hermes Desktop itself is already embedded.

All Rhythm changes stack onto mega PR #1544. Required upstream Hermes/Bot Crossing code stays in its own repository and is included through reviewed pins/artifacts in the single Rhythm build. Preserve source stores, installed accounts, unrelated edits and candidate evidence. No merge, production deployment or release publication was requested.

AJ subsequently clarified execution ownership: when launching a shared Rhythm agent from Hermes, "No, Hermes should run it itself." Hermes must execute the shared agent natively. Forwarding execution to Rhythm does not fulfill this requirement. Preserve the shared definition and explicitly implement or reject unsupported settings and permissions; never silently weaken them. Two-way delegation remains a separate required capability.

## Consequences

Use isolated, disjoint agent work and acceptance contracts. Prior held-back candidates may receive targeted repairs under this explicit resumed scope. Keep checks bounded and stage integration batches for one final combined installed smoke. Ask only concrete missing product/account/device questions, in plain language one at a time. Do not convert this broad request into permission to overwrite unsupported agent settings or copy credential values into renderer/storage.
