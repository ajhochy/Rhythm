import React from 'react';
import { createRoot } from 'react-dom/client';
import { composeGateway } from '../src/gateway';
import { GatewayProvider } from '../src/gateway/context';
import { AuthUserProvider } from '../src/gateway/auth';
import { FixtureProvider } from '../src/store';
import { Shell } from '../src/components/Shell';
import { SessionRail } from '../src/components/SessionRail';
import '../src/styles.css';

const gateway = composeGateway({ mode: 'fixture' });
const user = { id: 811, name: 'Morgan Fixture', email: 'morgan@example.invalid', role: 'user' };
createRoot(document.getElementById('root')!).render(
  <AuthUserProvider user={user}>
    <GatewayProvider gateway={gateway}>
      <FixtureProvider>
        <Shell route="/agents">
          <SessionRail collapsed={false} onToggle={() => {}} selectedProject={null} onSelectProject={() => {}} />
        </Shell>
      </FixtureProvider>
    </GatewayProvider>
  </AuthUserProvider>,
);
