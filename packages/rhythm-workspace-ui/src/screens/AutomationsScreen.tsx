// PENDING PRODUCTION EXTRACTION (issue #4 remaining scope): placeholder view wired to the
// real AutomationsGateway contract, not yet ported to feature parity with
// apps/web/src/pages/automations. No create/condition-editing UI here yet.
import { useEffect, useId, useState } from 'react';
import { useRhythmDomainGateway } from '../context';
import { ScreenRoot } from './ScreenRoot';
import type { RhythmAutomation } from '../domain/types';

function AutomationRow({ automation, onToggle }: { automation: RhythmAutomation; onToggle(next: boolean): void }) {
  const labelId = useId();
  return (
    <li data-testid={`rhythm-automation-row-${automation.id}`}>
      <label>
        <input
          type="checkbox"
          checked={automation.enabled}
          onChange={(event) => onToggle(event.target.checked)}
          aria-labelledby={labelId}
          data-testid={`rhythm-automation-toggle-${automation.id}`}
        />
        <span id={labelId}>{automation.name}</span>
      </label>
      <p>{automation.previewSummary}</p>
    </li>
  );
}

export function AutomationsScreen() {
  const { automations } = useRhythmDomainGateway();
  const [items, setItems] = useState<RhythmAutomation[]>([]);

  useEffect(() => {
    let cancelled = false;
    void automations.list().then((loaded) => {
      if (!cancelled) setItems(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [automations]);

  const toggle = async (automation: RhythmAutomation, enabled: boolean) => {
    const updated = await automations.update(automation.id, { enabled });
    setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  };

  return (
    <ScreenRoot screenName="Automations" testId="rhythm-automations-screen">
      <h1>Automations</h1>
      <ul data-testid="rhythm-automations-list">
        {items.map((automation) => (
          <AutomationRow automation={automation} onToggle={(enabled) => void toggle(automation, enabled)} key={automation.id} />
        ))}
      </ul>
    </ScreenRoot>
  );
}
