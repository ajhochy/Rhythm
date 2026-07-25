# Attachment fallback: what to do when a file type has no reader

Issue #1137. The composer and the `@`-mention attach path allow every file
type. They hand an agent a file in one of three ways:

1. **Inline text** — text/log/code/markdown/etc. decoded as UTF-8 and dropped
   straight into the prompt.
2. **Native media FilePart** (`data:` URI) — images and PDFs the model can
   read directly.
3. **`file:` reference** — every other binary format, including Office
   documents and unknown MIME types, is attached as a `file:` URL pointing at
   the real path on disk. The engine tries its built-in Read tool first.

If Read cannot parse the binary, the engine does not forward opaque bytes to
the model and does not reject the attachment. It injects an actionable reader
discovery task containing the exact local path, MIME, and extension. That task
requires the agent to inspect its available skills and MCP tools, then search
online for a trusted compatible skill/server/tool when no reader is already
available.

## The fallback procedure (do this, don't just reject)

When a user (or an agent asked to open a file) hits an unreadable attachment:

1. **Don't just give up.** Check whether a reader already exists:
   - An MCP tool that reads the format (e.g. a PDF/image/spreadsheet tool
     already connected for this session).
   - A skill (`~/.config/opencode/skills/` or the agent's allow-listed
     skills) written for that file type — same mechanism `docx` uses.
2. **If a reader exists but isn't attached to this agent profile**, surface
   the exact reader and the installation/permission requirement (skill
   allow-lists are per-agent — see `skill_allowlist.test.ts` and
   `docs/ai/decisions/2026-06-28-skill-scope-enforcement.md`).
3. **If no reader exists**, use the agent's web-search capability to look for
   a trusted format-specific skill, MCP server, or tool. Tell the user plainly
   what was found and what would be required to use it; never silently
   truncate or guess at binary content.
4. **If this keeps coming up for a given format**, that's a signal to add a
   skill or MCP tool for it (out of scope for a single attach attempt — file
   an issue instead of hacking around it inline).

## Why this isn't "just widen the allow-list"

Simply widening a picker MIME list would let unsupported provider media fail
before the agent can act. #1137 instead removes the picker gate and routes
non-native formats through a local `file:` reference. The engine consumes
what Read already supports and turns the remaining formats into an explicit
agentic discovery task, so a new reader can be found without losing the
attachment path or silently accepting unreadable bytes.
