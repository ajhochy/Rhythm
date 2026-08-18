# Testing guide

- Install assumptions: dependencies are already present for this workspace copy.
- Typecheck: `npx tsc -b --pretty false`
- Build: `npm run build`
- Enumerate Playwright coverage: `npm run test:list`
- Targeted page tests: `npx playwright test tests/pages/<page>.spec.ts --workers=1`
- Contract tests: `npm run test:contract`
- Built artifact smoke: `npm run test:dist-smoke`

Playwright browser launch can be blocked by the macOS sandbox with a Mach port permission error. Treat that as an environment limitation, not a product pass. The production app is a static Vite artifact and has no separate health endpoint.

