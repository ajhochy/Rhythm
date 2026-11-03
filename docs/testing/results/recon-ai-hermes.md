# hermes live Recon — 2026-10-20

Actual locally built candidate d7fb554735, signed 0.18.83, normal packaged lifecycle. Read-only except one nonce-owned cookbook recipe, deleted 204 and readback 404. No model prompt sent. Source response fields/statuses/counts are recorded without private bodies.

```json
[
  {
    "observation": "AI_RECON",
    "route": "hermes",
    "observations": [
      {
        "path": "/shared-agents/v1/catalog",
        "queryKeys": [],
        "status": 200,
        "shape": [
          "schema",
          "generatedAt",
          "scope",
          "agents"
        ],
        "count": 54,
        "rowKeys": [
          "schema",
          "id",
          "revision",
          "canonical",
          "runtimes"
        ]
      }
    ],
    "ui": {
      "ids": [
        "page-hermes",
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
          "phase": null
        }
      ],
      "alerts": []
    }
  },
  {
    "observation": "CHILD_RECON",
    "route": "hermes",
    "children": [
      {
        "protocol": "file:",
        "path": "hermes-desktop/renderer/index.html",
        "title": "Hermes",
        "controls": [
          {
            "tag": "INPUT",
            "placeholder": "Search sessions\u2026",
            "label": "Search sessions"
          },
          {
            "tag": "DIV",
            "placeholder": null,
            "label": "Message"
          },
          {
            "tag": "TEXTAREA",
            "placeholder": null,
            "label": null
          }
        ]
      }
    ]
  }
]
```

Unavailable states are observations, not successful feature qualification. See combined recon JSON for native bridge statuses.

Additional gateway observation: `/api/sessions?limit=1&archived=exclude` returned a `sessions` array of six records. No contract for a `limit` cap was established. Overlay recovery is therefore codified as before/after identity equality using the same history request, without a guessed page-size assertion.
