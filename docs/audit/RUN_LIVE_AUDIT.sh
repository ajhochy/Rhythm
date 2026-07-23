#!/bin/bash

# Quick-reference: How to run the live security audit against the production build
# 
# This script shows the three ways to invoke the security audit prompt
# Against the LIVE API (not sandbox)

set -e

echo "
╔════════════════════════════════════════════════════════════════════════════╗
║  LIVE SECURITY AUDIT — DuneSlide / GitLost / Engraph / Rogue Profiles     ║
╚════════════════════════════════════════════════════════════════════════════╝

This audit checks the PRODUCTION build (not sandbox) against four 2026 CVEs:

  1. DuneSlide (CVE-2026-50548/50549) — Cursor sandbox escape via path validation
  2. GitLost (Noma Security) — GitHub Agentic Workflows prompt injection
  3. Engraph Latency — Memory query p95 > 1s makes feature inert
  4. Rogue Profile — Rhythm Setup Agent v2 (UUID 1dd5f2e3) still present?

Expected runtime: 60 min (serial, no parallelization)
Output: docs/ai/runs/2026-07-20-live-security-audit.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OPTION 1: Via Claude Code CLI (if installed)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

$ claude code --session

  Name: Live Security Audit — Production Build
  Agent: claude-code
  Prompt: [paste contents of docs/ai/AGENT_PROMPT_LIVE_SECURITY_AUDIT.txt]

  (Then follow the multi-turn conversation, reporting findings at each phase)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OPTION 2: Via Rhythm Desktop App (if available)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Open Rhythm (macOS desktop app or web)
2. Agents tab → create new session
3. Name: 'Live Security Audit — Production Build'
4. Agent: claude-code (or available agent with code access)
5. Paste the prompt from: docs/ai/AGENT_PROMPT_LIVE_SECURITY_AUDIT.txt
6. Send and follow the multi-phase audit

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OPTION 3: Via Rhythm API (if using locally)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Read the prompt file
PROMPT=\$(cat docs/ai/AGENT_PROMPT_LIVE_SECURITY_AUDIT.txt)

# Create session via API
curl -X POST http://localhost:4001/agent-sessions \
  -H 'Content-Type: application/json' \
  -d '{
    \"agentId\": \"claude-code\",
    \"name\": \"Live Security Audit — Production Build\",
    \"prompt\": \"'\"'\$PROMPT'\"'\"
  }'

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

QUICK START (Recommended)
━━━━━━━━━━━━━━━━━━━━━━━━━

1. Copy the prompt file:
   cat docs/ai/AGENT_PROMPT_LIVE_SECURITY_AUDIT.txt

2. Open Claude Code or Rhythm app

3. Create a new agent session with:
   - Name: Live Security Audit — Production Build
   - Agent: claude-code
   - Prompt: [paste contents]

4. Follow the multi-turn conversation (4 phases, ~15 min each)

5. After agent completes, write findings to:
   docs/ai/runs/2026-07-20-live-security-audit.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

WHAT THE AGENT WILL DO
━━━━━━━━━━━━━━━━━━━━━

Phase 1 (15 min): DuneSlide
  - Find all MCP tools with directory/path params
  - Check for validation, symlink-safe checks, unit tests
  - Risk classify: no risk / needs validation / needs symlink check

Phase 2 (20 min): GitLost
  - Trace untrusted input sources to agent prompt
  - Map what agent can write after seeing untrusted input
  - Risk classify: private data only / can write to public resource

Phase 3 (10 min): Engraph
  - Measure memory query latency (p95)
  - Check for timeout gate (≤1s?)
  - Risk classify: feature healthy / feature inert / feature risky

Phase 4 (5 min): Rogue Profile
  - Query live API for agent profiles
  - Search for UUID 1dd5f2e3 (Setup Agent v2)
  - Check: enabled? Hidden? Can be re-enabled?
  - Risk classify: enabled (critical) / can re-enable (medium) / disabled/locked (low)

Phase 5 (10 min): Report
  - Write findings to docs/ai/runs/2026-07-20-live-security-audit.md
  - Rate overall risk: LOW / MEDIUM / HIGH / CRITICAL
  - List recommendations by severity

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

KEY NOTES
━━━━━━━━

✓ Runs against PRODUCTION API (http://localhost:4001 or https://api.vcrcapps.com)
✓ NO sandbox required
✓ Read-only inspection (no patches)
✓ If HIGH findings discovered: STOP and file GitHub issue (don't patch)
✓ All findings documented in report (docs/ai/runs/2026-07-20-live-security-audit.md)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"

echo "Files to reference:"
echo ""
echo "  Prompt template:"
echo "    cat docs/ai/AGENT_PROMPT_LIVE_SECURITY_AUDIT.txt"
echo ""
echo "  Detailed guide:"
echo "    cat docs/ai/audit-security-concerns-live.md"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
