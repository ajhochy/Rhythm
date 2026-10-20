# tasks live Recon — 2026-10-20

Actual locally built candidate d7fb554735, signed 0.18.83, normal packaged lifecycle. Read-only except one nonce-owned cookbook recipe, deleted 204 and readback 404. No model prompt sent. Source response fields/statuses/counts are recorded without private bodies.

```json
[
  {
    "observation": "AI_RECON",
    "route": "tools/tasks",
    "observations": [
      {
        "path": "/agent-schedules",
        "queryKeys": [],
        "status": 200,
        "shape": "array",
        "count": 33,
        "rowKeys": [
          "id",
          "name",
          "description",
          "scheduleType",
          "scheduledTime",
          "scheduledDay",
          "cronExpression",
          "runAt",
          "timezone",
          "nextRunAt",
          "prompt",
          "agentKind",
          "agentConfigId",
          "modelProvider",
          "modelId",
          "allowedMcpsJson",
          "allowedSkillsJson",
          "enabled",
          "lastRunAt",
          "lastRunStatus",
          "lastError",
          "createdByUserId",
          "createdAt",
          "updatedAt"
        ]
      }
    ],
    "ui": {
      "title": "Agent Schedules",
      "ids": [
        "tool-page-tasks",
        "tool-back",
        "tool-state-select",
        "tool-header-action-gate",
        "schedule-new",
        "tool-workspace-content",
        "tool-content-action-gate",
        "schedule-toggle",
        "schedule-edit",
        "schedule-delete",
        "schedule-run-context",
        "schedule-trigger"
      ],
      "hosts": [],
      "alerts": []
    }
  }
]
```

Unavailable states are observations, not successful feature qualification. See combined recon JSON for native bridge statuses.
