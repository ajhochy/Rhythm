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

  beforeEach(() => {
    const db = makeDb();
    setDb(db);
    usersRepo = new UsersRepository();
    sessionsRepo = new SessionsRepository();
    tasksRepo = new TasksRepository();
    messagesRepo = new MessagesRepository();
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
        }),
      } as never,
    );

    const session = await authService.loginWithGoogleIdToken('fake-id-token');

    expect(session.sessionToken).toBeTruthy();
    expect(session.user.email).toBe('alice@example.com');
    expect(session.user.googleSub).toBe('google-sub-1');
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
});
