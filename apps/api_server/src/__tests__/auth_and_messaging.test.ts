import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AuthService } from '../services/auth_service';
import type { GoogleIdentity } from '../services/auth_service';
import { SessionsRepository } from '../repositories/sessions_repository';
import { TasksRepository } from '../repositories/tasks_repository';
import { UsersRepository } from '../repositories/users_repository';
import { MessagesRepository } from '../repositories/messages_repository';
import { ProjectInstancesRepository } from '../repositories/project_instances_repository';
import { ProjectTemplatesRepository } from '../repositories/project_templates_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

describe('Auth and ownership flows', () => {
  let usersRepo: UsersRepository;
  let sessionsRepo: SessionsRepository;
  let tasksRepo: TasksRepository;
  let messagesRepo: MessagesRepository;
  let projectTemplatesRepo: ProjectTemplatesRepository;
  let projectInstancesRepo: ProjectInstancesRepository;

  beforeEach(() => {
    const db = makeDb();
    setDb(db);
    usersRepo = new UsersRepository();
    sessionsRepo = new SessionsRepository();
    tasksRepo = new TasksRepository();
    messagesRepo = new MessagesRepository();
    projectTemplatesRepo = new ProjectTemplatesRepository();
    projectInstancesRepo = new ProjectInstancesRepository();
  });

  it('logs in with a verified Google identity and creates a session', async () => {
    const authService = new AuthService(
      usersRepo,
      sessionsRepo,
      {
        verifyIdToken: async (): Promise<GoogleIdentity> => ({
          sub: 'google-sub-1',
          email: 'alice@example.com',
          name: 'Alice',
          picture: 'https://example.com/alice.png',
        }),
      } as never,
    );

    const session = await authService.loginWithGoogleIdToken('fake-id-token');

    expect(session.sessionToken).toBeTruthy();
    expect(session.user.email).toBe('alice@example.com');
    expect(session.user.googleSub).toBe('google-sub-1');
    expect(session.user.photoUrl).toBe('https://example.com/alice.png');
    expect(authService.getUserForSessionToken(session.sessionToken)?.id).toBe(
      session.user.id,
    );
  });

  it('filters tasks to the current owner plus legacy shared records', () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
    const bob = usersRepo.create({ name: 'Bob', email: 'bob@example.com' });

    tasksRepo.create({ title: 'Shared task' });
    tasksRepo.create({ title: 'Alice private task', ownerId: alice.id });
    tasksRepo.create({ title: 'Bob private task', ownerId: bob.id });

    const visibleToAlice = tasksRepo.findAll(alice.id).map((task) => task.title);
    expect(visibleToAlice).toContain('Shared task');
    expect(visibleToAlice).toContain('Alice private task');
    expect(visibleToAlice).not.toContain('Bob private task');
  });

  it('filters project templates and instances to the current owner plus legacy shared records', () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
    const bob = usersRepo.create({ name: 'Bob', email: 'bob@example.com' });

    const sharedTemplate = projectTemplatesRepo.create({ name: 'Shared Template' });
    const aliceTemplate = projectTemplatesRepo.create({
      name: 'Alice Template',
      ownerId: alice.id,
    });
    const bobTemplate = projectTemplatesRepo.create({
      name: 'Bob Template',
      ownerId: bob.id,
    });

    projectInstancesRepo.createWithSteps(
      sharedTemplate.id,
      '2026-04-10',
      'Shared Instance',
      null,
      [],
    );
    projectInstancesRepo.createWithSteps(
      aliceTemplate.id,
      '2026-04-11',
      'Alice Instance',
      alice.id,
      [],
    );
    projectInstancesRepo.createWithSteps(
      bobTemplate.id,
      '2026-04-12',
      'Bob Instance',
      bob.id,
      [],
    );

    const visibleTemplatesToAlice = projectTemplatesRepo
      .findAll(alice.id)
      .map((template) => template.name);
    expect(visibleTemplatesToAlice).toContain('Shared Template');
    expect(visibleTemplatesToAlice).toContain('Alice Template');
    expect(visibleTemplatesToAlice).not.toContain('Bob Template');

    const visibleInstancesToAlice = projectInstancesRepo
      .findAll(alice.id)
      .map((instance) => instance.name);
    expect(visibleInstancesToAlice).toContain('Shared Instance');
    expect(visibleInstancesToAlice).toContain('Alice Instance');
    expect(visibleInstancesToAlice).not.toContain('Bob Instance');
  });

  it('invalidates the server session on logout', async () => {
    const authService = new AuthService(
      usersRepo,
      sessionsRepo,
      {
        verifyIdToken: async (): Promise<GoogleIdentity> => ({
          sub: 'google-sub-logout',
          email: 'alice@example.com',
          name: 'Alice',
          picture: null,
        }),
      } as never,
    );

    const session = await authService.loginWithGoogleIdToken('fake-id-token');
    expect(authService.getUserForSessionToken(session.sessionToken)?.email).toBe(
      'alice@example.com',
    );

    authService.logout(session.sessionToken);

    expect(authService.getUserForSessionToken(session.sessionToken)).toBeNull();
  });

  it('tracks unread messages until the thread is marked read', () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
    const bob = usersRepo.create({ name: 'Bob', email: 'bob@example.com' });

    const thread = messagesRepo.createThread({
      createdBy: alice.id,
      participantIds: [bob.id],
    });

    messagesRepo.createMessage(thread.id, alice.id, {
      body: 'Hello Bob',
    });

    const bobThreadsBeforeRead = messagesRepo.findAllThreadsForUser(bob.id);
    expect(bobThreadsBeforeRead).toHaveLength(1);
    expect(bobThreadsBeforeRead[0].unreadCount).toBe(1);
    expect(bobThreadsBeforeRead[0].isUnread).toBe(true);

    messagesRepo.markThreadRead(thread.id, bob.id);

    const bobThreadsAfterRead = messagesRepo.findAllThreadsForUser(bob.id);
    expect(bobThreadsAfterRead[0].unreadCount).toBe(0);
    expect(bobThreadsAfterRead[0].isUnread).toBe(false);
  });

  it('reuses the existing direct thread for the same two participants', () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
    const bob = usersRepo.create({ name: 'Bob', email: 'bob@example.com' });

    const first = messagesRepo.createThread({
      createdBy: alice.id,
      participantIds: [bob.id],
    });
    const second = messagesRepo.createThread({
      createdBy: alice.id,
      participantIds: [bob.id],
    });

    expect(second.id).toBe(first.id);
    expect(messagesRepo.findAllThreadsForUser(alice.id)).toHaveLength(1);
    expect(second.participants.map((participant) => participant.email)).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);
  });

  it('sends a direct notification message without creating duplicate threads', () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
    const bob = usersRepo.create({ name: 'Bob', email: 'bob@example.com' });

    const first = messagesRepo.sendDirectMessage(
      alice.id,
      bob.id,
      'Your facility reservation was deleted by Alice.',
    );
    const second = messagesRepo.sendDirectMessage(
      alice.id,
      bob.id,
      'Go to Facilities to resubmit a reservation.',
    );

    const bobThreads = messagesRepo.findAllThreadsForUser(bob.id);
    expect(bobThreads).toHaveLength(1);
    expect(bobThreads[0].unreadCount).toBe(2);

    const messages = messagesRepo.findMessagesByThread(first.threadId, bob.id);
    expect(messages.map((message) => message.body)).toEqual([
      'Your facility reservation was deleted by Alice.',
      'Go to Facilities to resubmit a reservation.',
    ]);
    expect(second.threadId).toBe(first.threadId);
  });

  it('creates or reuses a dedicated Rhythm Bot user', () => {
    const first = usersRepo.findOrCreateSystemBot();
    const second = usersRepo.findOrCreateSystemBot();

    expect(first.name).toBe('Rhythm Bot');
    expect(first.email).toBe('rhythm-bot@rhythm.local');
    expect(first.role).toBe('system');
    expect(second.id).toBe(first.id);
  });
});
