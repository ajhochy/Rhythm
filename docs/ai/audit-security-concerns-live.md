# Live Security Audit Prompt — Agent Task

**Target:** Live production build (API at `https://api.vcrcapps.com` or localhost if available)  
**Scope:** DuneSlide sandbox escapes, GitLost prompt injection, Engraph memory latency, rogue agent profiles  
**Duration:** 60–90 minutes (serial, must complete without interruption)  
**Audience:** AJ (manual review of findings, no auto-remediation)

---

## Agent Prompt

```
Task: Security Architecture Audit — Live Rhythm Build

You are auditing the live Rhythm API build against four 2026 AI security disclosures:

1. **DuneSlide CVE-2026-50548/50549** (Cursor prompt-injection-to-RCE)
   - Unvalidated `working_directory` param on run_terminal_cmd
   - Symlink real-path check fails open (trusts the link, doesn't fail closed)
   - Either escape lets agent overwrite sandbox helper, disabling protection
   
2. **GitLost (Noma Security, GitHub Agentic Workflows)**
   - Indirect prompt injection via untrusted content (e.g., public issue/comment)
   - Agent with write capability on shared resource (public comment, auto-PR)
   - Injects instruction via word "additionally" to reframe task
   - Fetches private data agent has read access to, posts it publicly
   
3. **Engraph Semantic Memory Latency**
   - Live HTTP query p95 currently 1–12s (vs ≤1s prompt budget)
   - 1s timeout makes feature inert
   - Needs memory-scoped query path with p95 ≤1s before production use
   
4. **Rogue Agent Profile (Rhythm-specific)**
   - "Rhythm Setup Agent v2" UUID 1dd5f2e3
   - Uses gemini-2.5-pro, self-granting prompt
   - Was disabled and hidden during org audit (superseded experiment)
   - Verify: disabled state persists, no workaround re-enables it

## What to Do

### Phase 1: DuneSlide Sandbox Escape Pattern (15 min)

**1a. Locate MCP command execution points:**
- Find all places where agent sessions invoke MCP tools that accept `working_directory` or file paths
- Check: `apps/api_server/src/services/opencode_stream_bridge.ts` (tool call dispatch)
- Check: `apps/mcp_server/src/index.ts` (tool definitions, parameter schemas)
- Search for: any tool with `working_directory`, `cwd`, `directory`, `path` params
- Specifically look for tools that could write files or execute commands

**1b. Audit path validation:**
For EACH tool that accepts a directory or file path:
- [ ] Is the path validated BEFORE use? (not after)
- [ ] Does validation fail-closed (reject invalid, not accept with warning)?
- [ ] Is there a symlink real-path check using `fs.realpath()` or `path.resolve()`?
- [ ] Does realpath check FAIL if symlink escapes (throw error, not log-warn)?
- [ ] Are there tests proving the guard works? (e.g., `symlink-escape.test.ts`?)

**1c. Check for working_directory pass-through:**
- Grep for patterns like `working_directory` → passed directly to subprocess/MCP
- Grep for `symlink`, `realpath`, `readlink` in the codebase — confirm they're used, not mocked
- Check the fork's `run_terminal_cmd` (if it exists) — is path validated there too?
- Look for any TODO/FIXME comments about path validation being incomplete

**1d. Search for existing Cursor/DuneSlide mitigations:**
- Check `src/security/` for any advisories or blocklists mentioning DuneSlide, CVE-2026-505*
- Search advisories.json for MCP tool allowlist restrictions
- Check if any MCP tools are explicitly blocklisted due to path issues

**Deliverable:** 
- List every MCP tool that accepts a directory/file path
- For each, report: validation present? Fail-closed? Symlink-safe? Tests exist?
- Risk rating: if ANY tool has `working_directory` param with no validation, mark HIGH

---

### Phase 2: GitLost Prompt Injection Pattern (20 min)

**2a. Map untrusted input → agent writes:**
Trace every path where external/untrusted content flows into an agent prompt:
- [ ] Public GitHub issues (if Rhythm has GitHub integration agent)
- [ ] Public comments / pull requests
- [ ] External email / web fetch results
- [ ] MCP tool responses (registry data, web search, API payloads)
- [ ] User-provided context / pasted text

**2b. For EACH untrusted source, check:**
- Is the input sanitized before injection into an agent prompt?
- What can the agent DO after seeing this input?
  - Write back to the same source (e.g., auto-comment on issue)? → HIGH RISK
  - Write to shared resource (org settings, public endpoint)? → HIGH RISK
  - Read private data and summarize it? → MEDIUM RISK
- Is there a context scanner checking for injection patterns?

**2c. Audit GitLost-specific vectors:**
Look for:
- [ ] Any agent that accepts input and then makes write calls
- [ ] Specifically: does the agent ever POST a comment/PR/issue back?
- [ ] Can the agent's write be triggered indirectly (e.g., "if user says X, post Y")?
- [ ] Is there a guard like "never post untrusted content" or "never auto-accept instruction rewrites"?

Check these services:
- `src/services/agent_runner.ts` — agent invocation, context assembly
- `src/security/context_scanner.ts` — any injection detection?
- `src/security/injection_patterns.ts` — patterns defined?
- `src/controllers/` — routes accepting public input?
- `src/integrations/` — GitHub, email, web integrations

**2d. Search for "additionally" / reframing defenses:**
- Grep for patterns that detect instruction reframing
- Look for tests of phrases like "additionally", "also", "furthermore"
- Check if adversarial-prompt tests exist (e.g., `adversarial_injection.test.ts`)

**Deliverable:**
- List every untrusted input source → agent path
- For each path: what can the agent write? What's at risk?
- Identify if ANY path allows agent to write to public resource fed by untrusted input
- Risk rating: if agent can post to shared resource fed by untrusted input, mark HIGH

---

### Phase 3: Engraph Memory Latency (10 min)

**3a. Locate Engraph integration:**
- Find `src/services/engraph_client.ts` or `engraph_manager.ts`
- Check: is Engraph query integrated into the hot path (agent prompt assembly)?

**3b. Measure latency:**
- Check logs for query response times (search for "engraph", "retrieval", "memory query")
- Look for timeout configuration: is there a ≤1s timeout?
- Check if feature is gated behind an env flag (e.g., `ENGRAPH_ENABLED`)?

**3c. Audit memory-scoped paths:**
- Is there a "agent-scoped" or "session-scoped" memory query endpoint?
- Does it skip cross-agent data or limit to recent history?
- What's the measured p95 latency for that path (if it exists)?

**3d. Check issue #1093 status:**
- Is #1093 (Engraph latency blocker) still marked as BLOCKED?
- Has a ≤1s query path been shipped since?
- Is Engraph feature disabled in production until latency is fixed?

**Deliverable:**
- Engraph query latency: measured p95 (from logs if available)
- Is feature gated by timeout? What's the timeout value?
- Is feature disabled in production? (via env flag or hard gate?)
- Risk rating: if p95 > 1s AND feature is NOT gated, mark MEDIUM (inert feature wastes compute)

---

### Phase 4: Rogue Agent Profile (5 min)

**4a. List all agent profiles in the live build:**
```bash
# Query live API:
curl https://api.vcrcapps.com/agent-configs \
  -H "Authorization: Bearer $(echo $RHYTHM_PROD_TOKEN)"

