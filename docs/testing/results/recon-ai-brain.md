# brain live Recon — 2026-10-20

Actual locally built candidate d7fb554735, signed 0.18.83, normal packaged lifecycle. Read-only except one nonce-owned cookbook recipe, deleted 204 and readback 404. No model prompt sent. Source response fields/statuses/counts are recorded without private bodies.

```json
[
  {
    "observation": "AI_RECON",
    "route": "tools/brain",
    "observations": [
      {
        "path": "/agent-memory",
        "queryKeys": [
          "withCounts",
          "limit"
        ],
        "status": 200,
        "shape": [
          "items",
          "counts",
          "total",
          "offset",
          "limit"
        ],
        "count": 50,
        "rowKeys": [
          "id",
          "kind",
          "content",
          "title",
          "source",
          "sourceId",
          "tagsJson",
          "status",
          "staleAfter",
          "verifiedJson",
          "sourcesJson",
          "generatedBy",
          "generatedAt",
          "trustTier",
          "autoInjectable",
          "ownerUserId",
          "createdAt",
          "updatedAt",
          "lifecycleState",
          "unverifiable"
        ]
      }
    ],
    "ui": {
      "title": "Agent Memory",
      "ids": [
        "tool-page-brain",
        "tool-back",
        "tool-state-select",
        "tool-workspace-content",
        "tool-content-action-gate"
      ],
      "hosts": [],
      "alerts": []
    }
  }
]
```

Unavailable states are observations, not successful feature qualification. See combined recon JSON for native bridge statuses.
