import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SessionMessageRecord } from '@/lib/opencode/format';
import { createSessionDraftStore } from '@/components/chat/chat-drafts';
import {
  messageMatchesPrompt,
  reconcilePromptAcceptance,
} from '@/providers/services/post-prompt-refresh';

const mobileRoot = join(__dirname, '../..');
const source = (path: string) => readFileSync(join(mobileRoot, path), 'utf8');

function message(id: string, role: 'user' | 'assistant', text: string): SessionMessageRecord {
  return {
    info: {
      id,
      role,
      time: { created: 1 },
      ...(role === 'assistant'
        ? {
            agent: 'test',
            cost: 0,
            finish: 'stop' as const,
            mode: 'test',
            modelID: 'model',
            parentID: 'user-new',
            path: { cwd: '/', root: '/' },
            providerID: 'provider',
            tokens: {
              cache: { read: 0, write: 0 },
              input: 0,
              output: 1,
              reasoning: 0,
              total: 1,
            },
          }
        : {
            agent: 'test',
            model: { modelID: 'model', providerID: 'provider' },
            summary: { diffs: [] },
          }),
    },
    parts: [{
      id: `${id}-text`,
      messageID: id,
      sessionID: 'session',
      text,
      type: 'text',
    }],
  } as SessionMessageRecord;
}

describe('iOS chat integration acceptance', () => {
  test('ios-chat-integration-c1: root gates on restored account without requiring pairing', () => {
    // Regression caught: the root redirect bypasses account restoration/sign-in,
    // or makes a paired Mac a prerequisite for the default Google flow.
    const root = source('app/index.tsx');
    expect(root).toContain('SignInScreen');
    expect(root).toContain('useRhythmAccount');
    expect(root).not.toMatch(/pairedHost\.host\s*[?!]|state\s*===\s*['"]unpaired/);
  });

  test('ios-chat-integration-c2: in-chat navigation updates the selected session route', () => {
    const chatView = source('components/chat/chat-view.tsx');
    expect(chatView).toMatch(/onOpenSession=.*router\.replace/s);
    expect(chatView).toMatch(/handleNewSession[\s\S]*?router\.replace/s);
  });

  test('ios-chat-integration-c3: failed sends restore only their session without overwriting newer typing', () => {
    // Regression caught: one component-level draft leaks across chats and a delayed
    // rejection replaces text entered after the request began.
    const store = createSessionDraftStore();
    store.updateDraft('A', 'original A');
    store.updateAttachments('A', [{ uri: 'file:///a.txt', filename: 'a.txt' }]);
    store.updateDraft('B', 'draft B');

    const attempt = store.beginSend('A');
    store.updateDraft('A', 'new typing');
    store.restoreFailedSend(attempt);

    expect(store.get('A')).toEqual({
      attachments: [{ uri: 'file:///a.txt', filename: 'a.txt' }],
      draft: 'original A\nnew typing',
    });
    expect(store.get('B')).toEqual({ attachments: [], draft: 'draft B' });

    const interrupted = store.beginSend('B');
    store.restoreFailedSend(interrupted);
    expect(store.get('B').draft).toBe('draft B');
  });

  test('ios-chat-integration-c4: uncertain prompt acceptance reconciles reads and never posts', async () => {
    // Regression caught: a transport failure is treated as a definite rejection,
    // exposing a blind resend even though the engine already accepted the prompt.
    const requests: string[] = [];
    const outcome = await reconcilePromptAcceptance({
      baselineMessageIds: new Set(['user-old']),
      deadlineMs: 100,
      matchesPrompt: (entry: SessionMessageRecord) => messageMatchesPrompt(entry, 'ship it', []),
      now: (() => {
        let value = 0;
        return () => (value += 25);
      })(),
      refreshMessages: async () => {
        requests.push('GET messages');
        return requests.length === 1
          ? [message('user-old', 'user', 'old')]
          : [message('user-old', 'user', 'old'), message('user-new', 'user', 'ship it')];
      },
      refreshStatus: async () => {
        requests.push('GET status');
        return 'busy';
      },
      sleep: async () => undefined,
    });

    expect(outcome).toBe('accepted');
    expect(requests).toEqual([
      'GET messages',
      'GET status',
      'GET messages',
    ]);
    expect(requests.some((request) => request.startsWith('POST'))).toBe(false);
    const provider = source('providers/opencode-provider.tsx');
    expect(provider).toContain('uncertainPromptBySessionRef');
    expect(provider).toContain('reconcilePromptAcceptance');
  });

  test('ios-chat-integration-c5: zero-project and failed deep-link states are terminal and truthful', () => {
    // Regression caught: the app fabricates a project or leaves missing/forbidden/
    // timeout routes on an unbounded opening spinner.
    const provider = source('providers/opencode-provider.tsx');
    const detail = source('app/agents/chats/[sessionId].tsx');
    expect(provider).not.toMatch(/fake project|synthetic project|default project/i);
    for (const state of ['missing-session', 'unauthorized-project', 'timeout']) {
      expect(detail).toContain(`'${state}'`);
    }
    expect(detail).toContain('Back to chats');
  });

  test('ios-chat-integration-c6: account bootstrap consumes the supported relay environment contract', () => {
    // Regression caught: Google sign-in still requires QR pairing or parses a
    // response shape different from the hosted relay contract.
    const store = source('lib/pairing/paired-host-store.ts');
    expect(store).toContain("'/relay/mobile-environments'");
    expect(store).toMatch(/`\/relay\/mobile-environments\/\$\{encodeURIComponent\(environment(?:Id|\.id)\)\}\/connect`/);
    for (const field of ['environmentId', 'hostId', 'deviceId', 'deviceToken', 'gatewayBaseUrl']) {
      expect(store).toContain(field);
    }
  });

});
