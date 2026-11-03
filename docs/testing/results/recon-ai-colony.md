# colony live Recon — 2026-10-20

Actual locally built candidate d7fb554735, signed 0.18.83, normal packaged lifecycle. Read-only except one nonce-owned cookbook recipe, deleted 204 and readback 404. No model prompt sent. Source response fields/statuses/counts are recorded without private bodies.

```json
[
  {
    "observation": "AI_RECON",
    "route": "colony",
    "observations": [],
    "ui": {
      "ids": [
        "page-colony",
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
    "route": "colony",
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
      },
      {
        "protocol": "rhythm-colony:",
        "path": "/index.html",
        "title": "Bot Crossing",
        "controls": [
          {
            "tag": "INPUT",
            "placeholder": "Find project, branch, path or task",
            "label": "Search projects and sessions"
          },
          {
            "tag": "INPUT",
            "placeholder": null,
            "label": null
          },
          {
            "tag": "INPUT",
            "placeholder": null,
            "label": "Tilt-shift blur"
          },
          {
            "tag": "INPUT",
            "placeholder": null,
            "label": "Tilt-shift angle"
          },
          {
            "tag": "INPUT",
            "placeholder": null,
            "label": "Render scale"
          },
          {
            "tag": "INPUT",
            "placeholder": null,
            "label": "Scatter"
          },
          {
            "tag": "INPUT",
            "placeholder": null,
            "label": "Max bots"
          },
          {
            "tag": "INPUT",
            "placeholder": null,
            "label": "Time of day"
          },
          {
            "tag": "INPUT",
            "placeholder": null,
            "label": "Cycle length"
          },
          {
            "tag": "INPUT",
            "placeholder": null,
            "label": "Environment"
          }
        ]
      }
    ]
  }
]
```

Unavailable states are observations, not successful feature qualification. See combined recon JSON for native bridge statuses.

Additional native control observation: the pinned child renders `<input id="filter-query" type="search" aria-label="Search projects and sessions">`. Its accessible role is searchbox, not textbox. The first assertion selected the wrong role; no inventory IPC had yet been invoked.

Retention Recon: the full packaged run observed the original child still open after route departure (20-second observation), matching colony-view.mjs suspendCurrent/resumeCurrent and detach handlers. The old test expectation that detach destroys the page was a codify error. Correct contract: preserve one actual child and regain usable inventory after returning. The separate direct inventory check returned Colony document revoked; this remains a runtime failure to reproduce, not a reason to skip inventory readback.
