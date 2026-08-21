// PENDING PRODUCTION EXTRACTION (issue #4 remaining scope): placeholder view wired to the
// real PlannerGateway contract (single-week read-only view), not yet ported to feature
// parity with apps/web/src/pages/planner (week navigation, drag-to-schedule, backlog, events).
import { useEffect, useState } from 'react';
import { useRhythmDomainGateway } from '../context';
import { ScreenRoot } from './ScreenRoot';
import type { RhythmPlannerDay } from '../domain/types';

const CURRENT_WEEK_LABEL = 'current';

export function PlannerScreen() {
  const { planner } = useRhythmDomainGateway();
  const [days, setDays] = useState<RhythmPlannerDay[]>([]);

  useEffect(() => {
    let cancelled = false;
    void planner.week(CURRENT_WEEK_LABEL).then((loaded) => {
      if (!cancelled) setDays(loaded.days);
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
              {day.tasks.map((task) => (
                <li key={task.id}>{task.title}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </ScreenRoot>
  );
}
