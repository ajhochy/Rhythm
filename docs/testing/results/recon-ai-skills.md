# skills live Recon — 2026-10-20

Actual locally built candidate d7fb554735, signed 0.18.83, normal packaged lifecycle. Read-only except one nonce-owned cookbook recipe, deleted 204 and readback 404. No model prompt sent. Source response fields/statuses/counts are recorded without private bodies.

```json
[
  {
    "observation": "AI_RECON",
    "route": "tools/skills",
    "observations": [],
    "ui": {
      "title": "Skills",
      "ids": [
        "tool-page-skills",
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
    "observation": "FOCUS_RECON",
    "slug": "skills",
    "status": 200,
    "keys": "array",
    "rowKeys": [
      "name",
      "description",
      "location",
      "managed",
      "source",
      "metadata"
    ],
    "count": 269
  }
]
```

Unavailable states are observations, not successful feature qualification. See combined recon JSON for native bridge statuses.

Additional timing observation: the actual `/opencode/skills` network response completed 200 after 20,916.286ms (wait=20,914.842ms, receive=1.444ms). A second reload request was still pending when the inherited 15-second test wait elapsed. Main-path response waits now use the same 60-second bounded discovery window; the measured latency remains a finding. Content read for the first catalog entry returned 404, independently of this timing correction.
