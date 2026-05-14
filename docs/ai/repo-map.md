# Repo Map

## Key directories

```
apps/
├── api_server/            ← Node.js/Express backend (runs locally, spawned by Flutter)
│   ├── src/
│   │   ├── server.ts      ← Entry point, Opencode engine init
│   │   ├── app.ts         ← Express app, route registrations
│   │   ├── controllers/   ← Request handlers
│   │   ├── routes/        ← Express routers
│   │   ├── services/      ← Business logic (OpencodeClientService, stream bridge, pty_runner legacy)
│   │   ├── repositories/  ← SQLite/Postgres data access
│   │   ├── models/        ← TypeScript interfaces
│   │   └── @types/        ← Local type declarations (opencode-ai-sdk.d.ts)
│   └── package.json
├── desktop_flutter/       ← macOS desktop app (Flutter)
│   └── lib/
│       ├── app/core/agents/     ← Agent server controller, trigger watcher
│       ├── features/agents/     ← Agent session view, data source
│       ├── features/agent_configs/ ← Agent preset management
│       └── features/settings/   ← Settings view, AI account widget
├── web/                   ← React/Vite UI (prototype, NOT shipping)
└── electron/              ← Electron wrapper (prototype, NOT shipping)

docs/
├── ai/                    ← Project memory files
│   ├── project-state.md   ← Current state and issues
│   ├── architecture.md    ← System architecture
│   ├── decisions.md       ← Key decisions
│   ├── repo-map.md        ← This file
│   └── testing-guide.md
├── superpowers/
│   ├── specs/             ← Design specs
│   └── plans/             ← Implementation plans
└── testing/
    └── first-stage-evaluation.md
```
