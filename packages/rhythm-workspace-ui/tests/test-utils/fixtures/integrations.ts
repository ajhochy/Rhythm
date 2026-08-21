import type { IntegrationsGateway, RhythmCalendarSource, RhythmGmailSignal, RhythmIntegrationAccount } from '../../../src/domain/types';
import { RhythmGatewayError } from '../../../src/domain/types';

function seedAccounts(): RhythmIntegrationAccount[] {
  return [
    { id: 'google-calendar', name: 'Google Calendar', monogram: 'GC', status: 'connected', identity: 'aj@example.test', lastSyncedAt: 'Today at 3:32 PM' },
    { id: 'gmail', name: 'Gmail', monogram: 'GM', status: 'needs_reauth', identity: 'aj@example.test', errorMessage: 'Google authorization expired.' },
    { id: 'planning-center', name: 'Planning Center', monogram: 'PC', status: 'connected', identity: 'Rhythm Community Church', lastSyncedAt: 'Today at 3:21 PM' },
  ];
}

function seedCalendarSources(): RhythmCalendarSource[] {
  return [
    { id: 'cal-primary', name: 'AJ Hochhalter', description: 'Primary account calendar', primary: true, selected: true },
    { id: 'cal-team', name: 'Worship team calendar', description: 'Worship team planning and rehearsals', selected: true },
    { id: 'cal-community', name: 'Community Care', description: 'Care nights and neighborhood events', selected: false },
  ];
}

function seedGmailSignals(): RhythmGmailSignal[] {
  return [
    { id: 'signal-weekend-1', threadId: 'thread-weekend-team', subject: 'Weekend team schedule', sender: 'Mina Park', snippet: 'The bilingual welcome team is confirmed for Sunday.', unread: true },
    { id: 'signal-care', threadId: 'thread-community-care', subject: 'Community care launch', sender: 'Sam Rivera', snippet: 'Can we add two more volunteer stations?', unread: true },
  ];
}

export function fixtureIntegrationsGateway(): IntegrationsGateway {
  let accounts = seedAccounts();
  let calendarSources = seedCalendarSources();
  const authorizationRequests: string[] = [];
  return {
    accounts: async () => accounts,
    calendarSources: async () => calendarSources,
    saveCalendarSelection: async (selectedIds) => {
      calendarSources = calendarSources.map((source) => ({ ...source, selected: selectedIds.includes(source.id) }));
      return calendarSources;
    },
    gmailSignals: async () => seedGmailSignals(),
    sync: async (id) => {
      const existing = accounts.find((account) => account.id === id);
      if (!existing) throw new RhythmGatewayError('not_found', `unknown account ${id}`);
      const updated: RhythmIntegrationAccount = { ...existing, status: 'connected', lastSyncedAt: 'Just now', errorMessage: undefined };
      accounts = accounts.map((account) => (account.id === id ? updated : account));
      return updated;
    },
    disconnect: async (id) => {
      const existing = accounts.find((account) => account.id === id);
      if (!existing) throw new RhythmGatewayError('not_found', `unknown account ${id}`);
      const updated: RhythmIntegrationAccount = { ...existing, status: 'disconnected', identity: undefined, lastSyncedAt: undefined };
      accounts = accounts.map((account) => (account.id === id ? updated : account));
      return updated;
    },
    requestAuthorization: (id) => {
      authorizationRequests.push(id);
    },
  };
}

export function failingIntegrationsGateway(kind: 'forbidden' | 'not_found' | 'unavailable' | 'server_error'): IntegrationsGateway {
  const fail = async (): Promise<never> => { throw new RhythmGatewayError(kind, `simulated ${kind}`); };
  return { accounts: fail, calendarSources: fail, saveCalendarSelection: fail, gmailSignals: fail, sync: fail, disconnect: fail, requestAuthorization: () => {} };
}

export function emptyIntegrationsGateway(): IntegrationsGateway {
  const gateway = fixtureIntegrationsGateway();
  return { ...gateway, accounts: async () => [] };
}
