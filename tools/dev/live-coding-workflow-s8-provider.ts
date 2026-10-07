/** Deterministic external provider only; the sandbox API, fork and MCP tools are real. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

if (process.env.RHYTHM_LIVE_E2E !== '1') throw Error('RHYTHM_LIVE_E2E=1 required');
const out = process.env.RHYTHM_G2_LIVE_OUT!;
const root = path.resolve(import.meta.dir, '../..');
const original = path.join(root, 'apps/opencode_fork/packages/opencode/test/lib/llm-server.ts');
const copied = path.join(out, 'model-transport');
fs.mkdirSync(copied, { recursive: true });
const source = fs.readFileSync(original, 'utf8');
const needle = 'Http.createServer(), { port: 0 }';
if (source.split(needle).length !== 2) throw Error('Unexpected model fixture transport');
const fixture = path.join(copied, 'llm-server.ts');
fs.writeFileSync(fixture, source.replace(needle, "Http.createServer(), { port: 0, host: '127.0.0.1' }"));
fs.symlinkSync(path.join(root, 'apps/opencode_fork/packages/opencode/node_modules'), path.join(copied, 'node_modules'));
const localRequire = createRequire(original);
const { Effect } = await import(localRequire.resolve('effect'));
const { TestLLMServer, reply } = await import(fixture);
const sys = (hit: any) => JSON.stringify((hit.body.messages ?? hit.body.input ?? []).filter((m: any) => m.role === 'system' || m.role === 'developer'));
const manager = (hit: any) => sys(hit).includes('G2_SYNTHETIC_MANAGER');
const reviewer = (hit: any) => sys(hit).includes('G2_SYNTHETIC_REVIEWER');
const secretary = (hit: any) => sys(hit).includes('G2_SYNTHETIC_SECRETARY') && !manager(hit) && !reviewer(hit);
const first = (hit: any) => manager(hit) && JSON.stringify(hit.body).includes('Step 1 of 2');
const second = (hit: any) => manager(hit) && JSON.stringify(hit.body).includes('Step 2 of 2');
const text = (value: string) => reply().text(value).usage({ input: 32, output: 12 }).stop();
const tool = (value: unknown) => reply().tool('mcp_dispatch', value).usage({ input: 32, output: 8 });
let release: (() => void) | undefined;
const held = new Promise<void>(resolve => { release = resolve; });
const started = Date.now();
let lastCalls = -1;
const program = Effect.gen(function* () {
  const server = yield* TestLLMServer;
  fs.writeFileSync(path.join(out, 'model-ready.json'), JSON.stringify({ url: server.url, pid: process.pid, externalModelSynthetic: true, apiEngineMocked: false }));
  yield* Effect.promise(async () => {
    while (!fs.existsSync(path.join(out, 'model-scenario.json'))) {
      const control = path.join(out, 'model-control.json');
      if (fs.existsSync(control) && JSON.parse(fs.readFileSync(control, 'utf8')).stop) throw Error('Stopped before source selector readiness');
      if (Date.now() - started > 300_000) throw Error('Actual source selector readiness timeout');
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  });
const input = JSON.parse(fs.readFileSync(path.join(out, 'model-scenario.json'), 'utf8'));
const summary = `The invented note requires an owner and a deadline. [source: ${input.sourceId}@${input.version}]`;
const brief = JSON.stringify({ kind: 'selected_reference_summary_v1', sourceId: input.sourceId, version: input.version, summary });
const review = JSON.stringify({ kind: 'selected_reference_review_v1', criterionId: 'reviewed_summary_with_citation', verdict: 'pass', sourceId: input.sourceId, version: input.version, summarySha256: crypto.createHash('sha256').update(summary).digest('hex') });
  yield* server.pushMatch(first, text('The selected source is current.').wait(held));
  yield* server.pushMatch(second,
    tool({ action: 'describe', name: 'rhythm_rhythm_delegate_async' }),
    tool({ action: 'execute', name: 'rhythm_rhythm_delegate_async', arguments: { targetAgentConfigId: 'verification-gate', prompt: `Independently review this exact cited brief and return a selected_reference_review_v1 verdict: ${brief}` } }),
    text(brief));
  yield* server.pushMatch(reviewer, text(review));
  // Real automatic callbacks carry the same profile but a distinct native user anchor.
  yield* server.pushMatch(manager, text(brief));
  yield* server.pushMatch(secretary, text('Synthetic Secretary callback: the result must be checked by the server.'));
  yield* server.pushMatch(secretary, text('Synthetic Secretary callback: the bounded workflow returned.'));
  fs.writeFileSync(path.join(out, 'model-scenario-ready.json'), JSON.stringify({ sourceId: input.sourceId, version: input.version }));
  yield* Effect.promise(async () => {
    while (Date.now() - started < 600_000) {
      const file = path.join(out, 'model-control.json');
      const control = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
      if (control.releaseFirst) release?.();
      const calls = await Effect.runPromise(server.calls);
      if (calls > 48) throw Error('Bounded provider request limit exceeded');
      if (calls !== lastCalls) {
        fs.writeFileSync(path.join(out, 'model-observations.json'), JSON.stringify({ calls, inputs: await Effect.runPromise(server.inputs), misses: await Effect.runPromise(server.misses), pending: await Effect.runPromise(server.pending) }, null, 2));
        lastCalls = calls;
      }
      if (control.stop) { release?.(); break; }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  });
});
await Effect.runPromise(program.pipe(Effect.provide(TestLLMServer.layer)));
fs.writeFileSync(path.join(out, 'model-completed.json'), JSON.stringify({ listenerReleased: true, calls: lastCalls }));
