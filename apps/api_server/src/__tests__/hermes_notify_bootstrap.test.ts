import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { getDb } from '../database/db';
import { HermesNotifyService } from '../services/hermes_notify_service';
import { opencodeEventHub } from '../services/opencode_event_hub';

describe('Hermes notification bootstrap ownership', () => {
  it('constructs repeated apps without a DB or notification subscriptions', () => {
    expect(() => getDb()).toThrow('Database not initialized');
    const subscribers = opencodeEventHub.subscriberCount();
    expect(() => { createApp(); createApp(); }).not.toThrow();
    expect(opencodeEventHub.subscriberCount()).toBe(subscribers);
    expect(() => getDb()).toThrow('Database not initialized');
  });

  // server.ts executes main on import; use the existing startup source-contract pattern.
  it('initializes and subscribes after DB readiness, gated before execution producers', () => {
    const source = readFileSync(path.join(__dirname, '..', 'server.ts'), 'utf8');
    const startup = source.match(/if \(env\.agentExecutionEnabled && env\.dbClient === 'sqlite' && !env\.isRelayRole\) \{[^}]+hermesNotifyService\.start\(\);[^}]*\}/)?.[0];
    expect(startup, 'explicit local notification bootstrap must exist').toBeDefined();
    const start = source.indexOf(startup!);
    expect(start).toBeGreaterThan(source.indexOf('await initDb();'));
    expect(startup!.indexOf('hermesNotifyService.initialize();')).toBeLessThan(startup!.indexOf('hermesNotifyService.start();'));
    for (const producer of ['startRecurrenceGenerationJob();', 'startSyncOrchestratorJob();', 'startAgentSchedulerJob();', 'createApp({', 'attachWsGateway(httpServer', '.initialize()']) {
      expect(start, producer).toBeLessThan(source.indexOf(producer));
    }
    expect(source.slice(source.indexOf('const shutdown ='))).toContain('hermesNotifyServiceRef?.stop()');
  });

  it('stops only its subscription and cannot rearm after shutdown or an immediate restart', async () => {
    const service = new HermesNotifyService();
    const unrelated = opencodeEventHub.subscribe();
    const baseline = opencodeEventHub.subscriberCount();
    try {
      service.start();
      service.start();
      expect(opencodeEventHub.subscriberCount()).toBe(baseline + 1);
      expect(typeof (service as any).stop).toBe('function');
      (service as any).stop();
      service.start();
      await new Promise(resolve => setTimeout(resolve, 1100));
      expect(opencodeEventHub.subscriberCount()).toBe(baseline + 1);
      (service as any).stop();
      (service as any).stop();
      await new Promise(resolve => setTimeout(resolve, 1100));
      expect(opencodeEventHub.subscriberCount()).toBe(baseline);
    } finally {
      (service as any).stop?.();
      unrelated.close();
    }
  });
});
