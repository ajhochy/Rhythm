import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { createLiveWorkspaceMembersGateway } from '../src/gateway/workspace-members';

test('E30: workspace directory uses the authenticated current-workspace endpoint', async () => {
  const seen: Array<{ url: string; auth: string | null }> = [];
  const gateway = createLiveWorkspaceMembersGateway('https://members.invalid', 'member-token', async (input, init) => {
    seen.push({ url: String(input), auth: new Headers(init?.headers).get('authorization') });
    return Response.json([{ userId: 2, name: 'Casey Staff', email: 'casey@example.invalid', photoUrl: null, role: 'staff', joinedAt: '' }]);
  });
  await expect(gateway.list()).resolves.toMatchObject([{ userId: 2, name: 'Casey Staff' }]);
  expect(seen).toEqual([{ url: 'https://members.invalid/workspaces/me/members', auth: 'Bearer member-token' }]);
});

test('E30: live staff pages use the shared directory and no raw user-id inputs', async () => {
  const files = await Promise.all(['tasks', 'planner', 'dashboard', 'rhythms', 'projects'].map(async page => ({
    page,
    source: await readFile(new URL(`../src/pages/${page}/index.tsx`, import.meta.url), 'utf8'),
  })));
  for (const { page, source } of files) {
    expect(source, page).toContain('useWorkspaceMembers');
    expect(source, page).not.toMatch(/type="number" placeholder="User id"/);
  }
  for (const page of ['tasks', 'planner', 'dashboard']) {
    const source = files.find((entry) => entry.page === page)!.source;
    expect(source).toContain('collaboratorId');
    expect(source).toMatch(/add(?:Task)?Collaborator\(created\.id/);
  }
  expect(files.find((entry) => entry.page === 'rhythms')!.source).toContain('members={memberOptions}');
  expect(files.find((entry) => entry.page === 'projects')!.source).toContain('memberOptions.map');
});
