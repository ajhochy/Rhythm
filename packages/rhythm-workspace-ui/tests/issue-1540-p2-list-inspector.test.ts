import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import * as publicApi from '../src/index';
import { MessagesScreen } from '../src/screens/MessagesScreen';
import { RhythmWorkspaceProvider } from '../src/context';
import { defaultRhythmTokens } from '../src/host/theme';
import { fixtureDomainGateway, fixtureMessagesGateway } from './test-utils/fixtures';
import { actClick, actKeyDown, actSetValue, flush, mount } from './test-utils/mount';

function host(identity = 'workspace-user-1', viewport: 'compact' | 'regular' = 'regular') {
  return {
    tokens: defaultRhythmTokens,
    viewport,
    currentUser: {
      id: identity,
      displayName: identity,
      initials: 'WU',
      collaborationCapability: 'write' as const,
    },
  };
}

function renderMessages(messages = fixtureMessagesGateway(), identity = 'workspace-user-1', viewport: 'compact' | 'regular' = 'regular') {
  const gateway = { ...fixtureDomainGateway(), messages };
  return {
    gateway,
    mounted: mount(createElement(RhythmWorkspaceProvider, {
      gateway,
      host: host(identity, viewport),
      children: createElement(MessagesScreen),
    })),
  };
}

