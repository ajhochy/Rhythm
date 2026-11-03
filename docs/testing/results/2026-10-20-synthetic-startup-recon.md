# Synthetic packaged startup recon

Observed against locally rebuilt/signed product `8b6a4c3f2445ccb3e86deb925f6b1dbb00f7d3c5`; diagnostic Hermes source `c755d85f5eec53bb11e9f6c593bfa4e2810d6157`. Ordinary packaged launch, explicit private fixture manifest, no smoke bypass.

- API `GET /auth/me`: HTTP200 using the private session bearer through normal auth.
- API `GET /agent-configs`: HTTP200, nine fresh default profiles. Coding Agent/Secretary/Workflow Orchestrator/Verification Gate campaign profiles were absent.
- `GET /opencode/health`: `status=ready`, `bridgeLive=true`.
- Engine `GET /global/health`: healthy, exact `0.0.0-rhythm-8b6a4c3f2445ccb3e86deb925f6b1dbb00f7d3c5`.
- Chromium `rhythm://app/index.html#/agents` rendered “Live gateway could not start” and “production API base must be a remote HTTPS URL without credentials, query, or fragment.” The main content never mounted within90s.
- No first-use/UI feature actions were taken. App and owned runtime shut down. Private transcript/log remain under `/private/tmp/rhythm-ai-fixture-L2jkwn/`; no credential contents copied into this receipt.

This transcript is startup reconnaissance, not an assertion suite or feature qualification.
