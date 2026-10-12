// Fixture-only Node VM/import dispatch diagnostic. Does not load Rhythm/SUT,
// real SDK packages, files, processes, sockets, credentials or model outputs.
import * as vm from 'node:vm';
import { registerHooks } from 'node:module';
import assert from 'node:assert/strict';

const events = [];
const corrected = process.argv.includes('--active-boundary');
const key = Symbol.for('rhythm.stageA.import-diagnostic');
globalThis[key] = { events, active: null };
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (['@opencode-ai/sdk', '@opencode-ai/sdk/v2/client'].includes(specifier)) {
      events.push({ boundary: 'node-resolve', specifier });
      return { url: 'rhythm-import-diagnostic:external-sdk', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url !== 'rhythm-import-diagnostic:external-sdk') return nextLoad(url, context);
    events.push({ boundary: 'node-load', url });
    return { format: 'module', shortCircuit: true, source: `
      export function createOpencodeClient(options) {
        const state = globalThis[Symbol.for('rhythm.stageA.import-diagnostic')];
        state.events.push({ boundary: 'node-factory', active: state.active, baseUrl: options.baseUrl });
        return { fixtureOnly: true };
      }
    ` };
  },
});

const source = `
  class ImportProbe {
    async v1() {
      const dynamicImport = new Function('s', 'return import(s)');
      const mod = await dynamicImport('@opencode-ai/sdk');
      return mod.createOpencodeClient({baseUrl:'http://127.0.0.1:4797'});
    }
    async v2() {
      const dynamicImport = new Function('s', 'return import(s)');
      const mod = await dynamicImport('@opencode-ai/sdk/v2/client');
      return mod.createOpencodeClient({baseUrl:'http://127.0.0.1:4797'});
    }
  }
  globalThis.probe = new ImportProbe();
`;
try {
  for (const mode of corrected ? ['active-boundary'] : ['per-context-synthetic', 'node-package-boundary']) {
    for (const owner of ['attached', 'ordinary']) {
      globalThis[key].active = mode + ':' + owner;
      globalThis[key].sdk = {
        createOpencodeClient(options) {
          events.push({ boundary: 'active-sdk-factory', owner, active: globalThis[key].active,
                        baseUrl: options.baseUrl });
          return { fixtureOnly: true, owner };
        },
      };
      const context = vm.createContext({});
      const script = new vm.Script(source, {
        filename: 'same-import-probe.cjs',
        importModuleDynamically: async specifier => {
          events.push({ boundary: 'vm-import', mode, owner, specifier });
          if (mode === 'node-package-boundary') return import(specifier);
          const module = new vm.SyntheticModule(['createOpencodeClient'], function () {
            this.setExport('createOpencodeClient', options => {
              if (mode === 'active-boundary') return globalThis[key].sdk.createOpencodeClient(options);
              events.push({ boundary: 'vm-factory', mode, owner, active: globalThis[key].active,
                            baseUrl: options.baseUrl });
              return { fixtureOnly: true };
            });
          }, { context });
          await module.link(() => { throw new Error('unexpected dependency'); });
          await module.evaluate();
          return module;
        },
      });
      script.runInContext(context);
      await context.probe.v1();
      await context.probe.v2();
    }
  }
  const nodeFactories = events.filter(e => e.boundary === 'node-factory');
  console.log(JSON.stringify({ diagnostic: 'fixture-only-import-realm-observed', events }, null, 2));
  if (corrected) {
    const factories = events.filter(e => e.boundary === 'active-sdk-factory');
    assert.deepEqual(factories.map(e => e.owner), ['attached', 'attached', 'ordinary', 'ordinary']);
    assert.equal(nodeFactories.length, 0, 'Script callback, not Node package hooks, services these imports');
    console.log('PASS4/4 active SDK factory owners; fixture-only diagnostic, not SUT acceptance');
  } else {
  assert.equal(nodeFactories.length, 4);
  assert.deepEqual(nodeFactories.map(e => e.active), [
    'node-package-boundary:attached', 'node-package-boundary:attached',
    'node-package-boundary:ordinary', 'node-package-boundary:ordinary',
  ]);
  console.log(JSON.stringify({ diagnostic: 'fixture-only-import-realm', events,
    nodeBoundaryProbe: 'PASS4/4; not a SUT/UNIT acceptance result' }, null, 2));
  }
} finally {
  hooks.deregister();
  delete globalThis[key];
}
