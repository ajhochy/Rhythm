import { useEffect, useState } from 'react';
import { useRhythmDomainGateway } from '../context';
import { ScreenRoot } from './ScreenRoot';
import type { RhythmPlannerDay } from '../domain/types';

export function PlannerScreen() {
  const { planner } = useRhythmDomainGateway();
  const [days, setDays] = useState<RhythmPlannerDay[]>([]);

  useEffect(() => {
    let cancelled = false;
    void planner.week().then((loaded) => {
      if (!cancelled) setDays(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [planner]);

  return (
    <ScreenRoot screenName="Planner" testId="rhythm-planner-screen">
      <h1>Planner</h1>
      <ol data-testid="rhythm-planner-week">
        {days.map((day) => (
          <li key={day.date} data-testid={`rhythm-planner-day-${day.date}`}>
            <h2>{day.label}</h2>
            <ul>
              {day.items.map((item) => (
                <li key={item.id}>{item.title}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </ScreenRoot>
  );
}
