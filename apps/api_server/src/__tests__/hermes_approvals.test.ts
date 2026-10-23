import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentApprovalsRepository } from '../repositories/agent_approvals_repository';
import { UsersRepository } from '../repositories/users_repository';
import { pendingRelayCard, listPendingRelayCards, decideRelayCard, requireUnchangedRelayApproval } from '../security/relay_approval_security';

describe('Hermes relay decision persistence and exact card integrity (unmocked SQLite)', () => {
  let db: Database.Database;
  let user: ReturnType<UsersRepository['create']>;
  let sessionId: string;
  const repo = new AgentApprovalsRepository();
  beforeEach(() => {
    db = new Database(':memory:'); runMigrations(db); setDb(db);
    user = new UsersRepository().create({name:'AJ',email:'hermes@example.invalid'});
    sessionId = randomUUID();
    db.prepare(`INSERT INTO agent_sessions(id,name,agent_kind,status,cwd,owner_user_id)
      VALUES (?,'Hermes test','manager','completed','/private/tmp',?)`).run(sessionId,user.id);
  });
  afterEach(() => db.close());
  function create() { return repo.create({sessionId,agentConfigId:'manager',action:'Safe synthetic action',preview:'Exact preview',consequence:'Sandbox-only'}); }
  function input(id: string) {
    const card = pendingRelayCard(id,user.id);
    return {revision:card.revision,cardHash:card.cardHash,decision:'approved',attestation:'owner_chose_in_chat'};
  }

  it('same card has stable revision/hash; audit AJ via Hermes; replay and opposite decision fail', () => {
    const a = create(); const i = input(a.id);
    expect(input(a.id)).toEqual(i);
    const {result} = decideRelayCard(user,a.id,i);
    expect(result.audit.displayIdentity).toBe('AJ via Hermes');
    expect(result.audit.assurance).toBe('relay-attested');
    expect(repo.getById(a.id)?.decisionNonce).toBeNull();
    expect(() => decideRelayCard(user,a.id,i)).toThrow('no longer pending');
    expect(() => decideRelayCard(user,a.id,{...i,decision:'rejected'})).toThrow('no longer pending');
    expect(() => requireUnchangedRelayApproval(a.id)).not.toThrow();
  });
  it('refuses unknown source/owner/signature/bulk and non-string decisions without mutating', () => {
    const a = create(); const i = input(a.id);
    for (const change of [{source:'desktop'}, {ownerUserId:user.id}, {signature:'forged'}, {approvalIds:[a.id]},
      {decision:['approved']}, {decision:'approve_all'}, {attestation:'automatic'}, {revision:'bad'}]) {
      expect(() => decideRelayCard(user,a.id,{...i,...change})).toThrow('required');
      expect(repo.getById(a.id)?.status).toBe('pending');
    }
  });
  it('never admits unowned/sessionless cards or admin role override', () => {
    const a = create();
    const other = new UsersRepository().create({name:'Other admin',email:'other@example.invalid',role:'admin'});
    expect(() => pendingRelayCard(a.id,other.id)).toThrow('not found');
    expect(listPendingRelayCards(other.id)).toEqual([]);
    db.prepare('UPDATE agent_sessions SET owner_user_id = NULL WHERE id = ?').run(sessionId);
    expect(listPendingRelayCards(user.id)).toEqual([]);
    const sessionless = repo.create({action:'No owner'});
    expect(() => pendingRelayCard(sessionless.id,user.id)).toThrow('not found');
  });
  it('detects every displayed or executable field edit after relay approval; desktop actor is unchanged', () => {
    const edits: [string,unknown][] = [['action','other action'],['preview','changed'],['consequence','changed'],
      ['payload_digest','changed'],['security_action','task.create'],['taint_id','changed'],['tainted_turn_id','changed'],
      ['bound_agent','other'],['agent_config_id','other'],['expires_at','2099-01-01T00:00:00Z'],['created_at','2099-01-01T00:00:00Z']];
    for (const [column,value] of edits) {
      const a = create(); decideRelayCard(user,a.id,input(a.id));
      db.prepare(`UPDATE agent_approvals SET ${column} = ? WHERE id = ?`).run(value,a.id);
      expect(() => requireUnchangedRelayApproval(a.id)).toThrow('no longer matches');
    }
    const desktop = create(); repo.decideWithNonce(desktop.id,'approved',`user:${user.id}`,desktop.decisionNonce!);
    expect(() => requireUnchangedRelayApproval(desktop.id)).not.toThrow();
  });
  it('refuses generic ten-minute expiry, invalid explicit expiry and rotated decision nonce', () => {
    const a = create(); const i = input(a.id);
    db.prepare('UPDATE agent_approvals SET decision_nonce = ? WHERE id = ?').run(randomUUID(),a.id);
    expect(() => decideRelayCard(user,a.id,i)).toThrow('changed');
    db.prepare("UPDATE agent_approvals SET created_at = datetime('now','-1 hour') WHERE id = ?").run(a.id);
    expect(() => pendingRelayCard(a.id,user.id)).toThrow('expired');
    const invalid = create(); db.prepare('UPDATE agent_approvals SET expires_at = ? WHERE id = ?').run('not-a-date',invalid.id);
    expect(() => pendingRelayCard(invalid.id,user.id)).toThrow('expired');
    expect(listPendingRelayCards(user.id)).toEqual([]);
  });
});
