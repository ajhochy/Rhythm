import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import {
  AgentConfigsRepository,
  type AgentConfig,
} from '../repositories/agent_configs_repository';
import * as mobileGatewayRoutes from '../routes/mobile_gateway_routes';

type SafeProfileCatalogBuilder = (
  configs: AgentConfig[],
) => {
  profiles: Array<Record<string, unknown>>;
};

function catalogBuilder(): SafeProfileCatalogBuilder {
  const candidate = (
    mobileGatewayRoutes as typeof mobileGatewayRoutes & {
      buildSafeMobileProfileCatalog?: SafeProfileCatalogBuilder;
    }
  ).buildSafeMobileProfileCatalog;
  expect(
    typeof candidate,
    'profile catalog must be projected by an explicit safe-shape builder',
  ).toBe('function');
  return candidate!;
}

describe('MSP-001 safe paired profile catalog', () => {
  let configs: AgentConfigsRepository;

  beforeEach(() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    configs = new AgentConfigsRepository();

    configs.insert({
      id: 'profile-safe',
      label: 'Coding Workflow',
      icon: 'terminal',
      enabled: true,
      sessionSelectable: true,
      ocAgent: 'build',
      modelProvider: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      reasoningEffort: 'high',
      systemPrompt: 'PROMPT_SECRET_MSP_001',
      allowedSkillsJson: JSON.stringify(['PRIVATE_SKILL_MSP_001']),
      corePermissionsJson: JSON.stringify({
        env: { PRIVATE_ENV_MSP_001: 'PRIVATE_VALUE_MSP_001' },
        credential: 'PRIVATE_CREDENTIAL_MSP_001',
      }),
    });
    configs.insert({
      id: 'profile-disabled',
      label: 'Disabled',
      icon: 'block',
      enabled: false,
      sessionSelectable: true,
      ocAgent: 'disabled-agent',
    });
    configs.insert({
      id: 'profile-hidden',
      label: 'Hidden',
      icon: 'eye-off',
      enabled: true,
      sessionSelectable: false,
      ocAgent: 'hidden-agent',
    });
    configs.insert({
      id: 'profile-locked',
      label: 'Locked',
      icon: 'lock',
      enabled: true,
      sessionSelectable: true,
      ocAgent: 'locked-agent',
    });
    db.prepare(
      `UPDATE agent_configs SET locked = 1 WHERE id = 'profile-locked'`,
    ).run();
  });

  it('issue-1-c5: paired profile catalog is owner/project scoped and picker safe', () => {
    // Regression caught: the projection returns disabled, locked, or
    // subagent-only records instead of only phone-selectable profiles.
    const catalog = catalogBuilder()(configs.list());
    expect(
      catalog.profiles.find(
        (profile) => profile.profileId === 'profile-safe',
      ),
    ).toEqual({
      profileId: 'profile-safe',
      opencodeAgentId: 'build',
      name: 'Coding Workflow',
      defaults: {
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        reasoningEffort: 'high',
        approvalMode: 'default',
      },
      display: {
        icon: 'terminal',
        color: null,
      },
    });
    expect(
      catalog.profiles.map((profile) => profile.profileId),
    ).not.toEqual(expect.arrayContaining([
      'profile-disabled',
      'profile-hidden',
      'profile-locked',
    ]));
  });

  it('issue-1-c6: profile catalog response excludes secret and executable configuration fields', () => {
    // Regression caught: mapping an AgentConfig wholesale leaks its system
    // prompt, skills, environment values, permissions, or credentials.
    const serialized = JSON.stringify(catalogBuilder()(configs.list()));
    for (const forbidden of [
      'systemPrompt',
      'allowedSkillsJson',
      'allowedMcpsJson',
      'corePermissionsJson',
      'allowedDelegatesJson',
      'defaultAnthropicAccountId',
      'PROMPT_SECRET_MSP_001',
      'PRIVATE_SKILL_MSP_001',
      'PRIVATE_ENV_MSP_001',
      'PRIVATE_VALUE_MSP_001',
      'PRIVATE_CREDENTIAL_MSP_001',
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it('issue-1-c10: profile catalog fails closed before returning data', () => {
    // Regression caught: the catalog is registered without both existing
    // fail-closed device authentication and project-scope middleware.
    const router = mobileGatewayRoutes.createMobileGatewayRouter() as unknown as {
      stack: Array<{
        route?: {
          path?: string;
          methods?: Record<string, boolean>;
          stack?: unknown[];
        };
      }>;
    };
    const layer = router.stack.find(
      (candidate) => candidate.route?.path === '/profile-catalog',
    );
    expect(layer?.route?.methods?.get).toBe(true);
    expect(
      layer?.route?.stack,
      'GET /profile-catalog must run auth + project scope before its handler',
    ).toHaveLength(3);
  });
});
