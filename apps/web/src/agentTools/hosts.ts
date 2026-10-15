import { colonyShell } from '../pages/colony/bridge';
import { hermesShell } from '../pages/hermes/bridge';
import { openDesignShell } from '../pages/open-design/bridge';

// Frozen Dayflow owner bridge shape, read through a local intersection only
// (no global redeclaration; the Dayflow owner keeps the real type).
type DayflowDesktopShell = { dayflowDesktop?: { getDayflowDesktopStatus?: unknown; openDayflowDesktop?: unknown } };

/**
 * Tool IDs whose host this build actually wires — the same checks Shell already
 * uses for the Hermes and Bot Crossing tabs. Pinning never makes a missing host appear.
 */
export function availableAgentToolIds(): string[] {
  const dayflow = (window as Window & { rhythmShell?: DayflowDesktopShell }).rhythmShell?.dayflowDesktop;
  return [
    ...(hermesShell()?.hermes?.enabled === true ? ['hermes'] : []),
    ...(colonyShell()?.colonyView ? ['bot-crossing'] : []),
    ...(openDesignShell()?.openDesignView ? ['open-design'] : []),
    ...(typeof dayflow?.getDayflowDesktopStatus === 'function' && typeof dayflow.openDayflowDesktop === 'function' ? ['dayflow'] : []),
  ];
}
