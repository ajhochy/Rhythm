import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

// Execute the actual notifier and subscription bodies; the worker's mounted
// consumer tests intentionally mock this producer-facing fan-out layer.
const source = readFileSync(resolve(__dirname, '../providers/opencode-provider.tsx'), 'utf8');
const ast = ts.createSourceFile('provider.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name: string) {
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
function execute(text: string, dependencies: Record<string, unknown>) {
  const js = ts.transpileModule('const actual = ' + text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), js + '; return actual;')(...Object.values(dependencies));
}
function guard() {
  const client = {};
  const pairedClient = {};
  const clientGenerationRef = { current: new WeakMap<object, number>([[client, 2]]) };
  const scopeGenerationRef = { current: 2 };
  const activeProjectPathRef = { current: 'project-a' };
  const coordinatorChangeListenersRef = { current: new Set<(change: unknown) => void>() };
  const calls: unknown[] = [];
  const subscribe = execute(callback('subscribeCoordinatorChanges'), { coordinatorChangeListenersRef });
  const cleanup = subscribe((change: unknown) => calls.push(change));
  const isCurrentClient = execute(callback('isCurrentClient'), { clientGenerationRef, scopeGenerationRef });
  const notify = execute(callback('notifyCoordinatorChanged'), { isCurrentClient, activeProjectPathRef, coordinatorChangeListenersRef });
  const change = { projectId: 'project-a', conversationId: 'conversation-a', localSessionId: 'local-root-a' };
  return { client, pairedClient, clientGenerationRef, scopeGenerationRef, activeProjectPathRef, calls, cleanup, notify, change };
}

describe('Sol C3 actual notifier currency gate', () => {
  test('actual notifier rejects stale/unknown/wrong-project clients and carries exact paired origin on the current hint', () => {
    const g = guard();
    const stale = {};
    g.clientGenerationRef.current.set(stale, 1);
    g.notify(g.change, stale, g.pairedClient);
    g.notify(g.change, {}, g.pairedClient);
    g.notify({ ...g.change, projectId: 'project-b' }, g.client, g.pairedClient);
    expect(g.calls).toEqual([]);
    g.notify(g.change, g.client, g.pairedClient);
    expect(g.calls).toEqual([{ ...g.change, pairedClient: g.pairedClient }]);
    // The notifier attaches origin, not authority; the actual consumer must
    // independently reject an origin that differs from its current pair.
    const oldPair = {};
    g.notify(g.change, g.client, oldPair);
    expect(g.calls[1]).toEqual({ ...g.change, pairedClient: oldPair });
    g.cleanup();
  });

  test('generation changes and A-to-B-to-A navigation never revive an old stream client', () => {
    const g = guard();
    g.scopeGenerationRef.current += 1;
    g.activeProjectPathRef.current = 'project-b';
    g.notify(g.change, g.client, g.pairedClient);
    g.scopeGenerationRef.current += 1;
    g.activeProjectPathRef.current = 'project-a';
    g.notify(g.change, g.client, g.pairedClient);
    expect(g.calls).toEqual([]);
    const replacement = {};
    g.clientGenerationRef.current.set(replacement, g.scopeGenerationRef.current);
    g.notify(g.change, replacement, g.pairedClient);
    expect(g.calls).toEqual([{ ...g.change, pairedClient: g.pairedClient }]);
    g.cleanup();
  });

  test('actual subscription cleanup suppresses late notifications', () => {
    const g = guard();
    g.cleanup();
    g.notify(g.change, g.client, g.pairedClient);
    expect(g.calls).toEqual([]);
  });
});
