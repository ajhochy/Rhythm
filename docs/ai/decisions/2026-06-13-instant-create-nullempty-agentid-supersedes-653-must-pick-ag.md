---
date: 2026-06-13
repo: rhythm
tags: [decision, rhythm]
---

# Instant-create (null/empty agentId) supersedes #653 must-pick-agent requirement (#710)

**Context:** Issue #653 required `agentId` to be non-null and non-empty on session creation ("pick an agent before creating a session"). Issue #710 introduced instant-create: tapping "New session" creates a session immediately with no agentId, opening it as a placeholder the user can configure later.

**Decision:** The server controller now accepts `agentId = null | ''` and creates a session with `agentKind = ''`. The SDK session IS created immediately (so the session is usable as soon as the user sends a message). The `'__pending__'` sentinel (old ORM pattern) is still rejected with 400. `issue_653_contract.test.ts` c1a and c1c were updated from `expect(400)` to `expect(201)` with a comment explaining the supersession.

**Alternatives considered:**
- Keep #653 enforcement, require explicit agentId in the instant-create request: rejected — the instant-create UX requires zero required fields from the user.
- Create a separate "draft session" endpoint that never touches the SDK: rejected — added complexity; one endpoint handles all create paths more simply.

**Consequences:** A session with `agentKind = ''` is valid in the DB. The Flutter client displays it with a "New session" placeholder name and muted text. The session gets a real title via `session.updated` WS broadcast once the user types a first message. Any client code that relied on `agentKind` being non-empty must guard for `''`.
