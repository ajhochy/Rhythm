import { statSync } from 'node:fs';
import { test, expect, OwnedRecords } from './parity-fixture';

type HistoryRow = {
  id: string; sdkSessionId: string; name: string; ownerUserId: number;
  parentSessionId: string | null; projectId: string | null;
  childCount: number; hasChildren: boolean;
};
type HistoryPage = { sessions: HistoryRow[]; ancestors: HistoryRow[];
  pageInfo: { limit: number; hasMore: boolean; nextCursor: string | null } };
type EngineSession = { id: string; parentID: string; directory: string; title: string; cost: number };

test('#7: owned session history keeps three real engine children across cursor pages, search, and the parent rail', async ({ page, parity }) => {
  const sessions = new OwnedRecords(page, parity, 'sessions', 'owned-history');
  const engineIds: string[] = [];
  let parentId = '';
  try {
    try {
      await sessions.open();
      const parent = await sessions.create(' parent');
      parentId = String(parent.id);
      expect(parent).toMatchObject({ ownerUserId: 1, profileId: 'local-lean',
        parentSessionId: null, projectId: null, cwd: sessions.directory });
      expect(parent.sdkSessionId).toEqual(expect.any(String));
      const parentSdkId = String(parent.sdkSessionId);
      engineIds.push(parentSdkId);
      const childNames: string[] = [];
      for (let index = 0; index < 3; index++) {
        const title = `${sessions.prefix} child ${index}`;
        const response = await parity.engineFetch(`/session?directory=${encodeURIComponent(sessions.directory!)}`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ parentID: parentSdkId, title }), signal: AbortSignal.timeout(20_000),
        });
        expect(response.status, 'real engine child creation').toBe(200);
        const child = await response.json() as EngineSession;
        expect(child).toMatchObject({ id: expect.any(String), parentID: parentSdkId,
          directory: sessions.directory, title, cost: 0 });
        const engineRead = await parity.engineFetch(`/session/${encodeURIComponent(child.id)}?directory=${encodeURIComponent(sessions.directory!)}`);
        expect(engineRead.status, 'real engine child readback').toBe(200);
        expect(await engineRead.json()).toMatchObject({ id: child.id, parentID: parentSdkId, title });
        engineIds.push(child.id);
        childNames.push(title);
      }

      // The engine's session.created events, rather than a test DB insert, must reconcile
      // all three durable API rows before pagination starts.
      await expect.poll(() => Number((parity.rows('SELECT count(*) AS n FROM agent_sessions WHERE parent_session_id=?', parentId)[0] as { n?: number })?.n ?? 0),
        { timeout: 20_000 }).toBe(3);
      const api = sessions.api!;
      const first = await api.json<HistoryPage>(`/agent-sessions?scope=chats&parentId=${encodeURIComponent(parentId)}&limit=2`);
      expect(first.pageInfo).toMatchObject({ limit: 2, hasMore: true, nextCursor: expect.any(String) });
      expect(first.sessions).toHaveLength(2);
      const second = await api.json<HistoryPage>(`/agent-sessions?scope=chats&parentId=${encodeURIComponent(parentId)}&limit=2&cursor=${encodeURIComponent(first.pageInfo.nextCursor!)}`);
      expect(second.pageInfo).toMatchObject({ limit: 2, hasMore: false, nextCursor: null });
      expect(second.sessions).toHaveLength(1);
      const children = [...first.sessions, ...second.sessions];
      for (const child of children) sessions.remember(child);
      expect(new Set(children.map(child => child.id)).size).toBe(3);
      expect(new Set(children.map(child => child.sdkSessionId))).toEqual(new Set(engineIds.slice(1)));
      expect(new Set(children.map(child => child.name))).toEqual(new Set(childNames));
      for (const child of children) expect(child).toMatchObject({ ownerUserId: 1,
        parentSessionId: parentId, projectId: parent.projectId, childCount: 0, hasChildren: false });
      for (const pageResult of [first, second]) expect(pageResult.ancestors).toMatchObject([{
        id: parentId, sdkSessionId: parentSdkId, ownerUserId: 1, childCount: 3, hasChildren: true,
      }]);
      const found = await api.json<HistoryPage>(`/agent-sessions?scope=chats&search=${encodeURIComponent(childNames[2])}&limit=2`);
      expect(found.sessions).toMatchObject([{ name: childNames[2], parentSessionId: parentId,
        sdkSessionId: engineIds[3], ownerUserId: 1 }]);
      expect(found.ancestors).toMatchObject([{ id: parentId, childCount: 3 }]);
      const durable = parity.rows('SELECT id,sdk_session_id,name,parent_session_id,owner_user_id,project_id FROM agent_sessions WHERE parent_session_id=?', parentId);
      expect(new Set(durable.map(row => row.sdk_session_id))).toEqual(new Set(engineIds.slice(1)));
      expect(durable).toHaveLength(3);
      for (const row of durable) expect(row).toMatchObject({ parent_session_id: parentId,
        owner_user_id: 1, project_id: parent.projectId });

      await page.reload();
      await expect(page.getByTestId(`session-${parentId}`)).toContainText(String(parent.name));
      await expect(page.getByTestId(`subagents-${parentId}`)).toContainText('3');
    } finally {
      await sessions.cleanup({ keepDirectory: true });
    }
    expect(parity.rows('SELECT id FROM agent_sessions WHERE id=? OR parent_session_id=?', parentId, parentId)).toEqual([]);
    expect(statSync(sessions.directory!).isDirectory(), 'engine absence must be checked in the original live cwd').toBe(true);
    for (const id of engineIds) {
      const response = await parity.engineFetch(`/session/${encodeURIComponent(id)}?directory=${encodeURIComponent(sessions.directory!)}`);
      expect(response.status, 'owned engine identity survived permanent cleanup').toBe(404);
    }
  } finally {
    await sessions.cleanup();
  }
});
