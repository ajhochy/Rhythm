// Scripted provider substitution proves the normal title route and persistence, not model quality.
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from './parity-fixture';
import { prepareScriptedModel, createScriptedProfile, assertProjectedNoTools,
  createScriptedSession, sendScriptedTurn, type SessionDetail } from './scripted-parity-fixture';

const placeholders = /^(|Untitled chat|Untitled session|Resumed|New session|(New|Child) session - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/;
test('[web-parity-112] [AI sessions] one private untitled real turn generates a durable visible session name', async ({ page, parity }, testInfo) => {
  test.setTimeout(160_000);
  await prepareScriptedModel(parity, true);
  const profile = await createScriptedProfile(parity, `${parity.prefix} autoname profile`);
  await assertProjectedNoTools(parity, profile.id);
  expect(parity.rows('SELECT id FROM agent_sessions WHERE cwd=?', parity.cwd)).toEqual([]);
  const session = await createScriptedSession(parity, profile.id, '');
  expect(session).toMatchObject({ parentSessionId: null });
  expect(placeholders.test(String(session.name).trim()), 'normal create must actually start untitled').toBe(true);
  const engineTitle = async () => {
    const response = await parity.engineFetch(`/session/${encodeURIComponent(String(session.sdkSessionId))}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ id: session.sdkSessionId, directory: parity.cwd });
    return String(body.title).trim();
  };
  const providerHitCount = async () => {
    const response = await fetch('http://127.0.0.1:6996/_s0/status', { signal: AbortSignal.timeout(10_000) });
    expect(response.status).toBe(200);
    const body = await response.json() as { hits: unknown[] };
    expect(Array.isArray(body.hits)).toBe(true);
    return body.hits.length;
  };
  const providerHitsBefore = await providerHitCount();
  try {
    await page.goto('/#/agents');
    await page.getByTestId(`session-${session.id}`).click();
    await sendScriptedTurn(page, parity, session, `${parity.prefix}: S0:plain one untitled turn`);
    await expect.poll(async () => {
      const title = await engineTitle();
      const detail = await parity.api.json<SessionDetail>(`/agent-sessions/${session.id}`);
      return title.length > 0 && !placeholders.test(title) && detail.session.name === title;
    }, { timeout: 60_000 }).toBe(true);
    const generatedTitle = await engineTitle();
    expect(generatedTitle).not.toBe(String(session.name).trim());
    const detail = await parity.api.json<SessionDetail>(`/agent-sessions/${session.id}`);
    expect(detail.session).toMatchObject({ id: session.id, name: generatedTitle, cwd: parity.cwd,
      profileId: profile.id, sdkSessionId: session.sdkSessionId, ownerUserId: 1, parentSessionId: null });
    expect(parity.rows('SELECT id,name,cwd,profile_id,sdk_session_id,owner_user_id,parent_session_id FROM agent_sessions WHERE id=?', session.id)).toEqual([
      { id: session.id, name: generatedTitle, cwd: parity.cwd, profile_id: profile.id, sdk_session_id: session.sdkSessionId, owner_user_id: 1, parent_session_id: null },
    ]);
    await expect(page.getByTestId(`session-${session.id}`)).toContainText(generatedTitle);
    await page.reload();
    await expect(page.getByTestId(`session-${session.id}`)).toContainText(generatedTitle);
    await page.getByTestId(`session-${session.id}`).click();
    await expect(page.getByTestId('transcript')).toContainText(`${parity.prefix}: S0:plain one untitled turn`);
    expect((await parity.api.json<SessionDetail>(`/agent-sessions/${session.id}`)).session.name).toBe(generatedTitle);
    await testInfo.attach('autoname-scripted-proof.json', { contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ sessionId: session.id, sdkSessionId: session.sdkSessionId,
        generatedTitle, userTurns: 1, proof: 'scripted_ui_transport_only', realModelQualityClaimed: false })) });
  } finally {
    // Keep only allowlisted metadata before exact owned cleanup removes runtime logs.
    const diagnostic: Record<string, unknown> = { sessionId: session.id, sdkSessionId: session.sdkSessionId, providerHitsBefore };
    try {
      diagnostic.engineTitle = await engineTitle();
      diagnostic.apiName = (await parity.api.json<SessionDetail>(`/agent-sessions/${session.id}`)).session.name;
      diagnostic.providerHitsAfter = await providerHitCount();
      const configResponse = await parity.engineFetch('/config');
      const config = await configResponse.json() as { model?: string; small_model?: string; agent?: { title?: { model?: string } } };
      diagnostic.models = { model: config.model, smallModel: config.small_model, titleModel: config.agent?.title?.model ?? null };
      const logRoot = path.join(parity.sandbox, 'home/.local/share/opencode/log');
      expect(realpathSync(logRoot)).toBe(logRoot);
      const records: Array<Record<string, string>> = [];
      for (const name of readdirSync(logRoot).filter(name => /^[a-zA-Z0-9_.-]+\.log$/.test(name))) {
        const file = path.join(logRoot, name);
        const stat = lstatSync(file);
        expect(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid?.() && stat.size <= 16 * 1024 * 1024).toBe(true);
        for (const line of readFileSync(file, 'utf8').split('\n')) {
          if (!line.includes(`session.id=${session.sdkSessionId} `) && !line.includes(`sdkSessionId=${session.sdkSessionId} `)) continue;
          const fields: Record<string, string> = {};
          for (const match of line.matchAll(/(?:^|\s)(service|providerID|modelID|session\.id|sdkSessionId|purpose|reason|small|agent|mode)=([^\s]+)/g)) fields[match[1]] = match[2];
          const reason = line.match(/"reason":"([a-z_]+)"/);
          if (reason) fields.errorReason = reason[1];
          if (fields.purpose || fields.reason || fields.errorReason || fields.service === 'llm') records.push(fields);
        }
      }
      diagnostic.engineMetadata = records.slice(-100);
    } catch (error) { diagnostic.metadataReadError = error instanceof Error ? error.name : 'unknown'; }
    await testInfo.attach('autoname-bounded-diagnostics.json', { contentType: 'application/json', body: Buffer.from(JSON.stringify(diagnostic)) });
  }
});