describe('issue #1540 P2 ListInspector acceptance contract', () => {
  it('issue-1540-P2-inert-selection: click, arrows, Enter, and Back select without message mutations or confirmations', async () => {
    const messages = fixtureMessagesGateway();
    const mutations = {
      markRead: vi.fn(messages.markRead),
      markUnread: vi.fn(messages.markUnread),
      renameThread: vi.fn(messages.renameThread),
      deleteThread: vi.fn(messages.deleteThread),
    };
    const confirmWorkspaceOperation = vi.fn(async () => true);
    const gateway = { ...fixtureDomainGateway(), messages: { ...messages, ...mutations } };
    const mounted = mount(createElement(RhythmWorkspaceProvider, {
      gateway,
      host: { ...host(), confirmWorkspaceOperation },
      children: createElement(MessagesScreen),
    }));
    await flush();
    const first = mounted.byTestId('messages-thread-thread-weekend-team')!;
    await actClick(first);
    await actKeyDown(first, 'ArrowDown');
    await actKeyDown(document.activeElement as HTMLElement, 'Enter');
    const back = mounted.container.querySelector<HTMLElement>('.list-inspector-back')!;
    await actClick(back);
    await flush();
    for (const mutation of Object.values(mutations)) expect(mutation).not.toHaveBeenCalled();
    expect(confirmWorkspaceOperation).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it('issue-1540-P2-inspector-actions: row mutation buttons are absent and explicit inspector actions preserve confirmation UI', async () => {
    const { mounted } = renderMessages();
    await flush();
    expect(mounted.byTestId('messages-thread-actions-thread-weekend-team')).toBeNull();
    await actClick(mounted.byTestId('messages-thread-thread-weekend-team')!);
    await flush();
    await actClick(mounted.byTestId('messages-selected-thread-actions')!);
    await actClick(mounted.byTestId('messages-thread-delete-thread-weekend-team')!);
    await flush();
    expect(mounted.byTestId('messages-delete-thread-dialog')).toBeTruthy();
    mounted.unmount();
  });

  it('issue-1540-P2-unknown-id: a controlled missing selection remains visibly unavailable', async () => {
    const ListInspector = (publicApi as Record<string, unknown>).ListInspector as (props: Record<string, unknown>) => JSX.Element;
    expect(typeof ListInspector).toBe('function');
    const mounted = mount(createElement('main', { className: 'rhythm-workspace-root' }, createElement(ListInspector, {
      label: 'Things',
      items: [{ id: 'known', title: 'Known' }],
      selectedId: 'missing',
      onSelect: () => undefined,
      inspector: () => createElement('p', null, 'Known detail'),
    })));
    expect(mounted.container.textContent).toContain('Item not found');
    expect(mounted.container.textContent).not.toContain('Known detail');
    mounted.unmount();
  });

  it('issue-1540-P2-identity: identity changes clear selection and drafts and late prior-identity data is ignored', async () => {
    const oldMessages = fixtureMessagesGateway();
    let releaseOld!: (value: Awaited<ReturnType<typeof oldMessages.list>>) => void;
    const staleMessages = { ...oldMessages, list: () => new Promise<Awaited<ReturnType<typeof oldMessages.list>>>((resolve) => { releaseOld = resolve; }) };
    const freshMessages = fixtureMessagesGateway();
    const freshRows = await freshMessages.list();
    freshMessages.list = async () => [{ ...freshRows[0]!, id: 'thread-new-identity', title: 'New identity thread' }];
    const oldGateway = { ...fixtureDomainGateway(), messages: staleMessages };
    const mounted = mount(createElement(RhythmWorkspaceProvider, { gateway: oldGateway, host: host('old-user'), children: createElement(MessagesScreen) }));
    mounted.rerender(createElement(RhythmWorkspaceProvider, { gateway: { ...oldGateway, messages: freshMessages }, host: host('new-user'), children: createElement(MessagesScreen) }));
    await flush();
    await actClick(mounted.byTestId('messages-thread-thread-new-identity')!);
    await actSetValue(mounted.byTestId('messages-reply-input') as HTMLTextAreaElement, 'private old draft');
    mounted.rerender(createElement(RhythmWorkspaceProvider, { gateway: { ...oldGateway, messages: freshMessages }, host: host('third-user'), children: createElement(MessagesScreen) }));
    releaseOld(await oldMessages.list());
    await flush();
    expect(mounted.byTestId('messages-empty-selection')).toBeTruthy();
    expect(mounted.container.textContent).toContain('New identity thread');
    expect(mounted.container.textContent).not.toContain('Weekend Team');
    mounted.unmount();
  });

  it('issue-1540-P2-compact-keyboard: compact Back returns focus to the previously selected row', async () => {
    const { mounted } = renderMessages(fixtureMessagesGateway(), 'workspace-user-1', 'compact');
    await flush();
    const row = mounted.byTestId('messages-thread-thread-riley-chen')!;
    await actClick(row);
    await flush();
    const back = mounted.container.querySelector<HTMLElement>('.list-inspector-back')!;
    await actKeyDown(back, 'Enter');
    await flush();
    expect(document.activeElement).toBe(row);
    mounted.unmount();
  });

  it('issue-1540-P2-splitter: the wide splitter is keyboard resizable and clamps to declared bounds', async () => {
    const { mounted } = renderMessages();
    await flush();
    const splitter = mounted.container.querySelector<HTMLElement>('[role="separator"]')!;
    expect(splitter).toBeTruthy();
    splitter.focus();
    await actKeyDown(splitter, 'End');
    expect(splitter.getAttribute('aria-valuenow')).toBe(splitter.getAttribute('aria-valuemax'));
    await actKeyDown(splitter, 'ArrowRight');
    expect(splitter.getAttribute('aria-valuenow')).toBe(splitter.getAttribute('aria-valuemax'));
    await actKeyDown(splitter, 'Home');
    expect(splitter.getAttribute('aria-valuenow')).toBe(splitter.getAttribute('aria-valuemin'));
    mounted.unmount();
  });

  it('issue-1540-P2-readonly: read-only selection remains inspectable while inspector mutations are disabled', async () => {
    const messages = fixtureMessagesGateway();
    const markRead = vi.fn(messages.markRead);
    const gateway = { ...fixtureDomainGateway(), messages: { ...messages, markRead } };
    const mounted = mount(createElement(RhythmWorkspaceProvider, {
      gateway,
      host: { ...host(), currentUser: { id: 'reader', displayName: 'Reader', initials: 'R' } },
      children: createElement(MessagesScreen),
    }));
    await flush();
    await actClick(mounted.byTestId('messages-thread-thread-weekend-team')!);
    await flush();
    expect(mounted.byTestId('messages-subject')?.textContent).toContain('Weekend Team');
    expect((mounted.byTestId('messages-send') as HTMLButtonElement).disabled).toBe(true);
    expect(markRead).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it('issue-1540-P2-public-boundary: ListInspector and Splitter are additive public exports and package code owns no browser routing or storage', async () => {
    expect(typeof (publicApi as Record<string, unknown>).ListInspector).toBe('function');
    expect(typeof (publicApi as Record<string, unknown>).Splitter).toBe('function');
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const sources = await Promise.all([
      readFile(join(process.cwd(), 'src/components/ListInspector.tsx'), 'utf8'),
      readFile(join(process.cwd(), 'src/components/Splitter.tsx'), 'utf8'),
    ]);
    expect(sources.join('\n')).not.toMatch(/location\.hash|history\.|localStorage/);
  });
});
