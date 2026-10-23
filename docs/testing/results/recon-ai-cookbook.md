# cookbook live Recon — 2026-10-20

Actual locally built candidate d7fb554735, signed 0.18.83, normal packaged lifecycle. Read-only except one nonce-owned cookbook recipe, deleted 204 and readback 404. No model prompt sent. Source response fields/statuses/counts are recorded without private bodies.

```json
[
  {
    "observation": "AI_RECON",
    "route": "tools/cookbook",
    "observations": [
      {
        "path": "/agent-cookbook",
        "queryKeys": [],
        "status": 200,
        "shape": "array",
        "count": 0,
        "rowKeys": []
      }
    ],
    "ui": {
      "title": "Cookbook",
      "ids": [
        "tool-page-cookbook",
        "tool-back",
        "tool-state-select",
        "tool-workspace-content",
        "tool-content-action-gate",
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
    "observation": "COOKBOOK_RECON",
    "status": 201,
    "keys": [
      "id",
      "title",
      "description",
      "stepsJson",
      "boundConfigId",
      "ownerUserId",
      "createdAt",
      "updatedAt",
      "schemaVersion",
      "definitionJson",
      "format"
    ],
    "rowVisible": true
  },
  {
    "observation": "COOKBOOK_CLEANUP",
    "deleted": 204,
    "readback": 404
  }
]
```

Unavailable states are observations, not successful feature qualification. See combined recon JSON for native bridge statuses.
