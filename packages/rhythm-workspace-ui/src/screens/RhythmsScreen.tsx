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
            <span> · {rhythm.cadence}</span>
            <span> · next {rhythm.nextOccurrence}</span>
          </li>
        ))}
      </ul>
    </ScreenRoot>
  );
}
