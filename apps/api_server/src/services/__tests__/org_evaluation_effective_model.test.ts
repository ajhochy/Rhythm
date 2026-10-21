import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { captureEffectiveEvaluationModel } from '../org_evaluation_effective_model';

let db: Database.Database;
afterEach(() => { setDb(null); db?.close(); });
function setup(): Database.Database {
  db = new Database(':memory:'); runMigrations(db); setDb(db); return db;
}

describe('frozen production evaluation model', () => {
  it('uses the profile pin and scheduled-task override before the fallback cascade', () => {
    setup();
    const profile = { profileId: 'profile-a', profileModelProvider: 'anthropic',
      profileModelId: 'claude-sonnet-4-5' };
    expect(captureEffectiveEvaluationModel(profile, db)).toEqual({
      providerID: 'anthropic', modelID: 'claude-sonnet-4-5', source: 'profile' });
    expect(captureEffectiveEvaluationModel({ ...profile, scheduledModelProvider: 'openai',
      scheduledModelId: 'gpt-6.1-sol' }, db)).toEqual({
      providerID: 'openai', modelID: 'gpt-6.1-sol', source: 'scheduled-task' });
  });

  it('copies only MRU model identity for an unpinned or newly created profile', () => {
    setup();
    db.prepare(`INSERT INTO agent_sessions (id,agent_kind,cwd,name,provider_id,model_id,created_at)
      VALUES ('model-only','opencode','/private/tmp','No content','openai','gpt-6.1-sol','2030-01-01')`).run();
    const unpinned = { profileId: 'new-agent', profileModelProvider: null, profileModelId: null };
    expect(captureEffectiveEvaluationModel(unpinned, db)).toEqual({
      providerID: 'openai', modelID: 'gpt-6.1-sol', source: 'mru' });
    expect(captureEffectiveEvaluationModel({ profileId: null, profileModelProvider: 'anthropic',
      profileModelId: 'claude-sonnet-4-5' }, db)).toEqual({
      providerID: 'openai', modelID: 'gpt-6.1-sol', source: 'mru' });
  });

  it('uses the same hardcoded production fallback when no model metadata exists', () => {
    setup();
    expect(captureEffectiveEvaluationModel({ profileId: null, profileModelProvider: null,
      profileModelId: null }, db)).toEqual({
      providerID: 'anthropic', modelID: 'claude-sonnet-4-6', source: 'hardcoded-default' });
  });
});
