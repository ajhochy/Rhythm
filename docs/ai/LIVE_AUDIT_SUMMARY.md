# Live Security Audit — Quick Start

**TL;DR:** Run an agent against your production API (not sandbox) to audit four 2026 AI security disclosures in the live Rhythm build.

## What This Does

Audits the **live Rhythm API** (production or local) against:

| CVE/Issue | Problem | Detection |
|-----------|---------|-----------|
| **DuneSlide** CVE-2026-50548/50549 | Cursor MCP sandbox escape via unvalidated `working_directory` param + symlink fail-open | Search codebase for MCP tools with path params; verify validation + symlink-safe checks |
| **GitLost** (Noma Security) | GitHub Agentic Workflows prompt injection: agent with write access on shared resource fed by untrusted input | Trace untrusted input sources → agent prompt → agent writes; check for context scanner |
| **Engraph Latency** | Semantic memory query p95 = 1–12s (vs ≤1s needed); feature inert due to timeout gate | Measure live query latency; check if gate is enabled; verify issue #1093 is BLOCKED |
| **Rogue Profile** | "Rhythm Setup Agent v2" (UUID 1dd5f2e3) with gemini-2.5-pro + self-granting prompt | Query live `/agent-configs` API; search for UUID; verify disabled + hidden state |

## Files

| File | Purpose |
|------|---------|
| `docs/ai/AGENT_PROMPT_LIVE_SECURITY_AUDIT.txt` | Copy-paste agent prompt (the audit task itself) |
| `docs/ai/audit-security-concerns-live.md` | Detailed guide with explanations, commands, risk matrix |
| `RUN_LIVE_AUDIT.sh` | Quick reference showing 3 ways to invoke the audit |

## Quick Start (2 minutes)

1. **Copy the prompt:**
   ```bash
   cat docs/ai/AGENT_PROMPT_LIVE_SECURITY_AUDIT.txt
   ```

2. **Open Claude Code or Rhythm app**

3. **Create a new agent session:**
   - Name: `Live Security Audit — Production Build`
   - Agent: `claude-code` (or any agent with file/API access)
   - Prompt: [paste the contents from step 1]

4. **Follow the audit through 4 phases (~60 min total)**

5. **After completion, review findings in:**
   ```
   docs/ai/runs/2026-07-20-live-security-audit.md
   ```

## What the Agent Does

### Phase 1: DuneSlide (15 min)
```
Find all MCP tools with working_directory, cwd, or directory params
↓
For each tool: is path validated? Symlink-safe? Tested?
↓
Risk: HIGH if any tool has NO validation
```

**Commands:**
```bash
grep -r "working_directory\|cwd" apps/ --include="*.ts" | grep -v test
grep -r "realpath\|symlink" apps/api_server/src --include="*.ts"
```

### Phase 2: GitLost (20 min)
```
Map untrusted input sources (GitHub issues, emails, web, MCP responses, user pastes)
↓
Trace: agent prompt ← untrusted input
↓
Check: what can agent write after seeing this input?
↓
Risk: HIGH if agent can write to shared public resource fed by untrusted input
```

**Example paths to audit:**
- GitHub integration → agent reads public issue → agent writes response
- Web search result → agent prompt → agent writes to public comment
- Email → agent reads → agent writes to org settings

### Phase 3: Engraph Latency (10 min)
```
Measure p95 latency of memory query (currently 1–12s)
↓
Check: is there a ≤1s timeout gate?
↓
Check: is feature disabled in production?
↓
Risk: MEDIUM if p95 > 1s and feature is NOT gated
```

**Commands:**
```bash
grep -r "ENGRAPH" apps/api_server/src --include="*.ts"
curl http://localhost:4001/agent-capabilities | jq '.engraph_available'
```

### Phase 4: Rogue Profile (5 min)
```
Query live API: GET /agent-configs
↓
Search for UUID 1dd5f2e3 or name "Setup Agent v2"
↓
If found: enabled? Hidden? Can be re-enabled?
↓
Risk: HIGH if enabled; MEDIUM if can be re-enabled; LOW if locked
```

**Commands:**
```bash
curl http://localhost:4001/agent-configs | jq '.[] | {id, name, enabled}'
curl http://localhost:4001/agent-configs/1dd5f2e3 | jq '.'
```

