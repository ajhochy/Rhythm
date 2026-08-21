// PENDING PRODUCTION EXTRACTION (issue #4 remaining scope): placeholder view wired to the
// real IntegrationsGateway contract (account status + sync/disconnect only), not yet ported
// to feature parity with apps/web/src/pages/integrations (calendar source selection, Gmail
// signal review, authorization flows).
import { useEffect, useState } from 'react';
import { useRhythmDomainGateway } from '../context';
import { ScreenRoot } from './ScreenRoot';
import type { RhythmIntegrationAccount } from '../domain/types';

export function IntegrationsScreen() {
  const { integrations } = useRhythmDomainGateway();
  const [items, setItems] = useState<RhythmIntegrationAccount[]>([]);

  useEffect(() => {
    let cancelled = false;
    void integrations.accounts().then((loaded) => {
      if (!cancelled) setItems(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [integrations]);

  const toggle = async (account: RhythmIntegrationAccount) => {
    const updated = account.status === 'connected' ? await integrations.disconnect(account.id) : await integrations.sync(account.id);
    setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  };

  return (
    <ScreenRoot screenName="Integrations" testId="rhythm-integrations-screen">
      <h1>Integrations</h1>
      <ul data-testid="rhythm-integrations-list">
        {items.map((account) => (
          <li key={account.id} data-testid={`rhythm-integration-row-${account.id}`}>
            <span>{account.name}</span>
            <span> · {account.status}</span>
            <button type="button" onClick={() => void toggle(account)} data-testid={`rhythm-integration-toggle-${account.id}`}>
              {account.status === 'connected' ? 'Disconnect' : 'Connect'}
            </button>
          </li>
        ))}
      </ul>
    </ScreenRoot>
  );
}
