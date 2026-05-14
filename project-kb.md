# Issue 463

- read issue #463 on github and create a plan to solve.
- launch locally so i can test.
- ont bother. the app looks at the synology api server, not local. did you do any changes to what will end up on synology?there are two servers. one for the big api server, hosted on synology externally, one for the cli, that is bundled with the desktop client and launches when the desktop client launches.
- commit to new branch and create PR on github, then merge w main on github. changes
- trigger release for synology and desktop client
- mark issue complete

## 2026-05-13 - Opencode engine design for replacing CliDeck/agent server
- Researched Opencode (anomalyco/opencode) as a replacement for CliDeck and the current agent server CLI-subprocess approach
- Key findings: Opencode supports BYO per-user auth via OAuth (Claude Pro, ChatGPT Plus, GitHub Copilot) + API keys, has a client/server architecture with SDK, and is 100% open source (MIT, 160K stars)
- Spec written: `docs/superpowers/specs/2026-05-13-opencode-engine-design.md`
- Named the modified local process "Opencode engine" to distinguish from the production API server on Synology
- Key design decisions: embed SDK in-process in apps/api_server, per-user AI auth, local per-user deployment, "middle" default model (Sonnet/GPT-4o), fresh sessions (no migration)
- Implementation plan: 10 tasks replacing pty_runner with @opencode-ai/sdk, adding auth endpoints and Flutter auth UI
- 10 GitHub issues created (#564-#573) on ajhochy/Rhythm
