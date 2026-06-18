---
date: 2026-06-12
repo: rhythm
tags: [decision, rhythm]
---

# AgentFlow CLI resume requires AGENTFLOW_WORKFLOWS_DIR (process note)

**Context:** A `plan_and_issues` run died mid-flight when the agentflow MCP server restarted (its in-memory registry is lost on restart; phase outputs/state survive on disk). The documented recovery is CLI `agentflow resume <aflow> --instance <uuid>` — but the first attempt silently resolved model tiers from the built-in fallback (ollama `qwen2.5:14b`) and failed with `fetch failed`, because the model-resolver only reads `agentflow.config.json` from CWD or `$AGENTFLOW_WORKFLOWS_DIR`, and neither was set.

**Decision:** Always run CLI resumes as `AGENTFLOW_WORKFLOWS_DIR="$HOME/.config/agentflow/workflows" agentflow resume …` (that dir holds the canonical tier→model config: tier1=claude-fable-5, tier2=sonnet, tier3=haiku). With it set, the resume completed plan+write_issues correctly on tier1.

**Consequences:**
- + Stalled AgentFlow runs are recoverable without re-running completed phases.
- - The fallback-to-ollama behavior is silent until an agent executes; check the `📦 [agent] model:` line in resume output before trusting a resumed run.
