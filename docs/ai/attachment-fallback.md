# Attachment fallback: what to do when a file type has no reader

Issue #1137. The composer (and the `@`-mention attach path) can only hand an
agent a file in one of three ways:

1. **Inline text** — text/log/code/markdown/etc. decoded as UTF-8 and dropped
   straight into the prompt.
2. **Native media FilePart** (`data:` URI) — images and PDFs the model can
   read directly.
3. **`file:` reference** — Office documents (`.docx/.doc/.xlsx/.xls/.pptx/.ppt`)
   are attached as a `file:` URL pointing at the real path on disk. The
   engine's Read tool opens it and a skill (`docx`/`xlsx`/`pptx`, if
   installed for the target agent) extracts the text.

Anything else — a genuinely unknown binary format with no skill able to read
it — still gets the "unsupported file type" rejection at attach time. There
is no generic fallback that magically reads arbitrary binary formats.

## The fallback procedure (do this, don't just reject)

When a user (or an agent asked to open a file) hits an unreadable attachment:

1. **Don't just give up.** Check whether a reader already exists:
   - An MCP tool that reads the format (e.g. a PDF/image/spreadsheet tool
     already connected for this session).
   - A skill (`~/.config/opencode/skills/` or the agent's allow-listed
     skills) written for that file type — same mechanism `docx` uses.
2. **If a reader exists but isn't attached to this agent profile**, say so
   explicitly and ask whether to enable it (skill allow-lists are per-agent —
   see `skill_allowlist.test.ts` / `docs/ai/decisions/2026-06-28-skill-scope-enforcement.md`).
3. **If no reader exists**, tell the user plainly which format failed and
   that no MCP tool/skill currently reads it — don't silently truncate or
   guess at binary content.
4. **If this keeps coming up for a given format**, that's a signal to add a
   skill or MCP tool for it (out of scope for a single attach attempt — file
   an issue instead of hacking around it inline).

## Why this isn't "just widen the allow-list"

Widening a picker's MIME allow-list without a reader behind it lets the user
attach a file that then silently fails (provider rejects the media type, or
the agent sees nothing useful). The fix in #1137 routes Office docs through
the `file:` protocol specifically *because* a reader (the `docx` skill) exists
for them via the engine's Read tool. Don't repeat the "loosen the gate" fix
for a new format unless you've confirmed a reader is actually reachable —
otherwise you've traded one failure mode (rejected at attach) for a worse one
(silently accepted, then unreadable in-session).
