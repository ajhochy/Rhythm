---
date: 2026-09-25
repo: Rhythm
tags: [decision, Rhythm]
---

# Reduce the session inspector property list to unique context

## Context

The Context inspector repeated session data already visible in the conversation header, composer, transcript, and context gauge. Several repeated values were also placeholders in live mode.

## Decision

Keep only Created, Updated, and Worktree branch (when an isolated worktree reports one). Created and Updated remain semantic local-time `Timestamp` values. Worktree branch stays because the phase-6 worktree contract requires the resolved branch in the Context inspector.

Remove these property rows:

- Provider: represented by the selected profile/account controls.
- Agent: shown in the conversation header.
- Model: shown in the composer/session settings.
- Usage budget: replaced by the live Usage Budget panel.
- Total cost: shown in the conversation header when positive persisted message costs exist.
- Input, Output, and Cached: represented by the context gauge and per-message usage footers.
- Messages: evident in the transcript/list.
- Worktree: shown by the header worktree badge and context path label.

The header cost is the sum of positive costs on the currently loaded message page. It is hidden when no loaded message has a positive cost, so plan-priced sessions never show a false `$0.000` final value.

## Alternatives

Keeping corrected duplicates would preserve density without adding unique information. Removing the entire property list would also remove the only inspector location required to expose the resolved worktree branch.

## Consequences

The Context inspector is shorter and avoids placeholder values. Cost remains a loaded-page ceiling until older transcript pages are loaded, matching the existing client boundary.
