/**
 * server.ts starts the API at import time, so this focused contract inspects
 * the production composition rather than importing a listener. The adapter's
 * behavioral coverage lives beside the qualified producer tests.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

  it('shares one native enrollment across every Dayflow body producer (what licenses guardRegistrationVersion 1)', () => {
    const start = source.indexOf('const dayflowEnrollment = new DayflowGuardEnrollmentService(');
    expect(start, 'server composes the shared enrollment').toBeGreaterThan(-1);
    const block = source.slice(start, source.indexOf('createApp', start));
    // V1 search/recent producer, history guard and V2 admission all carry the SAME enrollment object.
    expect(block.match(/enrollment:\s*dayflowEnrollment/g)).toHaveLength(3);
    expect(block).toMatch(/new DayflowQualifiedEvidenceService\(\{[\s\S]*?enrollment: dayflowEnrollment[\s\S]*?\}\)/);
    expect(block).toMatch(/new DayflowProviderAdmissionService\(\{[\s\S]*?enrollment: dayflowEnrollment/);
    expect(source).toContain('dayflowProviderAdmission,');

    // No other production site can build a V1/V2 Dayflow body without that enrollment.
    const sources = ['services', 'routes', 'controllers', 'tools'].flatMap((dir) => {
      const base = path.join(__dirname, '..', dir);
      return existsSync(base) ? readdirSync(base).filter((f) => f.endsWith('.ts')).map((f) => path.join(base, f)) : [];
    });
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      expect(text.includes('new DayflowQualifiedEvidenceService('), file).toBe(false);
    }
    expect(source.match(/new DayflowQualifiedEvidenceService\(/g)).toHaveLength(1);
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
