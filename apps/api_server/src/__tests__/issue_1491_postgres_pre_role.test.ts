import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('issue-1491-c1: cloud bootstrap retains scheduled task profile', () => {
  it('adds nullable agent_config_id exactly once before cloud role returns', () => {
    const source = readFileSync(join(__dirname, '../database/postgres_bootstrap.ts'), 'utf8');
    const statement = /ALTER TABLE agent_scheduled_tasks ADD COLUMN IF NOT EXISTS agent_config_id TEXT/g;
    const positions = [...source.matchAll(statement)].map(match => match.index);
    expect(positions).toHaveLength(1);
    expect(positions[0]).toBeLessThan(source.indexOf('if (!env.agentExecutionEnabled)'));
  });
});
