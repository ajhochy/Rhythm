/**
 * server.ts starts the API at import time, so this focused contract inspects
 * the production composition rather than importing a listener. The adapter's
 * behavioral coverage lives beside the qualified producer tests.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.join(__dirname, '..', 'server.ts'), 'utf8');

function coordinatorReferenceConstruction(): string {
  const start = source.indexOf('const dayflowReferences = createDayflowCoordinatorReferenceAdapter({');
  expect(start, 'server must compose the qualified Dayflow coordinator adapter').toBeGreaterThan(-1);
  const end = source.indexOf('const conversationSessions = new AgentSessionsRepository()', start);
  expect(end, 'conversation construction follows the Dayflow adapter').toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('server.ts Dayflow coordinator composition', () => {
  it('binds the durable conversation context to the current qualified reader and persisted authority', () => {
    const construction = coordinatorReferenceConstruction();
    expect(source).toContain('{ createDayflowCoordinatorReferenceAdapter }');
    expect(construction).toMatch(/reader:\s*\(\)\s*=>\s*dayflowService/);
    expect(construction).toMatch(/authority:\s*\(\)\s*=>\s*dayflowQualificationAuthority/);
    expect(source).not.toContain('new DayflowCoordinatorReferenceAdapter()');

    const authority = source.indexOf('dayflowQualificationAuthority = new DayflowPersistedQualificationAuthority');
    const producer = source.indexOf('dayflowService = new DayflowIntegrationService');
    expect(authority, 'server constructs the persisted authority').toBeGreaterThan(-1);
    expect(producer, 'server constructs the existing qualified producer').toBeGreaterThan(authority);
    expect(source.slice(producer, producer + 900)).toContain('qualificationAuthority: dayflowQualificationAuthority');
  });

  it('uses the existing minute workstream callback for receipt renewal without a second scheduler binding', () => {
    const callback = source.slice(
      source.indexOf('onOneShotWorkstreamTick: async () => {'),
      source.indexOf('},\n      });', source.indexOf('onOneShotWorkstreamTick: async () => {')),
    );
    expect(callback).toContain('dayflowService?.renewQualifiedEvidenceOnSchedulerTick()');
    expect(source).not.toContain('startDayflowRenewalScheduler');
  });
});
