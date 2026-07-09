/**
 * lazy_deps_turn_hook.test.ts — #876: "on first use" integration.
 *
 * The model's real skill invocation happens inside the vendored opencode
 * fork's `skill` tool (apps/opencode_fork/.../tool/skill.ts), which this repo
 * must not modify. The only api_server-observable signal that a specific
 * named skill was actually invoked in a turn is the persisted tool-call PART
 * (parts_json, written by OpencodeStreamBridge.upsertPart from the fork's
 * `message.part.updated` events) — a part with `type: 'tool'`, `tool: 'skill'`
 * (or `name: 'skill'`), and an input/state.input carrying `{ name: <skillName> }`.
 *
 * extractInvokedSkillNamesFromParts is the pure parser for that shape;
 * ensureLazyDepsForTurn composes it with listSkillsWithContent + frontmatter
 * parsing + ensurePythonDependencies for every skill invoked in one turn.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { extractInvokedSkillNamesFromParts, ensureLazyDepsForTurn } from '../lazy_deps_turn_hook';

describe('extractInvokedSkillNamesFromParts (#876)', () => {
  it('extracts the skill name from a completed skill tool-call part (input.name)', () => {
    const parts = [
      { type: 'tool', tool: 'skill', state: { status: 'completed', input: { name: 'gif-search' } } },
    ];
    expect(extractInvokedSkillNamesFromParts(parts)).toEqual(['gif-search']);
  });

  it('extracts from the alternate `input` (not nested under state) shape', () => {
    const parts = [{ type: 'tool', tool: 'skill', input: { name: 'gif-search' } }];
    expect(extractInvokedSkillNamesFromParts(parts)).toEqual(['gif-search']);
  });

  it('extracts from the alternate `name` field (instead of `tool`) shape', () => {
    const parts = [{ type: 'tool', name: 'skill', state: { input: { name: 'gif-search' } } }];
    expect(extractInvokedSkillNamesFromParts(parts)).toEqual(['gif-search']);
  });

  it('ignores non-skill tool parts', () => {
    const parts = [{ type: 'tool', tool: 'bash', state: { input: { command: 'ls' } } }];
    expect(extractInvokedSkillNamesFromParts(parts)).toEqual([]);
  });

  it('ignores non-tool parts (text, etc.)', () => {
    const parts = [{ type: 'text', text: 'hello' }];
    expect(extractInvokedSkillNamesFromParts(parts)).toEqual([]);
  });

  it('dedupes repeated invocations of the same skill in one turn', () => {
    const parts = [
      { type: 'tool', tool: 'skill', state: { input: { name: 'gif-search' } } },
      { type: 'tool', tool: 'skill', state: { input: { name: 'gif-search' } } },
    ];
    expect(extractInvokedSkillNamesFromParts(parts)).toEqual(['gif-search']);
  });

  it('handles multiple distinct skills invoked in one turn', () => {
    const parts = [
      { type: 'tool', tool: 'skill', state: { input: { name: 'gif-search' } } },
      { type: 'tool', tool: 'skill', state: { input: { name: 'other-skill' } } },
    ];
    expect(extractInvokedSkillNamesFromParts(parts)).toEqual(['gif-search', 'other-skill']);
  });

  it('never throws on malformed/garbage parts', () => {
    const parts = [null, undefined, {}, { type: 'tool' }, { type: 'tool', tool: 'skill' }, 42, 'string'];
    expect(() => extractInvokedSkillNamesFromParts(parts as never)).not.toThrow();
    expect(extractInvokedSkillNamesFromParts(parts as never)).toEqual([]);
  });

  it('empty parts array yields []', () => {
    expect(extractInvokedSkillNamesFromParts([])).toEqual([]);
  });
});

describe('ensureLazyDepsForTurn (#876 composition)', () => {
  const tempDirs: string[] = [];

  function skillMd(name: string, deps = ''): string {
    return ['---', `name: ${name}`, deps, '---', '', 'body'].filter(Boolean).join('\n');
  }

  function writeTempSkillMd(name: string, deps = ''): string {
    const root = mkdtempSync(join(tmpdir(), 'rhythm-lazy-deps-skill-'));
    tempDirs.push(root);
    const skillDir = join(root, name);
    mkdirSync(skillDir, { recursive: true });
    const location = join(skillDir, 'SKILL.md');
    writeFileSync(location, skillMd(name, deps), 'utf8');
    return location;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is a no-op when no skill was invoked this turn', async () => {
    const listSkillsWithContent = vi.fn().mockResolvedValue([]);
    const ensureDeps = vi.fn();
    await ensureLazyDepsForTurn([], { listSkillsWithContent, ensureDeps });
    expect(listSkillsWithContent).not.toHaveBeenCalled();
    expect(ensureDeps).not.toHaveBeenCalled();
  });

  it('resolves the invoked skill by name and runs ensurePythonDependencies with its declared deps', async () => {
    const location = writeTempSkillMd('httpx-user', 'python_dependencies:\n  - package: "httpx"\n');
    const listSkillsWithContent = vi.fn().mockResolvedValue([
      {
        name: 'httpx-user',
        location,
        content: 'body',
      },
    ]);
    const ensureDeps = vi.fn().mockResolvedValue({ installed: ['httpx'], unavailable: [] });

    await ensureLazyDepsForTurn(['httpx-user'], { listSkillsWithContent, ensureDeps });

    expect(ensureDeps).toHaveBeenCalledTimes(1);
    expect(ensureDeps).toHaveBeenCalledWith('httpx-user', [{ package: 'httpx' }]);
  });

  it('skips ensurePythonDependencies for a skill with no declared dependencies', async () => {
    const listSkillsWithContent = vi.fn().mockResolvedValue([
      { name: 'plain-skill', location: '/skills/plain/SKILL.md', content: skillMd('plain-skill') },
    ]);
    const ensureDeps = vi.fn();

    await ensureLazyDepsForTurn(['plain-skill'], { listSkillsWithContent, ensureDeps });
    expect(ensureDeps).not.toHaveBeenCalled();
  });

  it('never throws when the engine lookup fails (non-fatal, must never break a turn)', async () => {
    const listSkillsWithContent = vi.fn().mockRejectedValue(new Error('engine down'));
    const ensureDeps = vi.fn();
    await expect(
      ensureLazyDepsForTurn(['httpx-user'], { listSkillsWithContent, ensureDeps }),
    ).resolves.toBeUndefined();
    expect(ensureDeps).not.toHaveBeenCalled();
  });

  it('a skill name invoked but not found in the live set is silently skipped', async () => {
    const listSkillsWithContent = vi.fn().mockResolvedValue([]);
    const ensureDeps = vi.fn();
    await ensureLazyDepsForTurn(['unknown-skill'], { listSkillsWithContent, ensureDeps });
    expect(ensureDeps).not.toHaveBeenCalled();
  });
});
