import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentCookbookRepository } from '../../repositories/agent_cookbook_repository';
import { AgentWebhookEndpointsRepository } from '../../repositories/agent_webhook_endpoints_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { applyWebhookWiring } from '../generators/webhook_wiring_generator';

describe('webhook proposal trigger identity', () => {
  it('creates the exact reviewed trigger even when the human review title differs', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const previous = setDb(db);
    try {
      const recipe = await new AgentCookbookRepository().createAsync({ title: 'Owned target',
        stepsJson: '["Reply ROUTED_OK"]' });
      const proposal = await new AgentOrgProposalsRepository().createAsync({
        kind: 'webhook-wiring', risk: 'high', status: 'proposed',
        title: 'Add an inbound review hook for repeated work',
        targetRef: 'webhook:Owned endpoint',
        changeJson: JSON.stringify({ triggerSource: 'Owned endpoint', targetRecipeId: recipe.id,
          eventTypes: ['evaluation.probe'] }),
      });
      await applyWebhookWiring(proposal);
      const rows = await new AgentWebhookEndpointsRepository().listAsync();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ name: 'Owned endpoint', targetRecipeId: recipe.id });
    } finally {
      setDb(previous);
      db.close();
    }
  });

  it('rejects a trigger source that does not match the reviewed target before creating an endpoint', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const previous = setDb(db);
    try {
      const recipe = await new AgentCookbookRepository().createAsync({ title: 'Owned target',
        stepsJson: '["Reply ROUTED_OK"]' });
      const proposal = await new AgentOrgProposalsRepository().createAsync({
        kind: 'webhook-wiring', risk: 'high', status: 'proposed', title: 'Readable review title',
        targetRef: 'webhook:Expected endpoint',
        changeJson: JSON.stringify({ triggerSource: 'Different endpoint', targetRecipeId: recipe.id }),
      });
      await expect(applyWebhookWiring(proposal)).rejects.toThrow(/trigger source differs/);
      expect(await new AgentWebhookEndpointsRepository().listAsync()).toHaveLength(0);
    } finally {
      setDb(previous);
      db.close();
    }
  });
});
