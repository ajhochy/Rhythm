import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMemory } from '../repositories/agent_memory_repository';
import { buildMemoryPreface } from '../services/memory_retrieval';

// Reproduces the installed-69 live failure: an unrelated aquarium note that
// merely lists the topic's words displaced the room/arrival facts, and the
// room/arrival notes displayed only their title line instead of the fact.
function fact(slug: string, content: string): AgentMemory {
  return {
    id: slug, kind: 'fact', content, source: 'obsidian-memory', sourceId: `fact/${slug}.md`,
    tagsJson: '[]', ownerUserId: null, status: 'stable', staleAfter: null,
    verifiedJson: '[]', sourcesJson: '[]', generatedBy: 'agent:rhythm/1', generatedAt: '2026-10-11T00:00:00Z',
    trustTier: 'unverified', autoInjectable: true, createdAt: '2026-10-11', updatedAt: '2026-10-11',
  };
}

const materials = fact('cobalt-lantern-rehearsal-checklist-materials-and-access',
  'Cobalt Lantern rehearsal checklist materials and access.\nThe invented folder color is mulberry and the invented supply-locker code is 4729. The mulberry folder contains the printed rehearsal sequence, attendance sheet, keyboard cues and microphone position notes.');
const arrival = fact('cobalt-lantern-rehearsal-checklist-arrival-and-preparation',
  'Cobalt Lantern rehearsal checklist arrival and preparation.\nThe invented participant arrival time is 18:43. Arrival preparation begins with reading the printed rehearsal sequence. The recorded checklist uses 18:43 as its arrival time; no date, calendar account, invitation or real schedule is implied by this invented qualification fact.');
const room = fact('cobalt-lantern-rehearsal-checklist-room-and-layout',
  'Cobalt Lantern rehearsal checklist room and layout.\nThe invented rehearsal room is Juniper 37. The room checklist places a rehearsal keyboard on the north platform, a stool behind the keyboard, two microphones beside the lectern, and a paper attendance sheet on the west table.');
const aquarium = fact('violet-harbor-aquarium-maintenance-fact',
  'Violet Harbor aquarium maintenance fact.\nThe invented aquarium contains a copper pebble called Tessel 912. The weekly aquarium check records water clarity and the pebble position; it has no relation to rehearsal checklists, room allocation, arrival time, folders or supply lockers.');

const QUESTION = 'What is known about the Cobalt Lantern rehearsal checklist: room, arrival time, folder color and supply-locker code? Use only currently retrieved Memory evidence, say when a detail is unavailable, and do not use tools.';

beforeEach(() => {
  vi.stubEnv('AGENT_DECISION_MEMORY_RANKING', 'off');
  vi.stubEnv('AGENT_MEMORY_LINK_EXPANSION', 'false');
});
afterEach(() => vi.unstubAllEnvs());

describe('automatic memory follow-ups select the named subject, not a word-list lookalike', () => {
  const pool = [materials, arrival, room, aquarium];

  it.each([
    ['current question', QUESTION, [] as string[]],
    ['short continuation', 'Continue with that. Do not use tools.', [QUESTION]],
  ])('%s: never injects the aquarium note and shows fact sentences, within budget', async (_label, query, prior) => {
    const preface = await buildMemoryPreface(query, 1, {
      enabled: true, priorUserTexts: prior, getRelevant: async () => pool,
    });
    expect(preface.notePaths).not.toContain(aquarium.sourceId);
    expect(preface.text).not.toMatch(/aquarium/i);
    expect(preface.memoryIds).toHaveLength(2);
    expect(preface.text.length).toBeLessThanOrEqual(1200);
    // A selected room/arrival note must display its fact, not only its title line.
    if (preface.memoryIds.includes(room.id)) expect(preface.text).toContain('Juniper 37');
    if (preface.memoryIds.includes(arrival.id)) expect(preface.text).toContain('18:43');
    expect(preface.text).not.toContain('checklist room and layout.');
    expect(preface.text).not.toContain('checklist arrival and preparation.');
    // Body-free provenance is unchanged.
    expect(JSON.stringify(preface.items)).not.toContain('Juniper');
    expect(preface.candidates?.find(c => c.memoryId === aquarium.id)?.admitted).toBe(false);
  });

  it('a selected room note displays its room fact, not its longest keyword sentence', async () => {
    const preface = await buildMemoryPreface(QUESTION, 1, {
      enabled: true, getRelevant: async () => [aquarium, room],
    });
    expect(preface.memoryIds).toEqual([room.id]);
    expect(preface.text).toContain('Juniper 37');
  });

  it('a pronoun follow-up resolves the prior event and picks room + arrival over the aquarium', async () => {
    const dinnerRoom = fact('harvest-dinner-room', 'Harvest Dinner room.\nThe Harvest Dinner is in Room 204 of the fellowship hall.');
    const dinnerArrival = fact('harvest-dinner-arrival', 'Harvest Dinner arrival.\nHarvest Dinner guests arrive at 6:30pm.');
    const lobbyTank = fact('lobby-aquarium-care', 'Lobby aquarium care.\nFeed the lobby aquarium fish every Friday evening and keep the room lights dim.');
    const preface = await buildMemoryPreface('What room and when do they arrive?', 1, {
      enabled: true,
      priorUserTexts: ['Planning the Harvest Dinner fellowship event for Friday evening.'],
      getRelevant: async () => [dinnerRoom, lobbyTank, dinnerArrival],
    });
    expect(preface.queryMode).toBe('continuation');
    expect(new Set(preface.memoryIds)).toEqual(new Set([dinnerRoom.id, dinnerArrival.id]));
    expect(preface.text).toContain('Room 204');
    expect(preface.text).toContain('6:30pm');
  });

  it('abstains when nothing shares the named subject', async () => {
    const preface = await buildMemoryPreface('What room do the Cobalt Lantern players use for rehearsal?', 1, {
      enabled: true, getRelevant: async () => [aquarium],
    });
    expect(preface.memoryIds).toEqual([]);
    expect(preface.text).toBe('');
  });
});
