import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const API_ROOT = resolve(__dirname, '../..');
const REPO_ROOT = resolve(API_ROOT, '../..');

function text(path: string): string {
  return readFileSync(path, 'utf8');
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('issue #1345 API and generated SDK contracts', () => {
  it('issue-1345-c6: fork/API contract and authorization tests expose a URI-free route with no SQL migration', () => {
    // Regression caught: the API accepts an arbitrary URI/server/cwd or adds a
    // database column instead of using the persisted JSON call metadata.
    const routes = text(resolve(API_ROOT, 'src/routes/agent_sessions_routes.ts'));
    const controller = text(resolve(API_ROOT, 'src/controllers/agent_sessions_controller.ts'));

    expect(routes).toMatch(
      /get\(\s*['"]\/:id\/mcp-app-resource\/:callId['"]\s*,\s*controller\.getMcpAppResource/,
    );
    expect(routes).not.toMatch(/mcp-app-resource[^\n]*(?:uri|server|cwd)/i);
    expect(controller).toContain('getMcpAppResource');
    expect(controller).toMatch(/opencodeSessionMap\.get\(/);
    expect(controller).toMatch(/readSessionMcpAppResource/);
    const methodStart = controller.indexOf('async getMcpAppResource(');
    expect(methodStart, 'missing resource controller method').toBeGreaterThanOrEqual(0);
    if (methodStart >= 0) {
      const method = controller.slice(
        methodStart,
        controller.indexOf('\n  async ', methodStart + 1),
      );
      expect(method).not.toMatch(
        /req\.(?:body|query)\.(?:uri|resourceUri|server|serverName|cwd)/,
      );
    }

    // #1345 must add NO schema — it derives resources from persisted JSON call
    // metadata, never a new column/table. Assert neither migration file
    // introduces an mcp-app-resource schema. (A whole-file hash is too brittle
    // on the integrated branch, where sibling features legitimately add their
    // own migrations; this checks #1345's actual "no SQL migration" contract.)
    const migrations = text(resolve(API_ROOT, 'src/database/migrations.ts'));
    const bootstrap = text(resolve(API_ROOT, 'src/database/postgres_bootstrap.ts'));
    expect(migrations).not.toMatch(/mcp[_-]?app[_-]?resource/i);
    expect(bootstrap).not.toMatch(/mcp[_-]?app[_-]?resource/i);
  });

  it('issue-1345-c7: generated SDK regeneration exposes the typed session resource operation', () => {
    // Regression caught: the fork route exists but api_server uses a hand-written
    // fetch or a stale vendored SDK. All generated/distributed surfaces must agree.
    const forkOpenApi = text(resolve(REPO_ROOT, 'apps/opencode_fork/packages/sdk/openapi.json'));
    const forkGenerated = text(
      resolve(REPO_ROOT, 'apps/opencode_fork/packages/sdk/js/src/gen/sdk.gen.ts'),
    );
    const vendorGenerated = text(resolve(API_ROOT, 'vendor/opencode-ai-sdk/gen/sdk.gen.d.ts'));
    const service = text(resolve(API_ROOT, 'src/services/opencode_client_service.ts'));

    expect(forkOpenApi).toContain('"operationId": "session.mcpAppResource"');
    expect(forkGenerated).toContain('mcpAppResource');
    expect(vendorGenerated).toContain('mcpAppResource');

    const start = service.indexOf('async readSessionMcpAppResource(');
    expect(start, 'missing typed api_server SDK wrapper').toBeGreaterThanOrEqual(0);
    const body = service.slice(start, service.indexOf('\n  async ', start + 1));
    expect(body).toContain('client.session.mcpAppResource');
    expect(body).not.toContain('fetch(');
  });
});
