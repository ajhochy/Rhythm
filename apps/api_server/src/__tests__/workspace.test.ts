import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { WorkspaceRepository } from '../repositories/workspace_repository';
import { TasksRepository } from '../repositories/tasks_repository';
import { MessagesRepository } from '../repositories/messages_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

describe('WorkspaceRepository', () => {
  let usersRepo: UsersRepository;
  let workspaceRepo: WorkspaceRepository;
  let tasksRepo: TasksRepository;
  let messagesRepo: MessagesRepository;

  beforeEach(() => {
    const db = makeDb();
    setDb(db);
    usersRepo = new UsersRepository();
    workspaceRepo = new WorkspaceRepository();
    tasksRepo = new TasksRepository();
    messagesRepo = new MessagesRepository();
  });

  it('creates a workspace with an 8-char join code and makes creator admin', () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
    const ws = workspaceRepo.create({ name: 'Grace Church', createdBy: alice.id });

    expect(ws.name).toBe('Grace Church');
    expect(ws.joinCode).toHaveLength(8);
    expect(ws.joinCode).toMatch(/^[A-Z0-9]{8}$/);

    const member = workspaceRepo.findMember(ws.id, alice.id);
    expect(member?.role).toBe('admin');
  });

  it('lets a second user join via join code as staff', () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
    const bob = usersRepo.create({ name: 'Bob', email: 'bob@example.com' });
    const ws = workspaceRepo.create({ name: 'Grace Church', createdBy: alice.id });

    workspaceRepo.joinByCode(ws.joinCode, bob.id);

    const member = workspaceRepo.findMember(ws.id, bob.id);
    expect(member?.role).toBe('staff');
  });

  it('throws on invalid join code', () => {
    const bob = usersRepo.create({ name: 'Bob', email: 'bob@example.com' });
    expect(() => workspaceRepo.joinByCode('BADCODE1', bob.id)).toThrow();
  });

  it('lists workspace members', () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
    const bob = usersRepo.create({ name: 'Bob', email: 'bob@example.com' });
    const ws = workspaceRepo.create({ name: 'Grace Church', createdBy: alice.id });
    workspaceRepo.joinByCode(ws.joinCode, bob.id);

    const members = workspaceRepo.listMembers(ws.id);
    expect(members).toHaveLength(2);
    expect(members.map((m) => m.name)).toContain('Alice');
    expect(members.map((m) => m.name)).toContain('Bob');
  });

  it('finds workspace for user', () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
    const ws = workspaceRepo.create({ name: 'Grace Church', createdBy: alice.id });

    const found = workspaceRepo.findForUser(alice.id);
    expect(found?.id).toBe(ws.id);
    expect(found?.role).toBe('admin');
  });

  it('regenerates join code', () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
    const ws = workspaceRepo.create({ name: 'Grace Church', createdBy: alice.id });
    const oldCode = ws.joinCode;

    const newCode = workspaceRepo.regenerateJoinCode(ws.id);
    expect(newCode).toHaveLength(8);
    expect(newCode).not.toBe(oldCode);
  });

  it('shared tasks appear in collaborator task list with isShared flag', () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
    const bob = usersRepo.create({ name: 'Bob', email: 'bob@example.com' });
    const task = tasksRepo.create({ title: 'Alice task', ownerId: alice.id });

    tasksRepo.addCollaborator(task.id, bob.id);

    const bobTasks = tasksRepo.findAll(bob.id);
    const shared = bobTasks.find((t) => t.id === task.id);
    expect(shared).toBeDefined();
    expect(shared?.isShared).toBe(true);
  });

  it('removing a collaborator removes the task from their list', () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
    const bob = usersRepo.create({ name: 'Bob', email: 'bob@example.com' });
    const task = tasksRepo.create({ title: 'Alice task', ownerId: alice.id });

    tasksRepo.addCollaborator(task.id, bob.id);
    tasksRepo.removeCollaborator(task.id, bob.id);

    const bobTasks = tasksRepo.findAll(bob.id);
    expect(bobTasks.find((t) => t.id === task.id)).toBeUndefined();
  });

  it('creates a group thread with 3+ participants', () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
    const bob = usersRepo.create({ name: 'Bob', email: 'bob@example.com' });
    const carol = usersRepo.create({ name: 'Carol', email: 'carol@example.com' });

    const thread = messagesRepo.createThread({
      createdBy: alice.id,
      participantIds: [bob.id, carol.id],
      threadType: 'group',
    });

    expect(thread.participants).toHaveLength(3);
    expect(thread.threadType).toBe('group');
  });

  it('messages include senderName from user record', () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
    const bob = usersRepo.create({ name: 'Bob', email: 'bob@example.com' });
    const thread = messagesRepo.createThread({
      createdBy: alice.id,
      participantIds: [bob.id],
      threadType: 'direct',
    });

    const msg = messagesRepo.createMessage(thread.id, alice.id, { body: 'Hello' });
    expect(msg.senderName).toBe('Alice');
    expect(msg.senderId).toBe(alice.id);
  });
});
