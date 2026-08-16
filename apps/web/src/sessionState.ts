import type { Session } from './types';

export interface SessionPresentation {
  label: string;
  tone: 'starting' | 'working' | 'idle' | 'resumable' | 'closed' | 'error' | 'waiting' | 'offline' | 'scheduled' | 'completed' | 'archived' | 'stuck';
  waiting: boolean;
}

export function sessionPresentation(session: Session): SessionPresentation {
  if (session.group === 'archived') return { label: 'Archived', tone: 'archived', waiting: false };
  if (session.permission?.status === 'pending' || session.question?.status === 'pending') return { label: 'Waiting on you', tone: 'waiting', waiting: true };
  if (session.connectionState === 'offline') return { label: 'Offline', tone: 'offline', waiting: false };
  if (session.connectionState === 'unavailable') return { label: 'Unavailable', tone: 'error', waiting: false };
  if (session.stuckSince) return { label: 'Stuck', tone: 'stuck', waiting: false };
  if (session.completedAt) return { label: 'Completed', tone: 'completed', waiting: false };
  if (session.scope === 'scheduled' && session.status === 'idle') return { label: 'Scheduled', tone: 'scheduled', waiting: false };
  const labels: Record<Session['status'], string> = { starting: 'Starting', working: 'Working', idle: 'Idle', resumable: 'Ready to resume', closed: 'Closed', error: 'Error' };
  return { label: labels[session.status], tone: session.status, waiting: false };
}

export function isSessionOffline(session: Session) {
  return session.connectionState === 'offline';
}

export function isSessionRecoverable(session: Session) {
  return session.status === 'resumable' || Boolean(session.completedAt) || Boolean(session.stuckSince) || session.connectionState === 'offline' || session.connectionState === 'unavailable';
}
