import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { parseCoordinatorConversationSetup } from '../contracts/coordinator_conversation_contract';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { ProjectsRepository } from '../repositories/projects_repository';
import {
  selectCoordinatorSetupProfile,
  validateCoordinatorSetupReplay,
} from '../services/coordinator_setup_profile_selection';

let db: Database.Database | null = null;
let previous: Database.Database | null = null;

function stockStores() {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  previous = setDb(db);
  return {
    configs: new AgentConfigsRepository(),
    projects: new ProjectsRepository(),
  };
}

describe('stock coordinator bootstrap profile selection', () => {
  afterEach(() => {
    setDb(previous);
    db?.close();
    db = null;
    previous = null;
  });

  it('accepts only an opaque profile selector beside the stable command key', () => {
    expect(parseCoordinatorConversationSetup({
      commandKey: 'stock-setup-command', profileId: 'rhythm-setup',
    })).toEqual({ commandKey: 'stock-setup-command', profileId: 'rhythm-setup' });
    expect(() => parseCoordinatorConversationSetup({
      commandKey: 'stock-setup-command', profileId: '/caller/path', cwd: '/caller/path',
    })).toThrow('invalid coordinator conversation setup payload');
  });

  it('requires an explicit opaque selection for the two stock runnable profiles without allocating a project', () => {
    const { configs, projects } = stockStores();
    const selected = selectCoordinatorSetupProfile(configs.listEnabled(), undefined);

    expect(selected).toEqual({
      kind: 'choice_required',
      profileChoices: [
        { id: 'config-doctor', label: 'Config Doctor' },
        { id: 'rhythm-setup', label: 'Rhythm Setup' },
      ],
    });
    expect(JSON.stringify(selected)).not.toContain('allowedMcpsJson');
    expect(JSON.stringify(selected)).not.toContain('corePermissionsJson');
    expect(db!.prepare('SELECT COUNT(*) AS count FROM projects').get()).toEqual({ count: 0 });
    expect(projects.findCoordinatorSetup(7, 'stock-ambiguous')).toBeNull();
  });

  it('persists an explicit current choice, binds replay to it, and withholds disabled or archived setup evidence', () => {
    const { configs, projects } = stockStores();
    const chosen = selectCoordinatorSetupProfile(configs.listEnabled(), 'rhythm-setup');
    expect(chosen.kind).toBe('selected');
    if (chosen.kind !== 'selected') throw new Error('expected selected stock profile');

    const created = projects.createCoordinatorOwned({
      ownerUserId: 7,
      setupKey: 'stock-profile-choice',
      cwd: '/server-created/coordinator-workspaces/rhythm-stock',
      profileId: chosen.profile.id,
      name: 'Rhythm Coordinator',
      workspaceGeneration: 1,
    }).project;
    expect(created.coordinatorProfileId).toBe('rhythm-setup');
    expect(validateCoordinatorSetupReplay(
      configs.listEnabled(), created.coordinatorProfileId, undefined,
    )?.id).toBe('rhythm-setup');
    // Same owner/key never makes a second profile an authority.
    expect(validateCoordinatorSetupReplay(
      configs.listEnabled(), created.coordinatorProfileId, 'config-doctor',
    )).toBeNull();

    expect(configs.lockForSecurity('rhythm-setup', 'stock fixture lock', 'test-reviewer')).not.toBeNull();
    expect(validateCoordinatorSetupReplay(
      configs.listEnabled(), created.coordinatorProfileId, undefined,
    )).toBeNull();
    // Command-key-only setup remains valid only after genuine ambiguity is
    // gone; it does not choose a different profile while the original replay
    // record is still held.
    expect(selectCoordinatorSetupProfile(configs.listEnabled(), undefined)).toMatchObject({
      kind: 'selected', profile: { id: 'config-doctor' },
    });

    projects.updateFields(created.id, { archivedAt: '2026-10-05T10:30:00.000Z' });
    expect(projects.isCoordinatorOwnedBy(7, created.id)).toBe(false);
  });
});
