import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// mockSend is the spy we'll track across all Resend instances
const mockSend = vi.fn();

// Mock the resend module BEFORE any imports that pull it in
vi.mock('resend', () => {
  class MockResend {
    emails = { send: mockSend };
  }
  return { Resend: MockResend };
});

// Mock env so we can mutate resendApiKey per test
vi.mock('../config/env', () => ({
  env: {
    resendApiKey: 'test-api-key',
    emailFromAddress: 'Rhythm <noreply@example.com>',
  },
}));

import { env } from '../config/env';
import { EmailService } from './email_service';
import type { UsersRepository } from '../repositories/users_repository';

function makeUser(overrides: Partial<{
  id: number;
  name: string;
  email: string;
  emailNotificationsEnabled: boolean;
}> = {}) {
  return {
    id: 10,
    name: 'Jane Doe',
    email: 'jane@example.com',
    googleSub: null,
    photoUrl: null,
    role: 'member',
    isFacilitiesManager: false,
    emailNotificationsEnabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRepo(user: ReturnType<typeof makeUser> | null = makeUser()): UsersRepository {
  return {
    findByIdAsync: user
      ? vi.fn().mockResolvedValue(user)
      : vi.fn().mockRejectedValue(new Error('Not found')),
  } as unknown as UsersRepository;
}

describe('EmailService', () => {
  beforeEach(() => {
    mockSend.mockReset();
    // Ensure env has an API key by default
    (env as { resendApiKey: string }).resendApiKey = 'test-api-key';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('1. does NOT send when recipient === actor (self-action skip)', async () => {
    const repo = makeRepo();
    const service = new EmailService(repo);
    await service.sendTaskAssignedEmailAsync('task-1', 'My Task', 'Alice', 5, 5);
    expect(repo.findByIdAsync).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('2. does NOT send when env.resendApiKey is empty (no API key skip)', async () => {
    (env as { resendApiKey: string }).resendApiKey = '';
    const repo = makeRepo();
    // Create service AFTER clearing the key so the constructor sees the empty key
    const service = new EmailService(repo);
    await service.sendTaskAssignedEmailAsync('task-1', 'My Task', 'Alice', 10, 20);
    expect(repo.findByIdAsync).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('3. does NOT send when recipient has emailNotificationsEnabled = false', async () => {
    const user = makeUser({ emailNotificationsEnabled: false });
    const repo = makeRepo(user);
    const service = new EmailService(repo);
    await service.sendTaskAssignedEmailAsync('task-1', 'My Task', 'Alice', 10, 20);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('4. does NOT send (and does NOT throw) when findByIdAsync rejects', async () => {
    const repo = makeRepo(null);
    const service = new EmailService(repo);
    await expect(
      service.sendTaskAssignedEmailAsync('task-1', 'My Task', 'Alice', 10, 20),
    ).resolves.toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('5. happy path: sends email with correct from, to, subject, and HTML link', async () => {
    mockSend.mockResolvedValueOnce({ data: { id: 'msg-1' }, error: null });
    const user = makeUser({ id: 10, email: 'jane@example.com', name: 'Jane Doe' });
    const repo = makeRepo(user);
    const service = new EmailService(repo);

    await service.sendTaskAssignedEmailAsync('task-abc', 'Plan the Event', 'Bob', 10, 20);

    expect(mockSend).toHaveBeenCalledOnce();
    const callArg = mockSend.mock.calls[0][0] as {
      from: string;
      to: string;
      subject: string;
      html: string;
      text: string;
    };

    expect(callArg.from).toBe('Rhythm <noreply@example.com>');
    expect(callArg.to).toBe('jane@example.com');
    expect(callArg.subject).toContain('Plan the Event');
    expect(callArg.subject).toContain('Bob');
    expect(callArg.html).toContain('rhythm://tasks/task-abc');
  });

  it('6. Resend error is swallowed: method resolves even when send rejects', async () => {
    mockSend.mockRejectedValueOnce(new Error('Network failure'));
    const user = makeUser();
    const repo = makeRepo(user);
    const service = new EmailService(repo);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      service.sendTaskAssignedEmailAsync('task-1', 'My Task', 'Alice', 10, 20),
    ).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith('[email] send failed', expect.any(Error));
    consoleSpy.mockRestore();
  });

  it('7. HTML escaping: dangerous chars in task title and actor name are escaped', async () => {
    mockSend.mockResolvedValueOnce({ data: { id: 'msg-xss' }, error: null });
    const user = makeUser();
    const repo = makeRepo(user);
    const service = new EmailService(repo);

    await service.sendTaskAssignedEmailAsync(
      'task-xss',
      '<script>alert(1)</script>',
      'Bob & Alice',
      10,
      20,
    );

    expect(mockSend).toHaveBeenCalledOnce();
    const { html } = mockSend.mock.calls[0][0] as { html: string };

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Bob &amp; Alice');
    expect(html).not.toContain('<script>');
  });

  it('sendCollaboratorAddedEmailAsync happy path: uses "added you to" verb', async () => {
    mockSend.mockResolvedValueOnce({ data: { id: 'msg-2' }, error: null });
    const user = makeUser({ id: 10, email: 'jane@example.com' });
    const repo = makeRepo(user);
    const service = new EmailService(repo);

    await service.sendCollaboratorAddedEmailAsync('task-xyz', 'Team Meeting', 'Carol', 10, 30);

    expect(mockSend).toHaveBeenCalledOnce();
    const { subject } = mockSend.mock.calls[0][0] as { subject: string };
    expect(subject).toContain('added you to');
    expect(subject).toContain('Team Meeting');
  });
});
