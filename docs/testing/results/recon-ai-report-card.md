# report-card live Recon — 2026-10-20

Actual locally built candidate d7fb554735, signed 0.18.83, normal packaged lifecycle. Read-only except one nonce-owned cookbook recipe, deleted 204 and readback 404. No model prompt sent. Source response fields/statuses/counts are recorded without private bodies.

```json
[
  {
    "observation": "AI_RECON",
    "route": "tools/report-card",
    "observations": [],
    "ui": {
      "title": "Agent Report Card",
      "ids": [
        "tool-page-report-card",
        "tool-back",
        "tool-state-select",
        "tool-workspace-content",
        "tool-content-action-gate",
        "report-window",
        "report-refresh",
        "tool-trace",
        "page-state-loading",
        "research-magazine-tools",
        "research-magazine-versions",
        "research-magazine-diff",
        "research-magazine-export-html",
        "research-magazine-export-markdown",
        "research-magazine-comments-toggle"
      ],
      "hosts": [],
      "alerts": []
    }
  },
  {
    "observation": "FOCUS_RECON",
    "slug": "report-card",
    "status": 200,
    "keys": [
      "generatedAt",
      "windowDays",
      "agents"
    ],
    "rowKeys": [
      "agentKind",
      "agentLabel",
      "totalRuns",
      "completedRuns",
      "escalatedRuns",
      "inProgressRuns",
      "unmeasuredRuns",
      "notEnoughData",
      "completionRate",
      "escalationRate",
      "totalTokens",
      "wastedTokens",
      "wastePercentOfSpend",
      "totalUserCorrections",
      "avgCorrectionsPerRun",
      "repeatedMistakes"
    ],
    "count": 31
  }
]
```

Unavailable states are observations, not successful feature qualification. See combined recon JSON for native bridge statuses.
