import { useEffect, useState } from 'react';
import { useRhythmDomainGateway } from '../context';
import { ScreenRoot } from './ScreenRoot';
import type { RhythmIntegration } from '../domain/types';

export function IntegrationsScreen() {
  const { integrations } = useRhythmDomainGateway();
  const [items, setItems] = useState<RhythmIntegration[]>([]);

  useEffect(() => {
    let cancelled = false;
    void integrations.list().then((loaded) => {
      if (!cancelled) setItems(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [integrations]);

  const toggle = async (integration: RhythmIntegration) => {
    const updated = await integrations.setConnected(integration.id, !integration.connected);
    setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  };

  return (
    <ScreenRoot screenName="Integrations" testId="rhythm-integrations-screen">
      <h1>Integrations</h1>
      <ul data-testid="rhythm-integrations-list">
        {items.map((integration) => (
          <li key={integration.id} data-testid={`rhythm-integration-row-${integration.id}`}>
            <span>{integration.name}</span>
            <span> · {integration.connected ? 'Connected' : 'Not connected'}</span>
            <button type="button" onClick={() => void toggle(integration)} data-testid={`rhythm-integration-toggle-${integration.id}`}>
              {integration.connected ? 'Disconnect' : 'Connect'}
            </button>
          </li>
        ))}
      </ul>
    </ScreenRoot>
  );
}