## Expected Outcomes

| Finding | Status | Action |
|---------|--------|--------|
| No MCP tools with unvalidated path params | ✅ PASS | No action needed |
| All MCP path validators are symlink-safe | ✅ PASS | No action needed |
| No agent-writable public resource fed by untrusted input | ✅ PASS | No action needed |
| Engraph latency ≤1s OR feature is gated/disabled | ✅ PASS | No action needed |
| Rogue profile is disabled + hidden + locked | ✅ PASS | No action needed |

---

| Finding | Status | Action |
|---------|--------|--------|
| MCP tool with unvalidated `working_directory` param | ❌ FAIL | File GitHub issue, blocklist tool, add validation |
| Agent can write to public resource fed by untrusted input | ❌ FAIL | File GitHub issue, add context scanner, block auto-writes |
| Engraph p95 > 5s and feature is NOT gated | ⚠️ MEDIUM | Disable feature, file issue #1093 (may already be BLOCKED) |
| Rogue profile is enabled OR can be re-enabled | ❌ FAIL | File GitHub issue, audit for hidden access |

## Risk Ratings

**Overall audit result:** LOW / MEDIUM / HIGH / CRITICAL

- **LOW:** All findings pass, architecture is sound
- **MEDIUM:** Engraph latency > 1s but gated; or one minor issue found
- **HIGH:** DuneSlide or GitLost vector confirmed; or rogue profile re-enable possible
- **CRITICAL:** Rogue profile is enabled; or agent can leak private data via write to public resource

## If You Find HIGH/CRITICAL Findings

**Do NOT patch on the fly.**

Instead:
1. Document the finding (file path, code snippet, CWE reference)
2. Write it into the audit report
3. File a GitHub issue with the finding + severity
4. STOP the audit and await AJ's direction

Example issue:
```
Title: [SECURITY] DuneSlide-like path escape — MCP tool accepts working_directory without validation

Description:
- Tool: apps/mcp_server/src/tools/run_command.ts line 42
- Parameter: working_directory (user-controllable)
- Validation: NONE — passed directly to subprocess
- CWE: CWE-426 (untrusted search path)
- Proof: Can symlink escape sandbox
- Fix: Add fs.realpath() + fail-closed check
- Severity: CRITICAL (active RCE risk)
```

## Notes

✓ **No sandbox needed** — runs against live API  
✓ **Read-only inspection** — no code changes  
✓ **Serial execution** — don't parallelize  
✓ **~60 min runtime** — Phase 1 (15) + 2 (20) + 3 (10) + 4 (5) + report (10)  
✓ **Output:** `docs/ai/runs/2026-07-20-live-security-audit.md`

## Three Ways to Invoke

### Option 1: Claude Code CLI
```bash
claude code --session
# Then create session with prompt from AGENT_PROMPT_LIVE_SECURITY_AUDIT.txt
```

### Option 2: Rhythm Desktop App
1. Agents → New Session
2. Name: "Live Security Audit — Production Build"
3. Paste prompt from `docs/ai/AGENT_PROMPT_LIVE_SECURITY_AUDIT.txt`

### Option 3: Rhythm API (local)
```bash
PROMPT=$(cat docs/ai/AGENT_PROMPT_LIVE_SECURITY_AUDIT.txt)

curl -X POST http://localhost:4001/agent-sessions \
  -H 'Content-Type: application/json' \
  -d '{
    "agentId": "claude-code",
    "name": "Live Security Audit — Production Build",
    "prompt": "'$PROMPT'"
  }'
```

## Checklist (Before Starting)

- [ ] Have access to the live API (production or local)
- [ ] Can run `curl` / `grep` / basic shell commands
- [ ] Have an agent with file access (claude-code recommended)
- [ ] ~60 min time (single session, no interruptions)
- [ ] Read `docs/ai/audit-security-concerns-live.md` for detailed context
- [ ] Ready to document findings in a report file

## Questions?

See `docs/ai/audit-security-concerns-live.md` for detailed explanations, command examples, and risk matrices for each phase.

---

**Created:** 2026-07-20  
**Target:** Live Rhythm API (not sandbox)  
**Scope:** DuneSlide + GitLost + Engraph + Rogue Profiles  
**Audience:** AJ (manual review of findings)

