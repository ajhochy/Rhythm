import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';

const session = { id: 'parent', name: 'Parent', status: 'idle', category: 'chat', profileId: 'profile', cwd: '/fixture', createdAt: '2026-09-24T10:00:00Z' };
const message = (id: string, text: string) => ({
  sdkMessageId: id,
  role: 'output',
  createdAt: `2026-09-24T10:00:${id.replace(/\D/g, '').padStart(2, '0')}Z`,
  parts: [{ id: `prt_${id}`, type: 'text', text, time: { end: 1 } }],
});

async function open(page: Page, initial = [message('msg_1', 'one'), message('msg_2', 'two'), message('msg_3', 'three'), message('msg_4', 'four')]) {
  let socket: WebSocketRoute | undefined;
  let detailMessages = initial;
  let detailReads = 0;
  let nextCursor: string | null = null;
  let olderMessages = [message('msg_0', 'older')];
  await page.routeWebSocket(/\/ws\/agents$/, ws => { socket = ws; });
  await page.route(url => ['http://127.0.0.1:65534', 'http://127.0.0.1:65533', 'https://lifecycle-fixture.invalid'].includes(url.origin), async route => {
    const request = route.request();
    const url = new URL(request.url());
    const send = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (url.pathname === '/agent-sessions' && request.method() === 'GET') return send({ sessions: [session], pageInfo: { hasMore: false, nextCursor: null } });
    if (url.pathname === '/agent-sessions/parent' && request.method() === 'GET') {
      detailReads += 1;
      return send({ session, messages: detailMessages, transcriptPage: { hasMore: nextCursor !== null, nextCursor } });
    }
    if (url.pathname === '/agent-sessions/parent/revert') {
      detailMessages = detailMessages.slice(0, 2);
      return send({ id: 'sdk-parent', revert: { messageID: 'msg_2' } });
    }
    if (url.pathname === '/agent-sessions/parent/summarize') return send({ ok: true });
    if (url.pathname === '/agent-sessions/parent/messages') return send({ messages: olderMessages, pageInfo: { hasMore: false, nextCursor: null } });
    if (url.pathname === '/agent-configs') return send([{ id: 'profile', label: 'Agent', enabled: true, sessionSelectable: true }]);
    if (url.pathname.includes('health')) return send({ healthy: true, status: 'ready' });
    return send([]);
  });
  await page.route('**/tests/issue-1582-lifecycle-fixture.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    const {default: React} = await import('/node_modules/.vite/deps/react.js');
    const {default: {createRoot}} = await import('/node_modules/.vite/deps/react-dom_client.js');
    const {FixtureProvider,useFixtures} = await import('/src/store.tsx');
    const {composeGateway} = await import('/src/gateway/index.ts');
    const {GatewayProvider} = await import('/src/gateway/context.tsx');
    const h = React.createElement;
    const gateway = composeGateway({mode:'live',apiBase:'http://127.0.0.1:65534',expectedApiBase:'http://127.0.0.1:65534',engineBase:'http://127.0.0.1:65533',expectedEngineBase:'http://127.0.0.1:65533',productionApiBase:'https://lifecycle-fixture.invalid',taskToken:'fixture'});
    function Probe(){const state=useFixtures();const rows=state.selected.messages.map(message=>message.id+':'+message.blocks.map(block=>block.content).join('')).join('|');return h('main',null,h('output',{'data-testid':'messages'},rows),h('button',{'data-testid':'revert',onClick:()=>void state.revertSession('parent','msg_2')},'Revert'),h('button',{'data-testid':'summarize',onClick:()=>void state.summarizeSession('parent')},'Summarize'),h('button',{'data-testid':'older',onClick:()=>void state.loadOlder('parent')},'Older'));}
    createRoot(document.getElementById('root')).render(h(GatewayProvider,{gateway},h(FixtureProvider,null,h(Probe))));
  </script></body></html>` }));
  await page.goto('/tests/issue-1582-lifecycle-fixture.html');
  await expect(page.getByTestId('messages')).toContainText(initial[0]?.sdkMessageId ?? '');
  await expect.poll(() => Boolean(socket)).toBe(true);
  const send = async (event: Record<string, unknown>) => {
    socket!.send(JSON.stringify({ v: 1, id: 'parent', ...event }));
    await page.waitForTimeout(75);
  };
  return {
    send,
    detailReads: () => detailReads,
    setDetailMessages: (rows: ReturnType<typeof message>[]) => { detailMessages = rows; },
    setOlder: (cursor: string, rows: ReturnType<typeof message>[]) => { nextCursor = cursor; olderMessages = rows; },
  };
}

test('1582:store-lifecycle-and-reconciliation:1 lifecycle replacement cannot resurrect reverted rows', async ({ page }) => {
  const fixture = await open(page);
  await page.getByTestId('revert').click();
  await expect(page.getByTestId('messages')).toHaveText(/msg_1:one\|msg_2:two$/);
  await fixture.send({ type: 'message.updated', info: { id: 'msg_5', role: 'assistant' } });
  await fixture.send({ type: 'message.part.updated', part: { id: 'prt_msg_5', messageID: 'msg_5', type: 'text', text: 'five' } });
  await expect(page.getByTestId('messages')).toContainText('msg_5:five');
  await expect(page.getByTestId('messages')).not.toContainText('msg_3');
  await expect(page.getByTestId('messages')).not.toContainText('msg_4');
});

test('1582:store-lifecycle-and-reconciliation:2 compaction replacement stays canonical after WS updates', async ({ page }) => {
  const fixture = await open(page);
  fixture.setDetailMessages([message('msg_1', 'compacted')]);
  await page.getByTestId('summarize').click();
  await expect(page.getByTestId('messages')).toHaveText('msg_1:compacted');
  await fixture.send({ type: 'message.updated', info: { id: 'msg_5', role: 'assistant' } });
  await fixture.send({ type: 'message.part.updated', part: { id: 'prt_msg_5', messageID: 'msg_5', type: 'text', text: 'after' } });
  await expect(page.getByTestId('messages')).toHaveText(/msg_1:compacted\|msg_5:after/);
  await expect(page.getByTestId('messages')).not.toContainText('msg_2');
});

test('1582:store-lifecycle-and-reconciliation:3 overlapping delta and snapshot trigger one canonical detail read', async ({ page }) => {
  const fixture = await open(page, [message('msg_1', 'one')]);
  const baseline = fixture.detailReads();
  fixture.setDetailMessages([message('msg_1', 'one'), message('msg_live', 'REST canonical')]);
  await fixture.send({ type: 'message.updated', info: { id: 'msg_live', role: 'assistant' } });
  await fixture.send({ type: 'message.part.delta', messageId: 'msg_live', partId: 'prt_msg_live', field: 'text', delta: 'delta text' });
  await fixture.send({ type: 'message.part.updated', part: { id: 'prt_msg_live', messageID: 'msg_live', type: 'text', text: 'snapshot text' } });
  await expect.poll(() => fixture.detailReads()).toBe(baseline + 1);
  await expect(page.getByTestId('messages')).toContainText('msg_live:REST canonical');
  expect((await page.getByTestId('messages').innerText()).split('REST canonical').length - 1).toBe(1);
});

test('1582:store-lifecycle-and-reconciliation:4 expired unknown deltas reconcile instead of accumulating', async ({ page }) => {
  const fixture = await open(page, [message('msg_1', 'one')]);
  const baseline = fixture.detailReads();
  await fixture.send({ type: 'message.part.delta', receivedAt: 1_000, messageId: 'msg_unknown', partId: 'prt_old', field: 'text', delta: 'old' });
  await fixture.send({ type: 'message.part.delta', receivedAt: 62_000, messageId: 'msg_unknown', partId: 'prt_new', field: 'text', delta: 'new' });
  await expect.poll(() => fixture.detailReads()).toBe(baseline + 1);
  await expect(page.getByTestId('messages')).not.toContainText('old');
});

test('1582:store-lifecycle-and-reconciliation:5 older-page merge keeps active streaming text', async ({ page }) => {
  const fixture = await open(page, [message('msg_1', 'one')]);
  fixture.setOlder('older-cursor', [message('msg_0', 'older')]);
  fixture.setDetailMessages([message('msg_1', 'one')]);
  await page.reload();
  await expect(page.getByTestId('messages')).toContainText('msg_1:one');
  await fixture.send({ type: 'message.updated', info: { id: 'msg_live', role: 'assistant' } });
  await fixture.send({ type: 'message.part.updated', part: { id: 'prt_live', messageID: 'msg_live', type: 'text', text: '' } });
  await fixture.send({ type: 'message.part.delta', messageId: 'msg_live', partId: 'prt_live', field: 'text', delta: 'streaming' });
  await page.getByTestId('older').click();
  await expect(page.getByTestId('messages')).toContainText('msg_0:older');
  await expect(page.getByTestId('messages')).toContainText('msg_live:streaming');
});
