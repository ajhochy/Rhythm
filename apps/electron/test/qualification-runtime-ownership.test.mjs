import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import test from 'node:test';

test('a qualification launch refuses a healthy occupied runtime instead of adopting it', async (t) => {
  const root=mkdtempSync('/private/tmp/rhythm-occupied-fixture-');
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const userDataPath=join(root,'electron-user-data'),tokenPath=join(root,'actor-token');
  const resources=join(root,'Contents','Resources','api_server');
  mkdirSync(userDataPath,{mode:0o700});mkdirSync(join(root,'home'),{mode:0o700});mkdirSync(resources,{recursive:true});
  const token=randomBytes(32).toString('hex');
  writeFileSync(tokenPath,token,{mode:0o600});
  writeFileSync(join(resources,'build-identity.json'),JSON.stringify({schemaVersion:1,sourceRevision:'a'.repeat(40)}));
  const manifestPath=join(root,'manifest.json');
  writeFileSync(manifestPath,JSON.stringify({schemaVersion:1,sourceRevision:'a'.repeat(40),fixtureRoot:root,
    dbPath:join(root,'rhythm.db'),ownerId:'invented-owner',ownerUserId:123,tokenSha256:createHash('sha256').update(token).digest('hex'),
    publicUserSeed:{id:123,name:'Invented owner',email:'invented@example.invalid',googleSub:'qualification-fixture:owner',timezone:'UTC'},
    syntheticActor:{tokenPath,expiresAt:new Date(Date.now()+3_600_000).toISOString()}}),{mode:0o600});
  let nativeApprovalCalls = 0, occupied = true;
  const context = createContext({
    process: { env: { RHYTHM_QUALIFICATION_FIXTURE_MANIFEST: manifestPath, RHYTHM_SHELL_USER_DATA:userDataPath },
      execPath: join(root,'Contents','MacOS','Rhythm'), getuid: process.getuid },
    fetch: async (url) => ({ ok: true, json: async () => String(url).includes('/global/health')
      ? { healthy: true, version: 'fixture-engine' } : { service: 'rhythm-api-server', status: 'ok' } }),
    AbortController, AbortSignal, Promise, setTimeout, clearTimeout, URL, console,
  });
  const source = await readFile(new URL('../src/agent-server.mjs', import.meta.url), 'utf8');
  const module = new SourceTextModule(source, { context, initializeImportMeta(meta) { meta.url = new URL('../src/agent-server.mjs', import.meta.url).href; } });
  await module.link(async (name) => {
    let values;
    if (name === 'node:net') values = { createServer: () => {
      const server = new EventEmitter();
      server.listen = (_options, callback) => { queueMicrotask(() => occupied
        ? server.emit('error', Object.assign(new Error('occupied'), { code: 'EADDRINUSE' })) : callback()); };
      server.close = (callback) => callback();
      return server;
    } };
    else if(name==='node:fs')values={...await import(name),existsSync:()=>false};
    else if (name === './human-approval-main-signer.mjs') values = { capabilityMaterial: async () => { nativeApprovalCalls++; throw new Error('real Keychain must not be touched'); } };
    else if (name === '../../shared/production-api-base.mjs') values = { normalizeRemoteProductionApiBase: (value) => value };
    else values = { ...await import(name) };
    return new SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
  });
  await module.evaluate();
  const service = new module.namespace.AgentServerService();
  const status = await service.start();
  assert.equal(status.status, 'failed');
  assert.notEqual(status.ownership, 'external');
  assert.equal(nativeApprovalCalls, 0);
  occupied = false;
  const vacantStatus = await new module.namespace.AgentServerService().start();
  assert.equal(vacantStatus.failureReason, 'nodeNotFound', 'actor mode must pass native approval without opening Keychain');
  assert.equal(nativeApprovalCalls, 0);
  const childEnv=module.namespace.buildEnvironment({baseEnv:{RHYTHM_QUALIFICATION_FIXTURE_MANIFEST:manifestPath,
    HOME:'/live/home',OPENAI_API_KEY:'real-secret',AWS_PROFILE:'real-account',RHYTHM_RELAY_BEARER:'real-relay',MCP_ROLES_DIR:'/live/roles'},
    port:4001,enginePort:4096,dbPathValue:join(root,'rhythm.db'),humanApprovalPublicKey:'',humanApprovalCapabilitySha256:'',mcpRolesDir:'/bundle/roles'});
  assert.equal(childEnv.HOME,join(root,'home'));
  assert.equal(childEnv.OPENAI_API_KEY,undefined);
  assert.equal(childEnv.AWS_PROFILE,undefined);
  assert.equal(childEnv.RHYTHM_RELAY_BEARER,undefined);
  assert.equal(childEnv.MCP_ROLES_DIR,'/bundle/roles');
});
