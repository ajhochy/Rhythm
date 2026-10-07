import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { shouldKeepSessionSafetyPoll } from '@/providers/opencode-provider-selectors';

// Execute production callback bodies, including the previously mirrored guard.
// No provider network/native lifecycle or new scheduler is started here.
const source = readFileSync(resolve(__dirname, '../providers/opencode-provider.tsx'), 'utf8');
const ast = ts.createSourceFile('provider.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function initializer(name: string): string {
  let value: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      value = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!value) throw new Error(`Missing actual ${name}`);
  return value.getText(ast);
}
function execute(text: string, dependencies: Record<string, unknown>): any {
  const js = ts.transpileModule('const actual = ' + text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), js + '; return actual;')(...Object.values(dependencies));
}
function guard() {
  const client = {};
  const clientGenerationRef = { current: new WeakMap<object, number>([[client, 2]]) };
  const scopeGenerationRef = { current: 2 };
  const activeProjectPathRef = { current: 'project-a' };
  const calls: unknown[] = [];
  const projectReadListenersRef = { current: new Set([(event: unknown) => calls.push(event)]) };
  const isCurrentClient = execute(initializer('isCurrentClient'), { clientGenerationRef, scopeGenerationRef });
  const notify = execute(initializer('notifyProjectReadCompleted'), { isCurrentClient, activeProjectPathRef, projectReadListenersRef });
  return { client, clientGenerationRef, scopeGenerationRef, activeProjectPathRef, calls, notify };
}
async function flush() {
  await new Promise((done) => setTimeout(done, 0));
  await new Promise((done) => setTimeout(done, 0));
}
describe('Sol C4 actual read-completion guard', () => {
  test('actual notifier accepts current generation/project and rejects stale, unknown and wrong-project clients', () => {
    const g = guard();
    const stale = {};
    g.clientGenerationRef.current.set(stale, 1);
    g.notify('project-a', stale);
    g.notify('project-a', {});
    g.notify('project-other', g.client);
    expect(g.calls).toEqual([]);
    g.notify('project-a', g.client);
    expect(g.calls).toEqual([{ projectId: 'project-a' }]);
    g.scopeGenerationRef.current = 3;
    g.notify('project-a', g.client);
    expect(g.calls).toHaveLength(1);
    g.activeProjectPathRef.current = 'project-b';
    g.scopeGenerationRef.current = 4;
    g.activeProjectPathRef.current = 'project-a';
    g.notify('project-a', g.client); // A→B→A does not revive the old client.
    expect(g.calls).toHaveLength(1);
  });

  test('actual fallback and background catcher suppress rejected and cancelled cycles, then notify once on success', async () => {
    let effectNode: ts.Node | undefined;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useEffect' && node.arguments[0]?.getText(ast).includes('const shouldKeepSafetyPoll =')) effectNode = node.arguments[0];
      ts.forEachChild(node, visit);
    };
    visit(ast);
    if (!effectNode) throw new Error('Missing actual fallback');
    const g = guard();
    class OfflineError extends Error {}
    const trackMacOffline = execute(initializer('trackMacOffline'), { MacOfflineError: OfflineError, pairedHostClient: null, setMacPresence: jest.fn(), deriveMacPresence: () => 'offline' });
    const settleBackgroundRead = execute(initializer('settleBackgroundRead'), { trackMacOffline });
    let tick!: () => void;
    const noop = async () => undefined;
    const arm = (refreshSessions: () => Promise<unknown>) => execute(effectNode!.getText(ast), {
      client: g.client, notifyProjectReadCompleted: g.notify, connection: { status: 'connected' }, activeProjectPath: 'project-a', sessionStatuses: {}, conversationPhase: 'off', eventStreamStatus: 'error', sendingState: { active: false }, shouldKeepSessionSafetyPoll,
      setInterval: (callback: () => void) => { tick = callback; return 1; }, clearInterval: jest.fn(), settleBackgroundRead, refreshSessions, refreshPendingInteractions: noop, currentSessionId: undefined, refreshMessages: noop, refreshSessionDiff: noop, refreshSessionTodos: noop, conversationSessionId: undefined,
    })();
    let cleanup = arm(async () => { throw new Error('read rejected'); });
    tick();
    await flush();
    expect(g.calls).toEqual([]);
    cleanup();
    let release!: () => void;
    const held = new Promise<void>((done) => { release = done; });
    cleanup = arm(() => held);
    tick();
    cleanup();
    release();
    await flush();
    expect(g.calls).toEqual([]);
    cleanup = arm(async () => undefined);
    tick();
    await flush();
    expect(g.calls).toEqual([{ projectId: 'project-a' }]);
    cleanup();
  });

  test('an actual held fallback completion is fenced by project or client-generation change', async () => {
    const g = guard();
    let release!: () => void;
    const read = new Promise<void>((done) => { release = done; });
    const completed = read.then(() => g.notify('project-a', g.client));
    g.scopeGenerationRef.current += 1;
    g.activeProjectPathRef.current = 'project-b';
    release();
    await completed;
    expect(g.calls).toEqual([]);
  });
});
