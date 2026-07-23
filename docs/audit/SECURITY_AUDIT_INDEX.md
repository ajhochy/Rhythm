# Security Audit Prompt Index

**TL;DR:** Run a live security audit on your production build (not sandbox) to check for four 2026 AI CVEs.

---

## 📋 What's Included

| File | Purpose |
|------|---------|
| **LIVE_AUDIT_SUMMARY.md** | 2-min overview + 3 ways to invoke the audit |
| **AGENT_PROMPT_LIVE_SECURITY_AUDIT.txt** | Copy-paste prompt for the agent (the actual task) |
| **audit-security-concerns-live.md** | Detailed guide with commands, risk matrices, debugging |
| **RUN_LIVE_AUDIT.sh** | Bash script showing quick-reference commands |

---

## 🚀 Quick Start (30 seconds)

### Step 1: Read the summary
```bash
cat docs/ai/LIVE_AUDIT_SUMMARY.md
```

### Step 2: Copy the prompt
```bash
cat docs/ai/AGENT_PROMPT_LIVE_SECURITY_AUDIT.txt | pbcopy
```
(On Linux: `| xclip -selection clipboard`)

### Step 3: Create an agent session
- **Name:** `Live Security Audit — Production Build`
- **Agent:** `claude-code` (or any agent with file/API access)
- **Prompt:** [paste from clipboard]

### Step 4: Follow the audit (60 min)
The agent will run 4 phases:
1. **DuneSlide** (15 min) — MCP sandbox escape check
2. **GitLost** (20 min) — Prompt injection trace
3. **Engraph** (10 min) — Memory latency measurement
4. **Rogue Profile** (5 min) — Agent UUID 1dd5f2e3 status
5. **Report** (10 min) — Write findings

### Step 5: Review findings
```bash
cat docs/ai/runs/2026-07-20-live-security-audit.md
```

---

## 🔍 The Four CVEs

| CVE | What | Detection |
|-----|------|-----------|
| **DuneSlide** CVE-2026-50548/50549 | Cursor MCP sandbox escape via unvalidated path + symlink fail-open | Search MCP tools for `working_directory`; verify validation + symlink-safe checks |
| **GitLost** (Noma Security) | GitHub Agentic Workflows prompt injection; agent writes to public resource fed by untrusted input | Trace untrusted input → agent prompt → agent writes; check context scanner |
| **Engraph Latency** | Memory query p95 = 1–12s (vs ≤1s needed); feature inert | Measure latency; check timeout gate; verify issue #1093 BLOCKED |
| **Rogue Profile** | "Rhythm Setup Agent v2" (UUID 1dd5f2e3) with self-granting prompt | Query API for UUID; verify disabled + hidden + locked |

---

## 📂 File Locations

**Prompt files (ready to copy-paste):**
```
docs/ai/AGENT_PROMPT_LIVE_SECURITY_AUDIT.txt     ← Copy this into agent
docs/ai/LIVE_AUDIT_SUMMARY.md                    ← Read this first
docs/ai/audit-security-concerns-live.md          ← Detailed guide
RUN_LIVE_AUDIT.sh                                ← Quick reference
```

**Output location (after audit completes):**
```
docs/ai/runs/2026-07-20-live-security-audit.md   ← Agent writes findings here
```

---

## ⚡ Three Ways to Invoke

### Option 1: Claude Code CLI
```bash
claude code --session
# Paste prompt from docs/ai/AGENT_PROMPT_LIVE_SECURITY_AUDIT.txt
```

### Option 2: Rhythm Desktop App
1. Agents → New Session
2. Name: "Live Security Audit — Production Build"
3. Agent: "claude-code"
4. Paste prompt from `docs/ai/AGENT_PROMPT_LIVE_SECURITY_AUDIT.txt`

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

---

## ✅ Expected Results

### PASS (All Green)
- No MCP tools with unvalidated path params
- All path validators are symlink-safe
- No agent-writable public resource fed by untrusted input
- Engraph latency ≤1s OR feature is gated/disabled
- Rogue profile is disabled + hidden + locked

**→ Rating: LOW**

### MEDIUM (Minor Issues)
- Engraph latency 1–5s but gated; or
- One minor validation gap; or
- Rogue profile can be re-enabled via API

**→ Rating: MEDIUM**

### HIGH/CRITICAL (Action Required)
- Any MCP tool with unvalidated `working_directory` param
- Agent can write to public resource fed by untrusted input
- Rogue profile is enabled

**→ Rating: HIGH/CRITICAL — Stop and file GitHub issue**

---

## 📋 Checklist (Before Starting)

- [ ] Have access to live API (production or localhost)
- [ ] Can run `curl` / `grep` / basic shell commands
- [ ] Have an agent with file/API access (claude-code recommended)
- [ ] ~60 min uninterrupted time
- [ ] Read `docs/ai/LIVE_AUDIT_SUMMARY.md` first
- [ ] Copy `docs/ai/AGENT_PROMPT_LIVE_SECURITY_AUDIT.txt` to clipboard

---

## 🛑 If You Find HIGH/CRITICAL Findings

**Do NOT patch on the fly.**

Instead:
1. Document the exact finding (file path, code snippet, CWE reference)
2. Write it into the audit report
3. File a GitHub issue with severity + remediation
4. **STOP and await AJ's direction**

Example:
```
Title: [SECURITY] DuneSlide-like path escape — MCP tool unvalidated

Description:
- Tool: apps/mcp_server/src/tools/run_command.ts:42
- Parameter: working_directory (user-controllable)
- Validation: NONE — passed directly to subprocess
- CWE: CWE-426 (untrusted search path)
- Risk: CRITICAL (RCE)
```

---

## 🔧 Key Commands Reference

| Task | Command |
|------|---------|
| Find MCP tools with path params | `grep -r "working_directory\|cwd" apps/ --include="*.ts"` |
| Find symlink checks | `grep -r "realpath\|symlink" apps/api_server/src --include="*.ts"` |
| Find injection detection | `ls src/security/ \| grep -i injection` |
| Query agent profiles | `curl http://localhost:4001/agent-configs \| jq '.'` |
| Check rogue profile | `curl http://localhost:4001/agent-configs/1dd5f2e3 \| jq '.'` |
| Check Engraph latency | `grep -r "ENGRAPH" src/ --include="*.ts"` |

---

## 📚 Reading Order

1. **This file** (you are here) — 2 min overview
2. **LIVE_AUDIT_SUMMARY.md** — 5 min summary + 3 invocation methods
3. **AGENT_PROMPT_LIVE_SECURITY_AUDIT.txt** — Copy & paste into agent
4. **audit-security-concerns-live.md** — Reference during audit if needed

---

## 💡 Notes

✓ **No sandbox needed** — runs against live production API  
✓ **Read-only inspection** — no code changes  
✓ **Serial execution** — don't parallelize phases  
✓ **~60 min runtime** — Phase 1 (15) + 2 (20) + 3 (10) + 4 (5) + report (10)  
✓ **If HIGH findings → Stop and file issue** (don't patch)  
✓ **Output:** `docs/ai/runs/2026-07-20-live-security-audit.md`

---

## 🤔 Questions?

See `docs/ai/audit-security-concerns-live.md` for:
- Detailed explanations of each CVE
- Command-by-command examples
- Risk matrices for each phase
- Debugging tips

---

**Created:** 2026-07-20  
**Target:** Live Rhythm API (production or localhost)  
**Scope:** DuneSlide + GitLost + Engraph + Rogue Profiles  
**Time:** ~60 min (serial)  
**Audience:** AJ (manual review)

