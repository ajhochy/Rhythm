import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository, type AgentMemory } from '../repositories/agent_memory_repository';
import { AgentMemoryTurnReceiptsRepository } from '../repositories/agent_memory_turn_receipts_repository';
import { buildMemoryPreface, resolveAutomaticMemoryQuery } from '../services/memory_retrieval';
import { prepareAutomaticMemoryPreface } from '../services/automatic_memory_preface';
import { engraphManager } from '../services/engraph_manager';
import type { EngraphHit } from '../services/engraph_client';

let db: Database.Database;
let previous: Database.Database | null;
let root: string;
let hits: EngraphHit[];
let search: ReturnType<typeof vi.fn<(query: string, topN: number) => Promise<EngraphHit[]>>>;
const repo = new AgentMemoryRepository();
const workout = 'Plan strength workout squats recovery';
const bug = 'Fix parser bug handling unicode escapes';
const writing = 'draft volunteer email';
const style = 'Use warm direct language. Keep paragraphs short and avoid ceremonial greetings.';
const archiveBody = `# Historical notes\n## Workout plan\nSquats recovery lifting unrelated workout.\n## Writing style profile\n${style}\n## Football lookup\nUnrelated football scores and betting archive.`;

async function note(content: string, sourceId = 'context/import-synthetic.md', tags = ['archive'], ownerUserId = 1) {
  const memory = await repo.createAsync({ content, kind: 'preference', source: 'obsidian-memory', sourceId,
    tagsJson: JSON.stringify(tags), ownerUserId, autoInjectable: true });
  db.prepare('UPDATE agent_memory SET status = ?, updated_at = ? WHERE id = ?').run('stable', '2026-09-25', memory.id);
  memory.status = 'stable'; memory.updatedAt = '2026-09-25';
  writeCanonical(memory);
  hits.push({ file: sourceId, snippet: content, score: 1, confidence: 100 });
  return memory;
}
function writeCanonical(memory: AgentMemory) {
  const file = path.join(root, memory.sourceId!);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `---\nkind: preference\nstatus: ${memory.status}\n---\n${memory.content}\n`);
}
function input(text: string) {
  db.prepare('INSERT INTO agent_session_messages(session_id, role, raw_text, stripped_text) VALUES (?, ?, ?, ?)')
    .run('s', 'input', text, text);
}
beforeEach(() => {
  db = new Database(':memory:'); runMigrations(db); previous = setDb(db);
  db.prepare("INSERT INTO users(id, name, email) VALUES (1, 'Synthetic owner', 'owner@example.invalid'), (2, 'Synthetic foreign', 'foreign@example.invalid')").run();
  db.prepare("INSERT INTO agent_sessions(id, agent_kind, cwd, name) VALUES ('s', 'synthetic', '/synthetic', 'synthetic')").run();
  root = mkdtempSync(path.join(tmpdir(), 'memory-current-task-'));
  hits = [];
  vi.stubEnv('MEMORY_VAULT_PATH', root); vi.stubEnv('MEMORY_VAULT_SUBDIR', '');
  vi.stubEnv('AGENT_MEMORY_RETRIEVAL_MODE', 'hybrid'); vi.stubEnv('AGENT_MEMORY_INJECTION_ENABLED', 'true');
  vi.stubEnv('AGENT_DECISION_MEMORY_RANKING', 'off'); vi.stubEnv('AGENT_MEMORY_LINK_EXPANSION_ENABLED', 'false');
  search = vi.fn(async () => hits);
  vi.spyOn(engraphManager, 'getRetrievalClient').mockReturnValue({ search });
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs(); setDb(previous); db.close();
  // No cleanup: all synthetic fixtures intentionally retained under manager TMPDIR.
});

