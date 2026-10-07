import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentToolsCatalog } from '../src/components/tools/AgentToolsCatalog';
import { OpenDesignPage } from '../src/pages/open-design';
import type { OpenDesignShell } from '../src/pages/open-design/bridge';
import '../src/styles.css';

// ?bridge=missing-attach | malformed-attach | unavailable | absent selects a deterministic failure path.
const mode = new URLSearchParams(window.location.search).get('bridge');
const mockShell: OpenDesignShell = { openDesignView: {
  getStatus: async () => mode === 'unavailable' ? { state: 'unavailable', code: 'unavailable' } : { state: 'ready' },
  // Public contract: success is exactly { ok: true } (no nonce); anything else is a failure.
  attach: async () => mode === 'missing-attach' ? undefined : mode === 'malformed-attach' ? ({ ok: 'yes' } as unknown as { ok: boolean }) : { ok: true },
  setBounds: async () => true,
  detach: async () => true,
} };
if (mode !== 'absent') (window as Window & { rhythmShell?: OpenDesignShell }).rhythmShell = mockShell;

function Fixture() {
  const [route, setRoute] = useState('/tools/agent-tools');
  return <main className="fixture-page"><p role="status">Fixture preview</p><AgentToolsCatalog scope="fixture-preview" availableIds={['hermes', 'bot-crossing', 'open-design', 'dayflow']} onOpen={(tool) => setRoute(tool.route)} />{route === '/open-design' ? <OpenDesignPage /> : <p data-testid="fixture-route">{route}</p>}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
