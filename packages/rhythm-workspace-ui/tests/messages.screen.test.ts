import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MessagesScreen } from '../src/screens/MessagesScreen';
import { RhythmWorkspaceProvider } from '../src/context';
import { defaultRhythmTokens } from '../src/host/theme';
import { assertScreenContract } from './test-utils/screenContract';
import { fixtureDomainGateway, fixtureMessagesGateway, failingMessagesGateway, emptyMessagesGateway } from './test-utils/fixtures';
import { mount, flush, actClick, actSetValue, actKeyDown } from './test-utils/mount';

function buildHost(overrides: Record<string, unknown> = {}) {
  return { tokens: defaultRhythmTokens, viewport: 'regular' as const, currentUser: { id: 'workspace-user-1', displayName: 'AJ Hochhalter', initials: 'AH' }, ...overrides };
}

function mountMessages(gatewayOverrides: Partial<ReturnType<typeof fixtureDomainGateway>> = {}, hostOverrides: Record<string, unknown> = {}) {
  const gateway = { ...fixtureDomainGateway(), ...gatewayOverrides };
  return mount(createElement(RhythmWorkspaceProvider, { gateway, host: buildHost(hostOverrides), children: createElement(MessagesScreen) }));
}

describe('MessagesScreen', () => {
  it('lets read-only hosts inspect conversations but keeps all mutation actions inert with a reason', async () => {
    const messagesGateway = fixtureMessagesGateway();
    const mutations = {
      createThread: vi.fn(messagesGateway.createThread), send: vi.fn(messagesGateway.send), markRead: vi.fn(messagesGateway.markRead), markUnread: vi.fn(messagesGateway.markUnread), renameThread: vi.fn(messagesGateway.renameThread), deleteThread: vi.fn(messagesGateway.deleteThread),
    };
    const mounted = mountMessages({ messages: { ...messagesGateway, ...mutations } }, { currentUser: { id: 'workspace-user-1', displayName: 'AJ', initials: 'AH', collaborationCapability: 'read' } });
    await flush();
    await actClick(mounted.byTestId('messages-thread-thread-weekend-team')!);
    await flush();
    expect(mounted.byTestId('messages-subject')?.textContent).toContain('Weekend Team');
    const sendButton = mounted.byTestId('messages-send') as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
    expect(sendButton.title).toContain('inspection only');
    await actClick(sendButton);
    await actClick(mounted.byTestId('messages-selected-thread-actions')!);
    await flush();
    for (const control of ['messages-thread-toggle-thread-weekend-team', 'messages-thread-rename-thread-weekend-team', 'messages-thread-delete-thread-weekend-team']) {
      expect((mounted.byTestId(control) as HTMLButtonElement).disabled).toBe(true);
      await actClick(mounted.byTestId(control)!);
    }
    expect((mounted.byTestId('messages-new-thread') as HTMLButtonElement).disabled).toBe(true);
    for (const mutation of Object.values(mutations)) expect(mutation).not.toHaveBeenCalled();
    mounted.unmount();
  });
  it('satisfies the shared page/focus/responsive/theme/accessibility contract', async () => {
    await assertScreenContract({ Screen: MessagesScreen, screenName: 'Messages', testId: 'rhythm-messages-screen', gateway: fixtureDomainGateway() });
  });

  it('loads real threads with unread counts from the injected gateway', async () => {
    const mounted = mountMessages();
    await flush();
    expect(mounted.byTestId('messages-thread-thread-weekend-team')?.textContent).toContain('Weekend Team');
    expect(mounted.byTestId('messages-thread-unread-thread-weekend-team')).toBeTruthy();
    expect(mounted.byTestId('messages-unread-total')?.textContent).toContain('1');
    mounted.unmount();
  });

  it('shows the loading state panel before the gateway resolves, then ready content', async () => {
    const mounted = mountMessages();
    expect(mounted.byTestId('page-state-loading')).toBeTruthy();
    await flush();
    expect(mounted.byTestId('page-state-loading')).toBeNull();
    expect(mounted.byTestId('messages-thread-list')).toBeTruthy();
    mounted.unmount();
  });

  it('shows the empty state when the gateway returns no threads', async () => {
    const mounted = mountMessages({ messages: emptyMessagesGateway() });
    await flush();
    expect(mounted.byTestId('page-state-empty')).toBeTruthy();
    mounted.unmount();
  });

  it('shows the forbidden state when the gateway rejects with a forbidden error', async () => {
    const mounted = mountMessages({ messages: failingMessagesGateway('forbidden') });
    await flush();
    expect(mounted.byTestId('page-state-forbidden')).toBeTruthy();
    mounted.unmount();
  });

  it('shows a retryable server-error state', async () => {
    const mounted = mountMessages({ messages: failingMessagesGateway('server_error') });
    await flush();
    expect(mounted.byTestId('page-state-server-error')).toBeTruthy();
    mounted.unmount();
  });

  it('filters the thread list by search text', async () => {
    const mounted = mountMessages();
    await flush();
    await actSetValue(mounted.byTestId('messages-thread-search') as HTMLInputElement, 'riley');
    await flush();
    expect(mounted.byTestId('messages-thread-thread-riley-chen')).toBeTruthy();
    expect(mounted.byTestId('messages-thread-thread-weekend-team')).toBeNull();
    mounted.unmount();
  });

  it('opens a thread, marks it read, and shows the transcript and participants', async () => {
    const messagesGateway = fixtureMessagesGateway();
    const mounted = mountMessages({ messages: messagesGateway });
    await flush();
    await actClick(mounted.byTestId('messages-thread-thread-weekend-team')!);
    await flush();
    expect(mounted.byTestId('messages-subject')?.textContent).toContain('Weekend Team');
    expect(mounted.byTestId('messages-transcript')?.textContent).toContain('Final volunteer positions are ready.');
    const threads = await messagesGateway.list();
    expect(threads.find((thread) => thread.id === 'thread-weekend-team')?.unreadCount).toBe(0);
    mounted.unmount();
  });

  it('sends a reply through the gateway and clears the composer', async () => {
    const messagesGateway = fixtureMessagesGateway();
    const mounted = mountMessages({ messages: messagesGateway });
    await flush();
    await actClick(mounted.byTestId('messages-thread-thread-riley-chen')!);
    await flush();
    const input = mounted.byTestId('messages-reply-input') as HTMLTextAreaElement;
    await actSetValue(input, 'Sounds good, thank you!');
    await actClick(mounted.byTestId('messages-send')!);
    await flush();
    const threads = await messagesGateway.list();
    expect(threads.find((thread) => thread.id === 'thread-riley-chen')?.messages.some((message) => message.body === 'Sounds good, thank you!')).toBe(true);
    expect((mounted.byTestId('messages-reply-input') as HTMLTextAreaElement).value).toBe('');
    mounted.unmount();
  });

  it('shows a validation error when sending an empty reply', async () => {
    const mounted = mountMessages();
    await flush();
    await actClick(mounted.byTestId('messages-thread-thread-riley-chen')!);
    await flush();
    await actClick(mounted.byTestId('messages-send')!);
    await flush();
    expect(mounted.byTestId('messages-reply-error')).toBeTruthy();
    mounted.unmount();
  });

  it('opens the thread action menu with roving keyboard focus and marks unread through the gateway', async () => {
    const messagesGateway = fixtureMessagesGateway();
    const mounted = mountMessages({ messages: messagesGateway });
    await flush();
    await actClick(mounted.byTestId('messages-thread-thread-budget-review')!);
    await flush();
    const trigger = mounted.byTestId('messages-thread-actions-thread-budget-review') as HTMLButtonElement;
    trigger.focus();
    await actClick(trigger);
    await flush();
    await flush();
    const menu = mounted.container.querySelector('[role="menu"]') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
    await actClick(mounted.byTestId('messages-thread-toggle-thread-budget-review')!);
    await flush();
    const threads = await messagesGateway.list();
    expect(threads.find((thread) => thread.id === 'thread-budget-review')?.unreadCount).toBeGreaterThan(0);
    mounted.unmount();
  });

  it('closes the thread action menu on Escape and restores focus to the trigger', async () => {
    const mounted = mountMessages();
    await flush();
    const trigger = mounted.byTestId('messages-thread-actions-thread-weekend-team') as HTMLButtonElement;
    trigger.focus();
    await actClick(trigger);
    await flush();
    await actKeyDown(document, 'Escape');
    await flush();
    expect(mounted.container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    mounted.unmount();
  });

  it('renames a thread through the gateway with validation', async () => {
    const messagesGateway = fixtureMessagesGateway();
    const mounted = mountMessages({ messages: messagesGateway });
    await flush();
    const trigger = mounted.byTestId('messages-thread-actions-thread-weekend-team') as HTMLButtonElement;
    trigger.focus();
    await actClick(trigger);
    await flush();
    await actClick(mounted.byTestId('messages-thread-rename-thread-weekend-team')!);
    await flush();
    const dialog = mounted.byTestId('messages-rename-thread-dialog');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    const input = mounted.byTestId('messages-rename-thread-input') as HTMLInputElement;
    await actSetValue(input, '');
    await actClick(mounted.byTestId('messages-rename-thread-save')!);
    await flush();
    expect(mounted.byTestId('messages-rename-thread-error')).toBeTruthy();
    await actSetValue(input, 'Weekend Team (renamed)');
    await actClick(mounted.byTestId('messages-rename-thread-save')!);
    await flush();
    const threads = await messagesGateway.list();
    expect(threads.find((thread) => thread.id === 'thread-weekend-team')?.title).toBe('Weekend Team (renamed)');
    mounted.unmount();
  });

  it('restores focus to the explicit action trigger when Escape closes Rename after its menu unmounts', async () => {
    const mounted = mountMessages();
    await flush();
    const trigger = mounted.byTestId('messages-thread-actions-thread-weekend-team') as HTMLButtonElement;
    await actClick(trigger);
    await flush();
    await actClick(mounted.byTestId('messages-thread-rename-thread-weekend-team')!);
    await flush();
    await actKeyDown(document, 'Escape');
    await flush();
    expect(mounted.byTestId('messages-rename-thread-dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    mounted.unmount();
  });

  it('deletes a thread through a confirmation dialog and the gateway', async () => {
    const messagesGateway = fixtureMessagesGateway();
    const mounted = mountMessages({ messages: messagesGateway });
    await flush();
    await actClick(mounted.byTestId('messages-thread-thread-budget-review')!);
    await flush();
    const trigger = mounted.byTestId('messages-thread-actions-thread-budget-review') as HTMLButtonElement;
    trigger.focus();
    await actClick(trigger);
    await flush();
    await actClick(mounted.byTestId('messages-thread-delete-thread-budget-review')!);
    await flush();
    expect(mounted.byTestId('messages-delete-thread-dialog')).toBeTruthy();
    await actClick(mounted.byTestId('messages-delete-thread-confirm')!);
    await flush();
    const threads = await messagesGateway.list();
    expect(threads.some((thread) => thread.id === 'thread-budget-review')).toBe(false);
    expect(mounted.byTestId('messages-subject')?.textContent).toContain('Riley Chen');
    mounted.unmount();
  });

  it('selects the positional next visible thread after deleting a selected middle thread, including search-filtered order', async () => {
    const mounted = mountMessages();
    await flush();
    await actSetValue(mounted.byTestId('messages-thread-search') as HTMLInputElement, 'e');
    await flush();
    await actClick(mounted.byTestId('messages-thread-thread-riley-chen')!);
    await actClick(mounted.byTestId('messages-selected-thread-actions')!);
    await actClick(mounted.byTestId('messages-thread-delete-thread-riley-chen')!);
    await actClick(mounted.byTestId('messages-delete-thread-confirm')!);
    await flush();
    expect(mounted.byTestId('messages-subject')?.textContent).toContain('August budget review');
    mounted.unmount();
  });

  it('selects the positional previous visible thread after deleting a selected tail thread', async () => {
    const mounted = mountMessages();
    await flush();
    await actClick(mounted.byTestId('messages-thread-thread-budget-review')!);
    await actClick(mounted.byTestId('messages-selected-thread-actions')!);
    await actClick(mounted.byTestId('messages-thread-delete-thread-budget-review')!);
    await actClick(mounted.byTestId('messages-delete-thread-confirm')!);
    await flush();
    expect(mounted.byTestId('messages-subject')?.textContent).toContain('Riley Chen');
    mounted.unmount();
  });

  it('ignores a deferred messages load after the messages gateway is replaced or the screen unmounts', async () => {
    const old = fixtureMessagesGateway();
    let releaseOld!: (value: Awaited<ReturnType<typeof old.list>>) => void;
    const stale = { ...old, list: () => new Promise<Awaited<ReturnType<typeof old.list>>>((resolve) => { releaseOld = resolve; }) };
    const fresh = fixtureMessagesGateway();
    const gateway = { ...fixtureDomainGateway(), messages: stale };
    const mounted = mount(createElement(RhythmWorkspaceProvider, { gateway, host: buildHost(), children: createElement(MessagesScreen) }));
    mounted.rerender(createElement(RhythmWorkspaceProvider, { gateway: { ...gateway, messages: fresh }, host: buildHost(), children: createElement(MessagesScreen) }));
    await flush();
    expect(mounted.container.textContent).toContain('Weekend Team');
    mounted.unmount();
    releaseOld([]);
    await flush();
  });

  it('creates a direct conversation through the new-conversation dialog and the gateway', async () => {
    const messagesGateway = fixtureMessagesGateway();
    const mounted = mountMessages({ messages: messagesGateway });
    await flush();
    await actClick(mounted.byTestId('messages-new-thread')!);
    await flush();
    const dialog = mounted.byTestId('messages-new-thread-dialog');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(mounted.byTestId('messages-create-thread')?.hasAttribute('disabled')).toBe(true);
    await actClick(mounted.byTestId('messages-recipient-riley-chen')!);
    await flush();
    expect(mounted.byTestId('messages-create-thread')?.hasAttribute('disabled')).toBe(false);
    await actClick(mounted.byTestId('messages-create-thread')!);
    await flush();
    const threads = await messagesGateway.list();
    expect(threads.some((thread) => thread.title === 'Riley Chen')).toBe(true);
    mounted.unmount();
  });

  it('creates a group conversation requiring a title and 2+ participants', async () => {
    const messagesGateway = fixtureMessagesGateway();
    const mounted = mountMessages({ messages: messagesGateway });
    await flush();
    await actClick(mounted.byTestId('messages-new-thread')!);
    await flush();
    await actClick(mounted.byTestId('messages-thread-type-group')!);
    await actClick(mounted.byTestId('messages-recipient-riley-chen')!);
    await flush();
    expect(mounted.byTestId('messages-create-thread')?.hasAttribute('disabled')).toBe(true);
    await actClick(mounted.byTestId('messages-recipient-morgan-lee')!);
    await actSetValue(mounted.byTestId('messages-new-thread-title') as HTMLInputElement, 'Volunteer coordination');
    await flush();
    expect(mounted.byTestId('messages-create-thread')?.hasAttribute('disabled')).toBe(false);
    await actClick(mounted.byTestId('messages-create-thread')!);
    await flush();
    const threads = await messagesGateway.list();
    expect(threads.some((thread) => thread.title === 'Volunteer coordination' && thread.type === 'group')).toBe(true);
    mounted.unmount();
  });
});
