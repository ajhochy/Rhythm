import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository, type AgentMemory } from '../repositories/agent_memory_repository';
import * as retrieval from '../services/memory_retrieval';
import { prepareAutomaticMemoryPreface } from '../services/automatic_memory_preface';
import { engraphManager } from '../services/engraph_manager';
import type { EngraphHit } from '../services/engraph_client';

let db: Database.Database;
let root: string;
let notes: AgentMemory[];
let search: ReturnType<typeof vi.fn<(query: string, topN: number) => Promise<EngraphHit[]>>>;
let fts: ReturnType<typeof vi.spyOn>;
const prompt = 'Calibrate violet telescope optics';

function note(content: string, sourceId = 'preference/violet.md', tags: string[] = []): AgentMemory {
  const memory: AgentMemory = {
    id: sourceId, kind: 'preference', content, source: 'obsidian-memory', sourceId,
    tagsJson: JSON.stringify(tags), ownerUserId: 1, status: 'stable', staleAfter: null,
    verifiedJson: '[]', sourcesJson: '[]', generatedBy: null, generatedAt: null,
    trustTier: 'human', autoInjectable: true, createdAt: '2026-09-25', updatedAt: '2026-09-25',
  };
  const file = path.join(root, sourceId);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `---\nkind: preference\nstatus: stable\n---\n${content}\n`);
  notes.push(memory);
  return memory;
}

