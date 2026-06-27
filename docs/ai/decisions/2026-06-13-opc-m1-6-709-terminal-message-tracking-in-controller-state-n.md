---
index: "[[Rhythm]]"
date: 2026-06-13
repo: rhythm
tags: [decision, rhythm]
---

# OPC-M1-6 / #709: Terminal message tracking in controller state (not message model)

**Context:** Issue #709 required terminal-originated messages to be excluded from the main chat transcript (c4) while still being surfaceable in the Terminal tab.

1. **`Set<String> _terminalMessageIds` per session in `AgentsController`, not in `AgentSessionMessage`** — Adding a `isTerminal: bool` field to `AgentSessionMessage` would require schema changes, migration logic in `_appendChatDelta`, and updated JSON parsing. Tracking IDs in controller state avoids all of that. The filter in `agents_view.dart` `_buildTranscriptBody` is a single `.where()` — O(n) over the terminal set which is small (one entry per shell command run).

2. **`_terminalCommandByMessage` records command text alongside the ID** — `terminalEntriesFor()` returns `({String command, String messageId})` records so `_CommandBlock` can render the `$ $command` echo header without a secondary lookup. Alternatives: store only IDs and look up command text from session input history — rejected (too much indirection; terminal commands are not in the regular chat input flow).

3. **Default SDK agent is `'build'`** — opencode's built-in bash-running agent. This is an internal opencode name; if opencode renames it the shell runner will silently misdispatch. A future issue should surface agent names via `GET /agent-sessions/agents` and let the user choose (or at least pick the first bash-capable agent dynamically).

4. **`List<ChatPart>` (not `List<dynamic>`) in `_CommandBlock.toolParts`** — Initial implementation used `List<dynamic>` to avoid importing `chat_models.dart`. Changed to typed `List<ChatPart>` for type safety; `import '../models/chat_models.dart'` added to `_terminal_tab.dart`.

**Consequences:**
- + No model schema changes; backward-compatible with existing message data.
- + `terminalMessageIdsFor()` is `O(1)` per lookup (Set); filter in transcript is `O(m)` where m = terminal command count (always small).
- - Terminal message exclusion is in-memory only — if the app restarts with a resumed session, the terminal IDs are not persisted. Resumed sessions will briefly show terminal messages in the transcript until the user re-runs a command. Deferred (no persistence requirement in #709).
- - `'build'` agent name is a hardcoded opencode internal; see note above.
