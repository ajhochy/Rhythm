# dayflow live Recon — 2026-10-20

Actual locally built candidate d7fb554735, signed 0.18.83, normal packaged lifecycle. Read-only except one nonce-owned cookbook recipe, deleted 204 and readback 404. No model prompt sent. Source response fields/statuses/counts are recorded without private bodies.

```json
[
  {
    "observation": "AI_RECON",
    "route": "tools/dayflow",
    "observations": [
      {
        "path": "/agents/run-quality",
        "queryKeys": [
          "windowDays"
        ],
        "status": 200,
        "shape": [
          "generatedAt",
          "windowDays",
          "agents"
        ],
        "count": 31,
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
        ]
      },
      {
        "path": "/agent-research/projects",
        "queryKeys": [],
        "status": 200,
        "shape": "array",
        "count": 2,
        "rowKeys": [
          "id",
          "ownerUserId",
          "name",
          "question",
          "goals",
          "domain",
          "profileId",
          "passConfig",
          "modelPolicy",
          "criticConfig",
          "synthesisConfig",
          "scheduleRef",
          "budget",
          "magazineArtifactId",
          "archivedAt",
          "createdAt",
          "updatedAt"
        ]
      },
      {
        "path": "/agent-designs",
        "queryKeys": [],
        "status": 200,
        "shape": "array",
        "count": 22,
        "rowKeys": [
          "id",
          "title",
          "provider",
          "artifactUrl",
          "projectUrl",
          "canvaUrl",
          "artifactType",
          "thumbnailUrl",
          "sessionId",
          "folderId",
          "createdAt"
        ]
      }
    ],
    "ui": {
      "ids": [
        "tool-page-dayflow",
        "dayflow-native-host",
        "page-state-loading",
        "research-magazine-tools",
        "research-magazine-versions",
        "research-magazine-diff",
        "research-magazine-export-html",
        "research-magazine-export-markdown",
        "research-magazine-comments-toggle"
      ],
      "hosts": [
        {
          "tag": "DIV",
          "busy": null,
          "phase": "unavailable"
        }
      ],
      "alerts": []
    }
  }
]
```

Unavailable states are observations, not successful feature qualification. See combined recon JSON for native bridge statuses.
