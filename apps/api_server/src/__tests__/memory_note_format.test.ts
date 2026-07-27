import { describe, expect, it } from 'vitest';

import {
  parseMemoryNote,
  renderMemoryNote,
  renderParsedMemoryNote,
} from '../services/memory_note_format';
import { parseNote } from '../services/memoryVaultSyncService';

describe('MEM-OKF #1187 shared memory-note format', () => {
  it('round-trips an untouched note byte-for-byte, including unknown nested keys', () => {
    const raw = [
      '---',
      'id: 01TEST',
      'kind: preference',
      'tags: [workflow, rhythm]',
      'created: 2026-07-01',
      'updated: 2026-07-02',
      'source: agent',
      'invented_scalar: keep-me',
      'invented_nested:',
      '  enabled: true',
      '  values:',
      '    - one',
      '    - two',
      '---',
      '',
      'Keep this body exactly.',
      '',
    ].join('\n');

    const parsed = parseMemoryNote(raw);
    expect(parsed.hasValidFrontmatter).toBe(true);
    expect(parsed.frontmatter.invented_nested).toEqual({
      enabled: true,
      values: ['one', 'two'],
    });
    expect(renderParsedMemoryNote(parsed)).toBe(raw);
  });

  it('preserves unknown keys when a known field and body are rewritten', () => {
    const raw = [
      '---',
      'id: 01TEST',
      'kind: fact',
      'tags: []',
      'created: 2026-07-01',
      'updated: 2026-07-01',
      'source: agent',
      'x_unknown:',
      '  nested: value',
      '---',
      'Old body.',
    ].join('\n');
    const parsed = parseMemoryNote(raw);
    const rewritten = renderParsedMemoryNote(parsed, {
      frontmatter: { updated: '2026-07-26' },
      body: 'New body.',
    });
    const reparsed = parseMemoryNote(rewritten);
    expect(reparsed.frontmatter.x_unknown).toEqual({ nested: 'value' });
    expect(reparsed.frontmatter.updated).toBeInstanceOf(Date);
    expect(reparsed.body).toBe('New body.');
  });

  it('parses the complete legacy corpus shape identically to the old public contract', () => {
    const corpus = [
      {
        raw: ['---', 'kind: person', 'tags: [staff, leadership]', '---', 'AJ leads.'].join('\n'),
        expected: { kind: 'person', tags: ['staff', 'leadership'], content: 'AJ leads.' },
      },
      {
        raw: ['---', 'kind: PREFERENCE', 'tags:', '  - workflow', '  - macOS', '---', 'Use Flutter.'].join('\n'),
        expected: { kind: 'preference', tags: ['workflow', 'macOS'], content: 'Use Flutter.' },
      },
      {
        raw: ['---', 'kind: unknown-future-kind', 'tags: []', '---', 'Fallback fact.'].join('\n'),
        expected: { kind: 'fact', tags: [], content: 'Fallback fact.' },
      },
      {
        raw: 'Plain markdown without frontmatter.',
        expected: { kind: 'fact', tags: [], content: 'Plain markdown without frontmatter.' },
      },
    ] as const;

    for (const fixture of corpus) {
      expect(parseNote(fixture.raw)).toEqual(fixture.expected);
    }
  });

  it.each([
    ['bad YAML', '---\nkind: [unterminated\n---\nbody'],
    ['missing frontmatter', 'plain body'],
    ['unterminated delimiter', '---\nkind: fact\nbody'],
    ['empty file', ''],
    ['non-map YAML', '---\n- one\n- two\n---\nbody'],
  ])('never throws for %s and degrades to the whole normalized file as body', (_name, raw) => {
    expect(() => parseMemoryNote(raw)).not.toThrow();
    const parsed = parseMemoryNote(raw);
    expect(parsed.hasValidFrontmatter).toBe(false);
    expect(parsed.kind).toBe('fact');
    expect(parsed.tags).toEqual([]);
    expect(parsed.body).toBe(raw.replace(/\r\n/g, '\n').trim());
  });

  it('normalizes CRLF for consumers while retaining exact original bytes for no-op render', () => {
    const raw = '---\r\nkind: context\r\ntags: [one]\r\n---\r\nBody.\r\n';
    const parsed = parseMemoryNote(raw);
    expect(parsed).toMatchObject({
      hasValidFrontmatter: true,
      kind: 'context',
      tags: ['one'],
      body: 'Body.',
    });
    expect(renderParsedMemoryNote(parsed)).toBe(raw);
  });

  it('uses js-yaml safe loading and never constructs JavaScript-specific tags', () => {
    const raw = [
      '---',
      'kind: fact',
      'danger: !!js/function >',
      '  function () { return process.env; }',
      '---',
      'Safe body.',
    ].join('\n');
    const parsed = parseMemoryNote(raw);
    expect(parsed.hasValidFrontmatter).toBe(false);
    expect(parsed.body).toBe(raw);
  });

  it('renders known keys deterministically before preserved unknown keys', () => {
    const rendered = renderMemoryNote(
      {
        z_unknown: 'last',
        source: 'agent',
        updated: '2026-07-02',
        created: '2026-07-01',
        tags: ['x'],
        kind: 'fact',
        id: '01TEST',
        a_unknown: 'also-preserved',
      },
      'Body.',
    );
    const keys = rendered
      .split('\n')
      .filter((line) => /^[a-z_]+:/.test(line))
      .map((line) => line.split(':')[0]);
    expect(keys).toEqual([
      'id',
      'kind',
      'tags',
      'created',
      'updated',
      'source',
      'z_unknown',
      'a_unknown',
    ]);
  });
});
