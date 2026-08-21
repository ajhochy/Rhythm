// PENDING PRODUCTION EXTRACTION (issue #4 remaining scope): placeholder view wired to the
// real RhythmsGateway contract (roster only), not yet ported to feature parity with
// apps/web/src/pages/rhythms (step editing, collaborator management, completion tracking).
import { useEffect, useState } from 'react';
import { useRhythmDomainGateway } from '../context';
import { ScreenRoot } from './ScreenRoot';
import type { RhythmRhythm } from '../domain/types';

export function RhythmsScreen() {
  const { rhythms } = useRhythmDomainGateway();
  const [items, setItems] = useState<RhythmRhythm[]>([]);

  useEffect(() => {
    let cancelled = false;
    void rhythms.list().then((loaded) => {
      if (!cancelled) setItems(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [rhythms]);

  return (
    <ScreenRoot screenName="Rhythms" testId="rhythm-rhythms-screen">
      <h1>Rhythms</h1>
      <ul data-testid="rhythm-rhythms-list">
        {items.map((rhythm) => (
          <li key={rhythm.id} data-testid={`rhythm-rhythm-row-${rhythm.id}`}>
            <span>{rhythm.title}</span>
            <span> · {rhythm.frequency}</span>
            <span> · next {rhythm.nextDueDate ?? 'unscheduled'}</span>
          </li>
        ))}
      </ul>
    </ScreenRoot>
  );
}
