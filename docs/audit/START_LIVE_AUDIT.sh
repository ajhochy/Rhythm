#!/bin/bash

# One-liner to start the live security audit
# Copy the prompt to clipboard and print instructions

PROMPT_FILE="docs/ai/AGENT_PROMPT_LIVE_SECURITY_AUDIT.txt"

if [ ! -f "$PROMPT_FILE" ]; then
  echo "Error: $PROMPT_FILE not found"
  exit 1
fi

echo "
╔════════════════════════════════════════════════════════════════════════════╗
║                   LIVE SECURITY AUDIT — QUICK START                       ║
╚════════════════════════════════════════════════════════════════════════════╝

📋 AUDIT PROMPT:

"

# Read and print the prompt
cat "$PROMPT_FILE"

echo "

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ COPY-PASTE INSTRUCTIONS:

1. Copy the entire prompt above (from 'Task: Live Security Audit' to the end)
   
   macOS:  pbcopy < $PROMPT_FILE
   Linux:  cat $PROMPT_FILE | xclip -selection clipboard

2. Open Claude Code or Rhythm app

3. Create a new agent session:
   - Name: 'Live Security Audit — Production Build'
   - Agent: 'claude-code' (or any agent with file/API access)
   - Prompt: [paste the audit prompt]

4. Follow the audit (4 phases, ~60 min)

5. After completion, review findings at:
   docs/ai/runs/2026-07-20-live-security-audit.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📂 REFERENCE FILES:

- Summary:  cat docs/ai/LIVE_AUDIT_SUMMARY.md
- Guide:    cat docs/ai/audit-security-concerns-live.md
- Index:    cat SECURITY_AUDIT_INDEX.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"