# Or locally:
curl http://localhost:4001/agent-configs
```

**4b. Search for "Rhythm Setup Agent v2":**
- [ ] Look through the list for UUID `1dd5f2e3`
- [ ] Search for any profile with name matching "Setup Agent v2"
- [ ] Check: is the profile's `enabled` flag set to false?
- [ ] Check: is it hidden from the agent picker? (confirm via UI or API)

**4c. Audit the profile (if found):**
- [ ] What model does it use? (should be gemini-2.5-pro)
- [ ] What's the prompt? (should contain self-granting language)
- [ ] Are there any skills/MCP tools assigned to it?
- [ ] Can it still be re-enabled? (check permission logic in routes/agent-configs)

**4d. Check the disable mechanism:**
- Look at `src/services/agent_profile_sync.ts` or agent config repository
- Is there a flag like `hidden_during_audit` or `disabled` that's checked?
- Can the profile be re-enabled by editing the config directly (db)?

**Deliverable:**
- Is "Rhythm Setup Agent v2" (UUID 1dd5f2e3) present in live build?
- If yes: enabled=false? Hidden from picker?
- If disabled: can it be re-enabled via normal flows? (if yes, that's MEDIUM risk)
- Risk rating: if profile is enabled OR can be secretly re-enabled, mark HIGH

---

## How to Run This Against Live

### Prerequisites
```bash
# Ensure you have access to the live API
export RHYTHM_PROD_URL="https://api.vcrcapps.com"
export RHYTHM_PROD_TOKEN="$(gh auth token)"  # If GitHub-authenticated
# OR use local API if running locally:
export RHYTHM_PROD_URL="http://localhost:4001"
export RHYTHM_PROD_TOKEN="local"  # Bypass token if AGENT_LOCAL=true
```

### Phase 1 (DuneSlide): Code inspection
```bash
cd apps/api_server
grep -r "working_directory\|cwd\|directory" src/ --include="*.ts" | head -20
grep -r "symlink\|realpath" src/ --include="*.ts"
grep -r "path.resolve\|fs.realpath" src/ --include="*.ts"

