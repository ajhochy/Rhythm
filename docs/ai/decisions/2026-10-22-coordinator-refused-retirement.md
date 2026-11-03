---
date: 2026-10-22
repo: Rhythm
tags: [decision, rhythm, coordinator]
index: "[[Rhythm]]"
---

# A pre-write server refusal retires a journaled coordinator command

## Context
The coordinator journal retains an uncertain command until the server acknowledges it or a reviewed
409 rejection retires it, so a body is never resent or replaced blindly. `model_integration_unavailable`
fit neither case, so a message refused on an ordinary chat could never be retired and blocked the composer.

## Decision
Add retirement kind `refused`. It is used only when the server answers the exact command with
`model_integration_unavailable`, which every server path returns before writing anything. The client
then returns the chat to normal and gives the draft back. It never auto-resends.

## Alternatives
- Auto-resend through normal chat: rejected, because it is a second wire exposure the user did not request.
- Server: let non-primary roots forward ordinary chat. Rejected for now: it widens foreground authority.
- Hide "Coordinate with Rhythm" on ordinary chats: rejected, because goals/status there are intended.

## Consequences
Any future refusal kind added to `refused` must also be proven pre-write on every server path.
