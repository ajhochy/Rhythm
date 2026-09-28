// #1576 S4 test-only helper.
//
// A Playwright spec that hand-imports React from a hardcoded
// `/node_modules/.vite/deps/react.js` URL (bypassing Vite's own import
// rewriting) can end up with a DIFFERENT React module instance than the one
// the dynamically-imported component under test resolves via its own
// `import ... from 'react'` — Vite's dep-optimization hash can drift between
// the two request forms, especially with node_modules shared across
// worktrees. Symptom: "Invalid hook call" / "Cannot read properties of null
// (reading 'useContext')" even though the component itself is correct.
//
// Fix: never hardcode the deps URL. This file is itself served and
// transformed by the SAME Vite dev server instance as the component under
// test, so its own `import React from 'react'` resolves to the exact same
// versioned URL Vite hands the component — one React, one dispatcher.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { GatewayProvider } from '../../../src/gateway/context';
import { composeGateway, type GatewayEnvironment } from '../../../src/gateway';

export function mountLive(
  Component: React.ComponentType<Record<string, unknown>>,
  props: Record<string, unknown>,
  environment: GatewayEnvironment,
): void {
  const gateway = composeGateway(environment);
  const root = createRoot(document.getElementById('root')!);
  root.render(React.createElement(GatewayProvider, { gateway }, React.createElement(Component, props)));
}