# Look for tool definitions in mcp_server
cd apps/mcp_server
find src -name "*.ts" -exec grep -l "working_directory\|cwd" {} \;
```

### Phase 2 (GitLost): Source scanning
```bash
cd apps/api_server
grep -r "agent.*prompt\|promptAsync" src/services/agent_runner.ts | head -10
grep -r "POST.*issue\|POST.*comment\|auto.*approve" src/ --include="*.ts" | head -20
grep -r "injection\|adversarial\|additionally" src/security/ --include="*.ts"

# Count agent-writable paths
grep -r "res\.json\|res\.send" src/controllers/ | grep -v "test" | wc -l
```

### Phase 3 (Engraph): Latency check
```bash
# Live API query
curl "$RHYTHM_PROD_URL/agent-capabilities" | jq '.engraph_available'

# Check server logs for latency
grep -i "engraph\|memory.*query\|retrieval" /path/to/api_server.log | tail -20

# Check config
grep -i "ENGRAPH" .env .env.local 2>/dev/null || echo "Not in local env"
```

### Phase 4 (Rogue Profile): Profile audit
```bash
# List all profiles
curl "$RHYTHM_PROD_URL/agent-configs" \
  -H "Authorization: Bearer $RHYTHM_PROD_TOKEN" | jq '.[]'

# Search for Setup Agent v2
curl "$RHYTHM_PROD_URL/agent-configs" \
  -H "Authorization: Bearer $RHYTHM_PROD_TOKEN" | \
  jq '.[] | select(.id == "1dd5f2e3" or .name | contains("Setup Agent v2"))'

# Check profile details
curl "$RHYTHM_PROD_URL/agent-configs/1dd5f2e3" \
  -H "Authorization: Bearer $RHYTHM_PROD_TOKEN" | jq '.enabled, .hidden'
```

---

## Expected Outputs & Risk Classification

### DuneSlide Risk Matrix
| Finding | Risk | Action |
|---------|------|--------|
| Tool accepts `working_directory` with no validation | HIGH | Immediate blocklist or validation patch |
| Path validation present but doesn't check symlinks | MEDIUM | Add `fs.realpath()` check + unit test |
| Symlink check present, no unit test | LOW | Add test case (code is sound but unproven) |
| No MCP tools with directory params | LOW | No risk in this category |

### GitLost Risk Matrix
| Finding | Risk | Action |
|---------|------|--------|
| Agent can write to public resource fed by untrusted input | HIGH | Add context scanner, block auto-writes |
| Agent reads private data, summarizes to public | MEDIUM | Audit what private data is accessible |
| Context scanner present, blocks suspicious patterns | LOW | No risk in this category |
| No agent-writable public flows | LOW | No risk in this category |

### Engraph Risk Matrix
| Finding | Risk | Action |
|---------|------|--------|
| p95 latency > 5s, feature in hot path | HIGH | Disable feature, file issue for scoped path |
| p95 latency 1–5s, 1s timeout gate present | LOW | Feature is gated, acceptable risk |
| p95 latency ≤1s, no timeout needed | LOW | No risk, feature healthy |

### Rogue Profile Risk Matrix
| Finding | Risk | Action |
|---------|------|--------|
| UUID 1dd5f2e3 enabled=true | CRITICAL | Disable immediately, audit for hidden access |
| UUID 1dd5f2e3 enabled=false, can be re-enabled via API | MEDIUM | Harden re-enable logic, add audit log |
| UUID 1dd5f2e3 not found (deleted) | LOW | No risk, profile removed |
| UUID 1dd5f2e3 enabled=false, hidden from picker, locked | LOW | No risk, profile safely disabled |

---

## Deliverables (End of Audit)

Write a report file: `docs/ai/runs/2026-07-20-live-security-audit.md`

**Format:**

```markdown
# Live Security Audit — 2026-07-20

## Executive Summary
- [ ] DuneSlide: PASS / FAIL / MEDIUM
- [ ] GitLost: PASS / FAIL / MEDIUM
- [ ] Engraph: PASS / FAIL / MEDIUM
- [ ] Rogue Profile: PASS / FAIL / MEDIUM

## Findings

### DuneSlide (CVE-2026-50548/50549)
**Status:** [PASS / FAIL / MEDIUM]

Tools with directory params:
1. [tool name] — validation: [yes/no], symlink-safe: [yes/no], tested: [yes/no]

**Risk:** [description]
**Remediation:** [if needed]

### GitLost (Noma Security)
**Status:** [PASS / FAIL / MEDIUM]

