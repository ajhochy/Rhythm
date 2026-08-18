import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERMISSION_MODES } from '../models/agent_session';

const source = (relative: string) => readFileSync(resolve(process.cwd(), 'src/routes', relative), 'utf8');

describe('post-m1 Phase 5 route and vocabulary guard', () => {
  it('keeps permission, question, and session-update routes executable', () => {
    const routes = source('agent_sessions_routes.ts');
    expect(routes).toContain("'/:id/pending-permissions'");
    expect(routes).toContain("'/:id/permissions/:permissionID/reply'");
    expect(routes).toContain("'/:id/question/:callId/:action'");
    expect(routes).toContain("patch('/:id'");
    expect(PERMISSION_MODES).toEqual(['default', 'acceptEdits', 'plan', 'bypassPermissions']);
  });

  it('keeps signed approval and delegation routes executable', () => {
    const approvals = source('agent_approvals_routes.ts');
    expect(approvals).toContain("get(\n  '/'");
    expect(approvals).toContain("patch(\n  '/:id'");
    expect(approvals).toContain('requireHumanApprovalCapability');

    const delegation = source('agent_delegation_routes.ts');
    expect(delegation).toContain("post('/delegate'");
    expect(delegation).toContain("post('/delegate-async'");
    expect(delegation).toContain("get('/status'");
    expect(delegation).toContain("post('/:id/cancel'");
  });

  it('keeps MCP, skill, refresh, and command lifecycle routes executable', () => {
    const mcp = source('opencode_mcp_routes.ts');
    for (const fragment of ["get(\n  '/'", "post(\n  '/'", "'/:name/credentials'", "'/:name/oauth/start'", "'/:name/oauth/status'", "'/:name/connect'", "'/:name/disconnect'", "delete(\n  '/:name'"]) {
      expect(mcp).toContain(fragment);
    }

    const skills = source('opencode_skills_routes.ts');
    for (const fragment of ["get(\n  '/'", "'/:name/content'", "post(\n  '/'", "put(\n  '/:name'", "delete(\n  '/:name'"]) {
      expect(skills).toContain(fragment);
    }
    expect(source('system_routes.ts')).toContain("post(\n  '/refresh'");

    const commands = source('opencode_commands_routes.ts');
    for (const fragment of ["get(\n  '/'", "'/:name/content'", "post(\n  '/'", "put(\n  '/:name'", "delete(\n  '/:name'"]) {
      expect(commands).toContain(fragment);
    }
  });
});
