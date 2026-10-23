// This exercises the production extractor queue, source transcript, lifetime guard and real engine.
// The loopback model output is scripted; skill quality and paid-model behavior are outside this proof.
import { test, expect } from './parity-fixture';
import { prepareScriptedModel, createScriptedProfile, assertProjectedNoTools, createScriptedSession,
  sendScriptedTurn, engineMessages, completed, noToolParts, backgroundEngineRead, sandboxLog,
  scriptedModel, scriptedAnswer, type EngineMessage } from './scripted-parity-fixture';

type SystemRow = { id: string; name: string; cwd: string; sdk_session_id: string; owner_user_id: number | null;
  category: string; is_system: number };
test('[web-parity-111] [P0] private chat sources one real Luna skill extraction and no duplicate after a third turn', async ({ page, parity }, testInfo) => {
  test.setTimeout(350_000);
  expect(process.env.RHYTHM_LOCAL_SMOKE).not.toBe('1');
  expect(process.env.NODE_ENV).not.toBe('test');
  expect(parity.rows('SELECT id FROM agent_sessions'), 'run extraction first in its fresh dedicated scripted sandbox').toEqual([]);
  await prepareScriptedModel(parity, true);
  const profile = await createScriptedProfile(parity, `${parity.prefix} extraction profile`);
  await assertProjectedNoTools(parity, profile.id);
  const chat = await createScriptedSession(parity, profile.id, `${parity.prefix} extraction chat`);
  const systemRows = () => parity.rows(`SELECT id,name,cwd,sdk_session_id,owner_user_id,category,is_system
    FROM agent_sessions WHERE name='skill-extract' AND category='self_improvement' AND is_system=1`) as SystemRow[];
  const queued = `[skill-extract] queued for ${chat.id}`;
  const queueCount = () => sandboxLog(parity).split(queued).length - 1;
  let attributable: SystemRow | undefined;
  let terminal = false;
  const prompts = [1, 2, 3].map(index => `${parity.prefix}: S0:plain extractor source turn ${index}`);
  parity.deferCleanup('exact source-attributed extractor API DB engine deletion', async () => {
    const rows = systemRows();
    if (!rows.length) return;
    expect(attributable, 'retain unattributed extractor evidence for whole-sandbox cleanup').toBeDefined();
    expect(terminal, 'retain nonterminal background work').toBe(true);
    expect(queueCount()).toBe(1);
    expect(rows).toEqual([attributable]);
    const engine = await backgroundEngineRead(parity, attributable!);
    expect(engine.status).toBe(200);
    expect(await engine.json()).toMatchObject({ id: attributable!.sdk_session_id, directory: parity.sandbox });
    const url = new URL(`/session/${encodeURIComponent(attributable!.sdk_session_id)}`, `http://127.0.0.1:${parity.enginePort}`);
    url.searchParams.set('directory', parity.sandbox);
    expect((await parity.api.fetch(`/agent-sessions/${attributable!.id}/hard`, { method: 'DELETE' })).status).toBe(204);
    expect((await parity.api.fetch(`/agent-sessions/${attributable!.id}`)).status).toBe(404);
    expect(parity.rows('SELECT id FROM agent_sessions WHERE id=?', attributable!.id)).toEqual([]);
    expect((await fetch(url, { signal: AbortSignal.timeout(20_000) })).status).toBe(404);
  });
  await page.goto('/#/agents');
  await page.getByTestId(`session-${chat.id}`).click();
  // Production's 90-second curator cold-start gate remains unchanged.
  await page.waitForTimeout(95_000);
  for (const prompt of prompts.slice(0, 2)) await sendScriptedTurn(page, parity, chat, prompt);
  const main = await engineMessages(parity, String(chat.sdkSessionId));
  expect(main.filter(message => message.info.role === 'user')).toHaveLength(2);
  expect(completed(main)).toHaveLength(2);
  noToolParts(main);
  await expect.poll(async () => {
    const rows = systemRows();
    if (queueCount() !== 1 || rows.length !== 1 || !rows[0].sdk_session_id) return false;
    const response = await backgroundEngineRead(parity, rows[0], '/message?limit=100');
    if (response.status !== 200) return false;
    const messages = await response.json() as EngineMessage[];
    return completed(messages).length === 1;
  }, { timeout: 110_000, intervals: [1000] }).toBe(true);
  expect(queueCount()).toBe(1);
  const candidates = systemRows();
  expect(candidates).toHaveLength(1);
  const system = candidates[0];
  expect(system).toMatchObject({ name: 'skill-extract', category: 'self_improvement', is_system: 1, cwd: parity.sandbox });
  expect(system.sdk_session_id).toMatch(/^ses_/);
  const response = await backgroundEngineRead(parity, system, '/message?limit=100');
  expect(response.status).toBe(200);
  const messages = await response.json() as EngineMessage[];
  const inputs = messages.filter(message => message.info.role === 'user');
  expect(inputs.some(message => message.parts.some(part => part.type === 'text' && prompts.slice(0, 2).every(prompt => part.text?.includes(prompt)))),
    'background SDK input must contain both exact owned source prompts').toBe(true);
  attributable = system;
  const answers = completed(messages);
  expect(answers).toHaveLength(1);
  terminal = true;
  expect(answers[0].info).toMatchObject(scriptedModel);
  expect(answers[0].parts.some(part => part.type === 'text' && part.text?.trim() === scriptedAnswer)).toBe(true);
  noToolParts(messages);
  await sendScriptedTurn(page, parity, chat, prompts[2]);
  const third = await engineMessages(parity, String(chat.sdkSessionId));
  expect(completed(third)).toHaveLength(3);
  expect(third.filter(message => message.info.role === 'user')).toHaveLength(3);
  noToolParts(third);
  await page.waitForTimeout(3000);
  expect(queueCount(), 'third source turn must not queue a second extraction').toBe(1);
  expect(systemRows()).toEqual([system]);
  await testInfo.attach('extraction-scripted-proof.json', { contentType: 'application/json',
    body: Buffer.from(JSON.stringify({ sourceSessionId: chat.id, extractorSessionId: system.id,
      sourcePromptsBound: 2, completedSourceTurns: 3, extractorCompleted: 1, queueCount: 1,
      toolParts: 0, proof: 'scripted_ui_transport_only', realModelQualityClaimed: false })) });
});
