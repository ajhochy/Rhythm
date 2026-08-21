import { createContext, useContext, type ReactNode } from 'react';
import type { RhythmDomainGateway } from './domain/types';
import type { RhythmHostAdapter } from './host/types';

const DomainGatewayContext = createContext<RhythmDomainGateway | null>(null);
const HostAdapterContext = createContext<RhythmHostAdapter | null>(null);

export interface RhythmWorkspaceProviderProps {
  gateway: RhythmDomainGateway;
  host: RhythmHostAdapter;
  children: ReactNode;
}

/** The single composition root a host mounts once. It owns no React runtime of its own —
 * `react`/`react-dom` are peer dependencies (see package.json) — so nesting this inside a
 * host's existing tree never creates a second React instance. */
export function RhythmWorkspaceProvider({ gateway, host, children }: RhythmWorkspaceProviderProps) {
  return (
    <DomainGatewayContext.Provider value={gateway}>
      <HostAdapterContext.Provider value={host}>{children}</HostAdapterContext.Provider>
    </DomainGatewayContext.Provider>
  );
}

export function useRhythmDomainGateway(): RhythmDomainGateway {
  const gateway = useContext(DomainGatewayContext);
  if (!gateway) throw new Error('useRhythmDomainGateway must be used within RhythmWorkspaceProvider');
  return gateway;
}

export function useRhythmHost(): RhythmHostAdapter {
  const host = useContext(HostAdapterContext);
  if (!host) throw new Error('useRhythmHost must be used within RhythmWorkspaceProvider');
  return host;
}