Untrusted → Agent Write paths:
1. [source] → [agent action] — risk: [high/medium/low]

**Risk:** [description]
**Remediation:** [if needed]

### Engraph Latency
**Status:** [PASS / FAIL / MEDIUM]

Measured p95 latency: [X ms]
Timeout gate: [yes/no], value: [X ms]
Feature enabled in prod: [yes/no]

**Risk:** [description]
**Remediation:** [if needed]

### Rogue Profile (UUID 1dd5f2e3)
**Status:** [PASS / FAIL / MEDIUM]

Profile found: [yes/no]
Enabled: [yes/no]
Hidden from picker: [yes/no]
Can be re-enabled: [yes/no]

**Risk:** [description]
**Remediation:** [if needed]

## Checklist
- [ ] All MCP tools inspected
- [ ] All injection paths traced
- [ ] Engraph latency measured
- [ ] Rogue profile status confirmed
- [ ] Report completed before run end

## Recommendations
[Ordered by risk]

1. [HIGH] ...
2. [MEDIUM] ...
3. [LOW] ...
```

---

## Notes

- **No sandbox required** — this audit runs against the live (production or local) API.
- **Read-only by default** — the audit is inspection-only. Do NOT apply fixes as part of this run; file follow-up issues instead.
- **Serial execution** — don't parallelize this. Each phase depends on understanding the previous one.
- **Token-light** — prioritize code inspection (grep, static analysis) over dynamic testing.
- **Ask for clarification** if you find code patterns you don't understand; don't guess at risk.

---

## If You Find HIGH Risk Findings

**Do NOT patch on the fly.** Instead:
1. Document the exact finding (file path, code snippet, CWE reference)
2. Write the finding into the audit report
3. File a GitHub issue with the finding + severity
4. Stop the audit and await AJ's direction before proceeding

Example issue:
```
Title: [SECURITY] DuneSlide-like path escape — tool_X accepts working_directory without validation

Description:
- Tool: apps/mcp_server/src/tools/run_command.ts
- Parameter: working_directory (user-controllable)
- Validation: NONE — passed directly to subprocess
- CWE: CWE-426 (untrusted search path), CWE-426 (path traversal)
- Fix: Add fs.realpath() + fail-closed symlink check
- Tests: Add symlink-escape.test.ts
- Blocked: awaiting security review
```
```

---

## Quick Reference

**Files to inspect:**
- `src/services/opencode_stream_bridge.ts` — tool dispatch
- `src/services/agent_runner.ts` — agent context + prompt assembly
- `src/security/context_scanner.ts` — injection detection
- `src/security/injection_patterns.ts` — patterns defined
- `apps/mcp_server/src/index.ts` — tool schema definitions
- `src/services/engraph_client.ts` — memory query integration
- Database schema (check for `hidden_during_audit` flag on profiles)

**Commands to run:**
```bash
# DuneSlide
grep -r "working_directory" apps/ --include="*.ts"
grep -r "realpath" apps/api_server/src --include="*.ts"

# GitLost
grep -r "untrusted\|injection\|adversarial" apps/api_server/src/security --include="*.ts"
grep -r "POST.*comment\|auto.*approve" apps/api_server/src --include="*.ts"

# Engraph
grep -r "ENGRAPH" apps/api_server/src --include="*.ts"
curl http://localhost:4001/agent-capabilities | jq '.engraph_available'

# Rogue Profile
curl http://localhost:4001/agent-configs | jq '.[].id'
```

---

## Time Budget

| Phase | Time | Priority |
|-------|------|----------|
| DuneSlide inspection | 15 min | HIGH (active RCE risk) |
| GitLost tracing | 20 min | HIGH (privacy + data leakage risk) |
| Engraph latency | 10 min | MEDIUM (feature inert, not dangerous) |
| Rogue Profile check | 5 min | MEDIUM (precedent + audit trail) |
| Report write + review | 10 min | HIGH (documentation) |

**Total: ~60 min**

If you find HIGH risk findings and need to deep-dive, budget +30 min for investigation.
```

---

## How to Invoke

Save the prompt above to an agent session with:

```bash
# Option 1: Via CLI (if you have Claude Code installed)
claude code --task "Run the live security audit prompt from docs/ai/audit-security-concerns-live.md against https://api.vcrcapps.com"

# Option 2: Direct session in Rhythm UI
Agent: claude-code (or similar)
Prompt: [paste the prompt above, minus the markdown fence]

# Option 3: Via API (if Rhythm supports it)
curl -X POST http://localhost:4001/agent-sessions \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "claude-code",
    "name": "Live Security Audit — DuneSlide/GitLost/Engraph/Profiles",
    "prompt": "[full prompt]"
  }'
```