function native(memory: AgentMemory, snippet = memory.content) {
  search.mockResolvedValue([{ file: memory.sourceId!, snippet, confidence: 100, score: 1 }]);
}

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
  db.prepare(`INSERT INTO agent_sessions(id, agent_kind, cwd, name) VALUES ('s', 'synthetic', '/synthetic', 'synthetic')`).run();
  setDb(db);
  root = mkdtempSync(path.join(tmpdir(), 'synthetic-relevance-'));
  notes = [];
  vi.stubEnv('MEMORY_VAULT_PATH', root);
  vi.stubEnv('MEMORY_VAULT_SUBDIR', '');
  vi.stubEnv('AGENT_MEMORY_RETRIEVAL_MODE', 'hybrid');
  vi.stubEnv('AGENT_MEMORY_INJECTION_ENABLED', 'true');
  vi.stubEnv('AGENT_DECISION_MEMORY_RANKING', 'off');
  search = vi.fn().mockResolvedValue([]);
  vi.spyOn(engraphManager, 'getRetrievalClient').mockReturnValue({ search });
  fts = vi.spyOn(AgentMemoryRepository.prototype, 'searchAsync').mockResolvedValue([]);
  vi.spyOn(AgentMemoryRepository.prototype, 'findBySourceIdsAsync').mockImplementation(async (_s, ids) => notes.filter(n => ids.includes(n.sourceId!)));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe('Slice B automatic relevance contract (synthetic only)', () => {
  it.each(['resume', 'yes'])('B1: abstains on %s without invoking either retrieval lane', async current => {
    const result = await retrieval.buildMemoryPreface(current, 1);
    expect(result.text).toBe('');
    expect(search).not.toHaveBeenCalled();
    expect(fts).not.toHaveBeenCalled();
  });

  it('B1: resolves nearest substantive prior, skipping async/system frames and bounding evidence', () => {
    const resolve = (retrieval as any).resolveAutomaticMemoryQuery;
    expect(typeof resolve).toBe('function');
    expect(resolve('resume', ['[Async delegation update] telescope violet optics', '<system> telescope violet optics', prompt, 'Inspect amber camera lenses'])).toEqual({
      mode: 'continuation', query: 'resume', evidenceText: `resume\n${prompt}\nInspect amber camera lenses`,
    });
    expect(resolve(prompt, [])).toEqual({ mode: 'current', query: prompt, evidenceText: prompt });
    expect(resolve('yes', Array(6).fill('okay').concat(prompt)).mode).toBe('abstain');
    expect(resolve('resume', [prompt + ' x'.repeat(1000)]).evidenceText.length).toBeLessThanOrEqual(607);
  });

  it('B1: a short message reads as a follow-up only when a substantive prior exists', () => {
    const resolve = retrieval.resolveAutomaticMemoryQuery;
    const short = 'how do we tune those optics?';
    // <6 content words + substantive prior -> follow-up evidence includes the prior task.
    expect(resolve(short, ['what about the violet telescope calibration?']).mode).toBe('continuation');
    // Same short message with no usable prior stands alone (>=3 words), never silently abstains.
    expect(resolve(short, [])).toEqual({ mode: 'current', query: short, evidenceText: short });
    // >=6 content words is standalone even with a prior.
    expect(resolve('Calibrate violet telescope optics before tonight star party', [prompt]).mode).toBe('current');
  });

  it('B3: retriever order ranks admitted notes; word overlap only admits', async () => {
    const first = note('Violet telescope optics need a dew shield.', 'preference/dew-shield.md');
    const second = note('Calibrate violet telescope optics with the amber collimator at dusk.', 'fact/collimator.md');
    search.mockResolvedValue([
      { file: first.sourceId!, snippet: first.content, confidence: 100, score: 1 },
      { file: second.sourceId!, snippet: second.content, confidence: 90, score: 0.9 },
    ]);
    const result = await retrieval.buildMemoryPreface(prompt, 1);
    // second shares more words, but the retriever ranked first higher.
    expect(result.memoryIds).toEqual([first.id, second.id]);
  });

  it('B3: an excerpt with fewer than two words of its own is never injected, whatever its title', async () => {
    native(note('## Related -', 'fact/violet-telescope-optics-calibration.md'));
    const result = await retrieval.buildMemoryPreface(prompt, 1);
    // RED on the previous gate: the title alone carried this heading-only note into the prompt.
    expect(result.text).toBe('');
    expect(result.memoryIds).toEqual([]);
  });

  it('B1: conversational filler and light suffix forms do not inflate distinct content tokens', () => {
    expect(retrieval.resolveAutomaticMemoryQuery('yes okay thanks planning planned cups cup', []).mode).toBe('abstain');
    expect(retrieval.resolveAutomaticMemoryQuery('planning planned cups cup batteries battery', []).mode).toBe('current');
  });

  it('B2: reads persisted prior input itself, removes only the current duplicate, and retrieves its note', async () => {
    const m = note('Violet telescope optics require gentle calibration.');
    native(m);
    db.prepare(`INSERT INTO agent_session_messages(session_id, role, raw_text, stripped_text) VALUES (?, ?, ?, ?)`).run('s', 'input', 'raw synthetic', prompt);
    db.prepare(`INSERT INTO agent_session_messages(session_id, role, raw_text, stripped_text) VALUES (?, ?, ?, ?)`).run('s', 'input', 'resume', 'resume');
    const result = await prepareAutomaticMemoryPreface({ query: 'resume', sessionId: 's', ownerUserId: 1 });
    expect(result?.memoryIds).toEqual([m.id]);
    // Only the current message is searched; the persisted prior decides relevance.
    expect(search.mock.calls[0][0]).toBe('resume');
    expect((result as any).queryMode).toBe('continuation');
  });

  it('B3: rejects a rank-100 semantic hit with only one shared content token', async () => {
    const m = note('Violet gardens enjoy rain.', 'preference/gardens.md'); native(m);
    const result = await retrieval.buildMemoryPreface(prompt, 1);
    expect(result.memoryIds).toEqual([]);
    expect((result as any).candidates[0]).toMatchObject({ sharedTokenCount: 1, admitted: false, reason: 'insufficient_overlap', lane: 'semantic' });
  });

  it('B3: admits two tokens across canonical excerpt and displayed atomic title, with provenance', async () => {
    const m = note('Telescope mirrors need gentle handling.', 'preference/violet.md'); native(m);
    const result = await retrieval.buildMemoryPreface(prompt, 1);
    expect(result.memoryIds).toEqual([m.id]);
    expect(result.text).toContain('violet');
    expect(result.text).toContain('(preference, updated 2026-09-25)');
    expect((result as any).candidates[0].sharedTokenCount).toBe(2);
  });

  it('B3: broad archive requires three tokens without title credit and replaces mid-word snippets', async () => {
    const m = note('Violet telescope mirrors need care.', 'context/violet-optics.md', ['archive']);
    native(m, 'iolet telescope mirrors need care.');
    expect((await retrieval.buildMemoryPreface(prompt, 1)).memoryIds).toEqual([]);
    m.content = 'Violet telescope optics need care.';
    writeFileSync(path.join(root, m.sourceId!), `---\nkind: preference\nstatus: stable\n---\n${m.content}\n`);
    native(m, 'iolet telescope optics need care.');
    const result = await retrieval.buildMemoryPreface(prompt, 1);
    expect(result.memoryIds).toEqual([m.id]);
    expect(result.text).toContain('- Violet telescope optics need care.');
    expect(result.text).not.toContain('- iolet');
  });

  it('B3: whole 20KB archive cannot lend a token outside the displayed excerpt', async () => {
    const m = note('Violet telescope ' + 'padding '.repeat(2600) + 'optics.', 'context/import-synthetic.md', ['archive']);
    fts.mockResolvedValue([m]);
    const result = await retrieval.buildMemoryPreface(prompt, 1);
    expect(result.memoryIds).toEqual([]);
    expect((result as any).candidates[0].sharedTokenCount).toBe(2);
  });

  it('B3/B4: preserves total/item budgets and excludes Dayflow before those budgets', async () => {
    const day = note('Violet telescope optics.', 'context/day.md', ['source:dayflow']);
    const a = note('Violet telescope optics. ' + 'extra '.repeat(300), 'preference/a.md');
    const b = note('Violet telescope optics.', 'preference/b.md');
    const c = note('Violet telescope optics.', 'preference/c.md');
    fts.mockResolvedValue([day, a, b, c]);
    const result = await prepareAutomaticMemoryPreface({ query: prompt, ownerUserId: 1, sessionId: 's' });
    expect(result!.memoryIds).not.toContain(day.id);
    expect(result!.memoryIds.length).toBeLessThanOrEqual(2);
    expect(result!.memoryIds.length).toBeGreaterThan(0);
    expect(result!.text.length).toBeLessThanOrEqual(1200);
    expect(result!.items.every(i => i.excerptChars! <= 500)).toBe(true);
  });

  it('B5: appends body-free receipts per call, latest UI provenance unchanged, prunes per session', async () => {
    const m = note('Violet telescope optics require gentle calibration.'); native(m);
    await prepareAutomaticMemoryPreface({ query: prompt, sessionId: 's', ownerUserId: 1 });
    await prepareAutomaticMemoryPreface({ query: 'yes', sessionId: 's', ownerUserId: 1 });
    const rows = db.prepare('SELECT * FROM agent_memory_turn_receipts WHERE session_id = ? ORDER BY id').all('s') as any[];
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.decision)).toEqual(['injected', 'abstained']);
    expect(JSON.parse(rows[0].candidates_json)[0]).toMatchObject({ memoryId: m.id, sharedTokenCount: 3, admitted: true });
    expect(JSON.stringify(rows)).not.toContain(prompt);
    expect(JSON.stringify(rows)).not.toContain(m.content);
    expect(db.prepare('SELECT memory_ids_json FROM agent_session_memory_provenance WHERE session_id = ?').get('s')).toEqual({ memory_ids_json: '[]' });
    for (let i = 0; i < 201; i++) await prepareAutomaticMemoryPreface({ query: 'yes', sessionId: 's', ownerUserId: 1 });
    expect(db.prepare('SELECT count(*) n FROM agent_memory_turn_receipts WHERE session_id = ?').get('s')).toEqual({ n: 200 });
    vi.stubEnv('AGENT_MEMORY_INJECTION_ENABLED', 'false');
    expect(await prepareAutomaticMemoryPreface({ query: prompt, sessionId: 'other', ownerUserId: 1 })).toBeNull();
    expect(db.prepare('SELECT decision FROM agent_memory_turn_receipts WHERE session_id = ?').get('other')).toEqual({ decision: 'disabled' });
  });

  it('B6: semantic timeout preserves FTS relevance decisions and timeout receipt', async () => {
    const m = note('Violet telescope optics require gentle calibration.');
    const irrelevant = note('Violet gardens need rain.', 'preference/garden.md');
    fts.mockResolvedValue([irrelevant, m]);
    vi.stubEnv('AGENT_MEMORY_SEMANTIC_BUDGET_MS', '25');
    search.mockImplementation(() => new Promise(() => {}));
    const result = await prepareAutomaticMemoryPreface({ query: prompt, sessionId: 's', ownerUserId: 1 });
    expect(result?.memoryIds).toEqual([m.id]);
    expect(result?.semanticStatus).toBe('timeout');
    expect(db.prepare('SELECT semantic_status FROM agent_memory_turn_receipts WHERE session_id = ?').get('s')).toEqual({ semantic_status: 'timeout' });
  });

  it('B2: prior read failure is fail-open for substantive current prompts', async () => {
    const m = note('Violet telescope optics require gentle calibration.'); native(m);
    // A database read failure, not a mocked resolver/build path.
    db.exec('DROP TABLE agent_session_messages');
    const result = await prepareAutomaticMemoryPreface({ query: prompt, sessionId: 's', ownerUserId: 1 });
    expect(result?.memoryIds).toEqual([m.id]);
    expect((result as any).queryMode).toBe('current');
  });

  it('B5: records none_relevant and error decisions, and diagnostic write failure never blocks', async () => {
    const m = note('Violet gardens enjoy rain.', 'preference/gardens.md'); native(m);
    await prepareAutomaticMemoryPreface({ query: prompt, sessionId: 's', ownerUserId: 1 });
    expect(db.prepare('SELECT decision FROM agent_memory_turn_receipts').get()).toEqual({ decision: 'none_relevant' });
    vi.mocked(engraphManager.getRetrievalClient).mockImplementationOnce(() => { throw new Error('synthetic unavailable boundary'); });
    expect(await prepareAutomaticMemoryPreface({ query: prompt, sessionId: 's', ownerUserId: 1 })).toBeNull();
    expect(db.prepare('SELECT decision FROM agent_memory_turn_receipts ORDER BY id DESC LIMIT 1').get()).toEqual({ decision: 'error' });
    db.exec('DROP TABLE agent_memory_turn_receipts');
    const matching = note('Violet telescope optics need calibration.'); native(matching);
    expect((await prepareAutomaticMemoryPreface({ query: prompt, sessionId: 's', ownerUserId: 1 }))?.memoryIds).toEqual([matching.id]);
  });
});
