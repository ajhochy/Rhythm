---
date: 2026-07-08
repo: Rhythm
branch: null
pr: null
issues: []
status: complete
tags: [run, rhythm, config-doctor, obsidian]
---

# Config Doctor: Librarian Agent Refactor

This session refactored the `librarian` agent from a simple placeholder into a "Vault Expert Manager" with a broader, more flexible role.

## Summary of Actions

1.  **Architectural Design:** Based on user feedback, designed a new architecture for the `librarian` agent, defining it as a broad expert with a toolkit of skills, rather than a single-task agent.
2.  **Skill Implementation:**
    - Created a new, dedicated `obsidian-nightly-maintenance` skill containing the detailed, two-job workflow for project sync and vault health passes.
    - Created a new placeholder skill, `find-note-connections`, to capture the user's request for a future capability.
3.  **Agent Profile Update:**
    - Updated the `librarian` agent's `systemPrompt` to reflect its new role as a "Vault Expert Manager".
    - Updated its `allowedSkillsJson` to include a full toolkit of vault-related skills (`obsidian-cli`, `json-canvas`, `consolidate-memory`, etc.), making it a more powerful and flexible specialist.
4.  **Task Automation:**
    - Created a new nightly scheduled task to run the `obsidian-nightly-maintenance` skill automatically at 2:00 AM daily.
