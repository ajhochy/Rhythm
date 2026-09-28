---
tags: [decision, rhythm]
date: 2026-09-22
---

# Prompting an existing agent session: flat auth, audited

## Context

`POST /agent-delegation/delegate-async` lets an external caller spawn *children*
under an orchestrator, but nothing could instruct the orchestrator itself:
`/agent-sessions/:id/resume` takes no prompt, `POST /agent-sessions` only
creates, and `/message-threads/:id/messages` is the human messaging system.
Agent prompts went exclusively over the WebSocket gateway, which only the
desktop UI drives — so a live orchestrator with finished children had to be
told "review this and open a PR" by hand.

## Decision

`POST /agent-sessions/:id/prompt` on the **local agent server (:4001)**, exposed
as the MCP tool `rhythm_prompt_session`.

**Any running session is promptable. No parentage check.** The Rhythm API/MCP
secret key is the trust boundary; gating on parentage would block the main use
case, which is a caller prompting a session it did not create.

**Every injection is audited** — `agent_prompt_injections`, append-only,
readable at `GET /agent-sessions/:id/prompt-log`. The key does not defend
against prompt injection: a compromised agent holds it legitimately, and an
agent that reads a GitHub issue body saying "send this instruction to session X"
makes an authorized call with someone else's words. That is indistinguishable
from a legitimate call at the auth layer and obvious in a log. Logging, not
gating. Same gap as open issue #1576 (routed models break provenance).

Caller identity follows the #1322 precedent: the MCP layer supplies
`callerSdkSessionId` from its trusted security context, never a model-supplied
session id (a model asked for its own id invents a plausible UUID scraped from
its cwd). Here it feeds the audit row only — it authorizes nothing.

The tool also sits behind the existing outbound approval gate as the new
`session.prompt` action, which bites once the calling session has actually
consumed untrusted content.

## Alternatives

- **Parentage gate** (only prompt sessions you spawned) — rejected by AJ: blocks
  the main use case, and offers no protection against the real threat, since a
  compromised parent can prompt its own children anyway.
- **New WebSocket client** — would require every programmatic caller to hold a
  socket; the whole point is a one-shot HTTP call.
- **Production API (Cloudflare) route** — impossible, see below.

## Why the local agent API, not Cloudflare

Production (`api.vcrcapps.com`) holds none of the state a prompt needs. The
opencode engine, the in-process `opencodeSessionMap`, the stream bridge and the
SQLite `agent_sessions` rows all live in the desktop-embedded server on :4001.
A Cloudflare-side route would have nothing to prompt. The existing
`claude-triggers` polling path stays on production precisely because it is
*delivery*; execution has always been local, and this endpoint is execution.

## Consequences

- The endpoint delegates to `handleInputFrame`, the WS gateway's own
  `session.input` handler, with a shim capturing the error frames it would have
  written to a socket. That handler carries ~400 lines of per-turn behaviour
  (profile scope, MCP/skill allowlists, model resolution, auto-resume, memory
  and skill prefaces, experiment enrollment). Re-implementing any of it would
  guarantee drift between the UI path and the programmatic one.
- Auto-resume comes free: prompting a `resumable` session wakes it.
- `agent_prompt_injections` is SQLite-only. No Postgres twin — the local agent
  server is the sole writer, like `agent_session_messages`.
