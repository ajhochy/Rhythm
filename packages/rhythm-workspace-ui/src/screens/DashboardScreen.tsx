import { useEffect, useState } from 'react';
import { useRhythmDomainGateway } from '../context';
import { ScreenRoot } from './ScreenRoot';
import type { RhythmDashboardSummary } from '../domain/types';

export function DashboardScreen() {
  const { dashboard } = useRhythmDomainGateway();
  const [summary, setSummary] = useState<RhythmDashboardSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void dashboard.summary().then((loaded) => {
      if (!cancelled) setSummary(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [dashboard]);

  return (
    <ScreenRoot screenName="Dashboard" testId="rhythm-dashboard-screen">
      <h1>Good to see you, {summary?.greetingName ?? '…'}</h1>
      <p data-testid="rhythm-dashboard-open-count">{summary?.openTaskCount ?? 0} open tasks</p>
      <section aria-labelledby="rhythm-dashboard-today-title">
        <h2 id="rhythm-dashboard-today-title">Today</h2>
        <ul data-testid="rhythm-dashboard-today-list">
          {(summary?.todayTaskTitles ?? []).map((title) => (
            <li key={title}>{title}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="rhythm-dashboard-upcoming-title">
        <h2 id="rhythm-dashboard-upcoming-title">Upcoming rhythms</h2>
        <ul data-testid="rhythm-dashboard-upcoming-list">
          {(summary?.upcomingRhythmTitles ?? []).map((title) => (
            <li key={title}>{title}</li>
          ))}
        </ul>
      </section>
    </ScreenRoot>
  );
}