describe('Original memory current-task contracts (synthetic canonical records; fake native ranking only)', () => {
  it.each(['push 211 to staging', 'deploy named service', 'write function'])('A1 new concrete command %s cannot borrow workout evidence', async command => {
    const m = await note('Strength workout squats recovery use gentle lifting.', 'preference/workout.md', []);
    expect(resolveAutomaticMemoryQuery(command, [workout])).toEqual({ mode: 'current', query: command, evidenceText: command });
    const result = await buildMemoryPreface(command, 1, { priorUserTexts: [workout], priorMemoryIds: [m.id] });
    expect(result.memoryIds).toEqual([]); expect(result.text).not.toContain('lifting');
  });
  it.each(['thanks', 'thanks for that', 'yes that helps', 'yes okay', 'resume'])('A2 %s without an actionable task abstains', async command => {
    const result = await buildMemoryPreface(command, 1, { priorUserTexts: command === 'resume' ? [] : [workout] });
    expect(result.decision).toBe('abstained'); expect(search).not.toHaveBeenCalled();
  });
  it('A3 nearest bug task excludes older workout even in two-record lookback', async () => {
    const old = await note('Strength workout squats recovery.', 'preference/workout.md', []);
    const current = await note('Parser bug unicode escapes need regression coverage.', 'fact/parser.md', []);
    const resolved = resolveAutomaticMemoryQuery('resume', [bug, workout]);
    expect(resolved.evidenceText).toContain(bug); expect(resolved.evidenceText).not.toContain(workout);
    const result = await buildMemoryPreface('resume', 1, { priorUserTexts: [bug, workout] });
    expect(result.memoryIds).toEqual([current.id]); expect(result.memoryIds).not.toContain(old.id);
    expect(search.mock.calls[0][0]).not.toBe('resume'); expect(search.mock.calls[0][0].length).toBeLessThanOrEqual(80);
  });
  it.each([
    ['what about lines', 'Look up football betting odds using OddsAPI', 'Football betting odds lines use OddsAPI.', 'fact/odds-api.md'],
    ['how do we tune those optics', 'Calibrate violet telescope optics', 'Violet telescope optics need careful calibration.', 'fact/optics.md'],
    ['how do we tune those optics', 'what about the violet telescope calibration?', 'Violet telescope optics need careful calibration.', 'fact/optics.md'],
    ['continue', 'Adjust slide gradient and text centering', 'Slide gradient text centering uses centered alignment.', 'preference/slides.md'],
  ])('A4 genuine %s retains useful task-specific facts, not merely a nonempty block', async (current, prior, body, source) => {
    const m = await note(body, source, []);
    const result = await buildMemoryPreface(current, 1, { priorUserTexts: [prior, workout] });
    expect(result.queryMode).toBe('continuation'); expect(result.memoryIds).toEqual([m.id]); expect(result.text).toContain(body);
  });
  it('C1 draft volunteer email extracts only coherent style section with true parent/date and body-free reason', async () => {
    const m = await note(archiveBody);
    const result = await buildMemoryPreface(writing, 1, { genericAdmission: true });
    expect(result.memoryIds).toEqual([m.id]); expect(result.text).toContain(style);
    expect(result.text).not.toContain('Squats'); expect(result.text).not.toContain('football scores');
    expect(result.text).toContain(m.sourceId!); expect(result.text).toContain('Writing style profile');
    expect(result.text).toContain('updated 2026-09-25');
    expect(result.items[0].reason).toBe('applicable_preference_section');
    expect(result.candidates?.[0]).toMatchObject({ admitted: true, reason: 'applicable_preference_section' });
  });
  it.each(['write function', 'push 211 to staging', workout, 'lookup football scores'])('C2 %s never receives archive writing preference', async current => {
    const m = await note(archiveBody);
    const result = await buildMemoryPreface(current, 1);
    expect(result.text).not.toContain(style);
    // Other archive references still obey the unchanged three-token gate; this is not a blanket archive ban.
    if (current === 'write function' || current === 'push 211 to staging') expect(result.memoryIds).not.toContain(m.id);
  });
  it('C3 explicit voice continuation retains writing task, not older workout', async () => {
    const m = await note(archiveBody);
    const result = await buildMemoryPreface('use my voice for that', 1, { priorUserTexts: [writing, workout] });
    expect(result.queryMode).toBe('continuation'); expect(result.memoryIds).toEqual([m.id]); expect(result.text).toContain(style);
  });
  it('C4 current atomic preference ranks ahead of derived archive even when native ranks archive first', async () => {
    await note(archiveBody);
    const atomic = await note('Draft volunteer email with concise friendly language.', 'preference/writing.md', []);
    const result = await buildMemoryPreface(writing, 1);
    expect(result.memoryIds[0]).toBe(atomic.id); expect(result.text).toContain(atomic.content);
  });
  it('C5 Dayflow-tagged structured section is withheld before output budget', async () => {
    const day = await note(archiveBody, 'context/import-day.md', ['archive', 'source:dayflow']);
    const ordinary = await note(archiveBody, 'context/import-ordinary.md');
    const result = await buildMemoryPreface(writing, 1, { genericAdmission: true });
    expect(result.memoryIds).toEqual([ordinary.id]); expect(result.memoryIds).not.toContain(day.id);
  });
  it('C6 ambiguous duplicate preference sections abstain rather than releasing an archive', async () => {
    await note(`${archiveBody}\n## Tone and voice\nUse formal ornate language.`);
    const result = await buildMemoryPreface(writing, 1);
    expect(result.memoryIds).toEqual([]);
  });
  it('B1 continuation consumes current canonical record after update, never receipt excerpt or latest provenance', async () => {
    const m = await note('Parser bug unicode escapes previously require slow scanning.', 'fact/parser.md', []);
    input(bug); await prepareAutomaticMemoryPreface({ query: bug, sessionId: 's', ownerUserId: 1 });
    m.content = 'Parser bug unicode escapes now require bounded scanning.';
    db.prepare('UPDATE agent_memory SET content = ? WHERE id = ?').run(m.content, m.id); writeCanonical(m);
    hits = []; search.mockClear();
    input('thanks'); await prepareAutomaticMemoryPreface({ query: 'thanks', sessionId: 's', ownerUserId: 1 });
    input('resume');
    const result = await prepareAutomaticMemoryPreface({ query: 'resume', sessionId: 's', ownerUserId: 1 });
    expect(result?.memoryIds).toEqual([m.id]); expect(result?.text).toContain('bounded scanning');
    expect(result?.text).not.toContain('slow scanning'); expect(search).not.toHaveBeenCalled();
  });
  it('B2 foreign/inactive/Dayflow/stale canonical prior IDs cannot bypass fences; fallback uses substantive query', async () => {
    const foreign = await note('Parser bug unicode escapes.', 'fact/foreign.md', [], 2);
    const inactive = await note('Parser bug unicode escapes.', 'fact/inactive.md', []);
    db.prepare("UPDATE agent_memory SET status = 'deprecated' WHERE id = ?").run(inactive.id);
    const day = await note('Parser bug unicode escapes.', 'fact/day.md', ['source:dayflow']);
    const stale = await note('Parser bug unicode escapes.', 'fact/stale.md', []);
    writeFileSync(path.join(root, stale.sourceId!), 'different canonical content');
    hits = [];
    const result = await buildMemoryPreface('resume', 1, { priorUserTexts: [bug], genericAdmission: true,
      priorMemoryIds: [foreign.id, inactive.id, day.id, stale.id] });
    expect(result.memoryIds).not.toContain(foreign.id); expect(result.memoryIds).not.toContain(inactive.id);
    expect(result.memoryIds).not.toContain(day.id); expect(result.memoryIds).not.toContain(stale.id);
    expect(search.mock.calls[0][0]).not.toBe('resume');
  });
  it('B3 receipt lookback stops at new current task even when it admitted nothing', async () => {
    const m = await note('Strength workout squats recovery.', 'fact/workout.md', []);
    input(workout); await prepareAutomaticMemoryPreface({ query: workout, sessionId: 's', ownerUserId: 1 });
    input('push 211 to staging'); await prepareAutomaticMemoryPreface({ query: 'push 211 to staging', sessionId: 's', ownerUserId: 1 });
    input('resume'); const result = await prepareAutomaticMemoryPreface({ query: 'resume', sessionId: 's', ownerUserId: 1 });
    expect(result?.memoryIds).not.toContain(m.id); expect(result?.text).not.toContain('squats');
  });
  it('D1 keeps fences, exact budgets, body-free reason and per-session receipt pruning', async () => {
    await note(archiveBody); const result = await buildMemoryPreface(writing, 1, { genericAdmission: true });
    expect(result.memoryIds).toHaveLength(1); expect(result.text).toContain('UNTRUSTED');
    expect(result.text.length).toBeLessThanOrEqual(1200); expect(Math.ceil(result.text.length / 4)).toBeLessThanOrEqual(300);
    expect(result.items.every(i => typeof i.excerptChars === 'number' && i.excerptChars <= 500)).toBe(true);
    const receipts = new AgentMemoryTurnReceiptsRepository();
    for (let i = 0; i < 201; i++) receipts.append('s', result);
    const rows = db.prepare("SELECT * FROM agent_memory_turn_receipts WHERE session_id = 's'").all();
    expect(rows).toHaveLength(200); expect(JSON.stringify(rows)).toContain('applicable_preference_section');
    for (const forbidden of [writing, style, 'Writing style profile', 'evidenceText', 'excerpt', 'queryTokens']) expect(JSON.stringify(rows)).not.toContain(forbidden);
  });
});
