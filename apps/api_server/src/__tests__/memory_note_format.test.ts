import { describe, expect, it } from 'vitest';

import {
  formatActor,
  isActive,
  isStale,
  memorySources,
  mergeLifecycleMetadata,
  parseMemoryNote,
  parseActor,
  renderMemoryNote,
  renderParsedMemoryNote,
  trustTier,
  validateNoteSources,
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
    expect(reparsed.frontmatter.updated).toBe('2026-07-26');
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
      expect(parseNote(fixture.raw)).toMatchObject(fixture.expected);
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

  it('preserves YAML aliases as bounded references instead of expanding them', () => {
    const aliases = ['node0: &node0 [leaf, leaf]'];
    for (let level = 1; level <= 14; level += 1) {
      aliases.push(
        `node${level}: &node${level} [*node${level - 1}, *node${level - 1}]`,
      );
    }
    const raw = [
      '---',
      'kind: fact',
      ...aliases,
      'payload: *node14',
      '---',
      'Alias amplification guard.',
    ].join('\n');

    const rendered = renderParsedMemoryNote(parseMemoryNote(raw), {
      frontmatter: { updated: '2026-07-26' },
    });

    expect(rendered.length).toBeLessThan(4_096);
    expect(rendered).toMatch(/&ref_\d+/);
    expect(rendered).toMatch(/\*ref_\d+/);
    expect(parseMemoryNote(rendered).body).toBe('Alias amplification guard.');
  });

  it('preserves a literal __proto__ frontmatter key during mutation', () => {
    const raw = [
      '---',
      'kind: fact',
      '__proto__:',
      '  future: retained',
      '---',
      'Prototype-key guard.',
    ].join('\n');
    const parsed = parseMemoryNote(raw);
    expect(Object.prototype.hasOwnProperty.call(
      parsed.frontmatter,
      '__proto__',
    )).toBe(true);

    const reparsed = parseMemoryNote(renderParsedMemoryNote(parsed, {
      frontmatter: { updated: '2026-07-26' },
    }));
    expect(reparsed.frontmatter.__proto__).toEqual({
      future: 'retained',
    });
  });

  it('accepts safe default-schema timestamps without degrading the note', () => {
    const raw = [
      '---',
      'kind: fact',
      'future_timestamp: !!timestamp 2026-07-26T10:05:00Z',
      '---',
      'Default-schema timestamp.',
    ].join('\n');

    const parsed = parseMemoryNote(raw);
    expect(parsed.hasValidFrontmatter).toBe(true);
    expect(parsed.frontmatter.future_timestamp).toBeInstanceOf(Date);
    expect(parsed.body).toBe('Default-schema timestamp.');

    const reparsed = parseMemoryNote(renderParsedMemoryNote(parsed, {
      frontmatter: { updated: '2026-07-26' },
    }));
    expect(reparsed.hasValidFrontmatter).toBe(true);
    expect(reparsed.frontmatter.future_timestamp).toBeInstanceOf(Date);
  });

  it('#1192: round-trips sources and usage_window with partial entries', () => {
    const raw = [
      '---',
      'kind: fact',
      'sources:',
      '  - id: sess-01J8X',
      '    resource: rhythm://agent-session/01J8X',
      '    title: Staff sync conversation',
      '    author: human:ajh@example.com',
      '    last_modified: 2026-07-20',
      '  - id: email-1',
      'usage_window: { from: 2026-07-01, to: 2026-07-26 }',
      '---',
      'Second service moved to 10:45.[^sess-01J8X]',
    ].join('\n');

    const parsed = parseMemoryNote(raw);
    expect(parsed.sources).toEqual([
      {
        id: 'sess-01J8X',
        resource: 'rhythm://agent-session/01J8X',
        title: 'Staff sync conversation',
        author: 'human:ajh@example.com',
        last_modified: '2026-07-20',
      },
      { id: 'email-1' },
    ]);
    expect(parsed.usageWindow).toEqual({
      from: '2026-07-01',
      to: '2026-07-26',
    });
    expect(renderParsedMemoryNote(parsed)).toBe(raw);

    const reparsed = parseMemoryNote(renderParsedMemoryNote(parsed, {
      frontmatter: { updated: '2026-07-26' },
    }));
    expect(reparsed.sources).toEqual(parsed.sources);
    expect(reparsed.usageWindow).toEqual(parsed.usageWindow);
    expect(reparsed.body).toContain('[^sess-01J8X]');
  });

  it('#1192: drops missing ids, keeps first duplicate, and reports link gaps', () => {
    const parsed = parseMemoryNote([
      '---',
      'kind: fact',
      'sources:',
      '  - { title: Missing id }',
      '  - { id: first, title: First wins }',
      '  - { id: first, title: Duplicate loses }',
      '  - { id: unused }',
      '---',
      'Declared link.[^first] Broken link.[^dangling] Again.[^dangling]',
    ].join('\n'));

    expect(parsed.sources).toEqual([
      { id: 'first', title: 'First wins' },
      { id: 'unused' },
    ]);
    expect(memorySources(parsed.frontmatter)).toEqual(parsed.sources);
    expect(validateNoteSources(parsed)).toEqual({
      danglingFootnoteReferences: ['dangling'],
      unreferencedSourceIds: ['unused'],
    });
    expect(parsed.hasValidFrontmatter).toBe(true);
  });

  it('#1192: leaves a legacy note without sources byte-identical', () => {
    const raw = '---\nkind: fact\ntags: []\n---\nLegacy fact.\n';
    const parsed = parseMemoryNote(raw);
    expect(parsed.sources).toEqual([]);
    expect(parsed.usageWindow).toBeUndefined();
    expect(renderParsedMemoryNote(parsed)).toBe(raw);
  });
});

describe('MEM-OKF #1188 lifecycle and trust metadata', () => {
  it('round-trips all lifecycle fields and normalizes their consumer view', () => {
    const raw = [
      '---',
      'id: 01TEST',
      'kind: context',
      'tags: []',
      'created: 2026-07-01',
      'updated: 2026-07-26',
      'source: agent',
      'status: draft',
      'stale_after: 2026-09-01',
      'generated: { by: \"agent:rhythm/1\", at: 2026-07-26T10:00:00Z }',
      'verified:',
      '  - { by: \"agent:reviewer/2\", at: 2026-07-26T10:03:00Z }',
      '  - { by: \"human:ajh@example.com\", at: 2026-07-26T10:05:00Z }',
      '---',
      'Seasonal staffing context.',
      '',
    ].join('\n');

    const parsed = parseMemoryNote(raw);
    expect(parsed).toMatchObject({
      status: 'draft',
      staleAfter: '2026-09-01',
      generated: {
        by: 'agent:rhythm/1',
        at: '2026-07-26T10:00:00.000Z',
      },
      verified: [
        {
          by: 'agent:reviewer/2',
          at: '2026-07-26T10:03:00.000Z',
        },
        {
          by: 'human:ajh@example.com',
          at: '2026-07-26T10:05:00.000Z',
        },
      ],
    });
    expect(renderParsedMemoryNote(parsed)).toBe(raw);
  });

  it('treats legacy notes as stable, unverified, never stale, and leaves bytes unchanged', () => {
    const raw = '---\nkind: fact\ntags: []\n---\nLegacy fact.\n';
    const parsed = parseMemoryNote(raw);
    expect(parsed.status).toBe('stable');
    expect(parsed.staleAfter).toBeUndefined();
    expect(parsed.verified).toEqual([]);
    expect(trustTier(parsed.frontmatter)).toBe('unverified');
    expect(isStale(parsed.frontmatter, '2099-01-01')).toBe(false);
    expect(isActive(parsed.frontmatter, '2099-01-01')).toBe(true);
    expect(renderParsedMemoryNote(parsed)).toBe(raw);
  });

  it('fails open for unknown status and malformed stale_after', () => {
    const parsed = parseMemoryNote(
      '---\nstatus: experimental\nstale_after: 2026-99-99\n---\nKeep it active.',
    );
    expect(parsed.status).toBe('stable');
    expect(parsed.staleAfter).toBeUndefined();
    expect(isStale(parsed.frontmatter, '2099-01-01')).toBe(false);
    expect(isActive(parsed.frontmatter, '2099-01-01')).toBe(true);
  });

  it.each([
    [undefined, 'unverified'],
    [[], 'unverified'],
    [[{ by: 'agent:reviewer/2', at: '2026-07-26T10:00:00Z' }], 'machine'],
    [[{ by: 'process:import', at: '2026-07-26T10:00:00Z' }], 'machine'],
    [[{ by: 'human:ajh', at: '2026-07-26T10:00:00Z' }], 'human'],
    [[
      { by: 'agent:reviewer/2', at: '2026-07-26T10:00:00Z' },
      { by: 'human:ajh', at: '2026-07-26T10:01:00Z' },
    ], 'human'],
  ])('derives trust tier %#', (verified, expected) => {
    expect(trustTier({ verified })).toBe(expected);
  });

  it('marks the stale_after boundary itself stale and excludes deprecated notes', () => {
    const fm = { status: 'stable', stale_after: '2026-09-01' };
    expect(isStale(fm, '2026-08-31')).toBe(false);
    expect(isStale(fm, '2026-09-01')).toBe(true);
    expect(isActive(fm, '2026-09-01')).toBe(false);
    expect(isActive({ status: 'deprecated' }, '2026-08-31')).toBe(false);
  });

  it('formats and parses actor strings centrally', () => {
    expect(formatActor({ kind: 'agent', id: 'rhythm', version: '1' }))
      .toBe('agent:rhythm/1');
    expect(formatActor({ kind: 'human', id: 'ajh@example.com' }))
      .toBe('human:ajh@example.com');
    expect(formatActor({ kind: 'process', id: 'consolidation' }))
      .toBe('process:consolidation');
    expect(parseActor('agent:rhythm/1')).toEqual({
      kind: 'agent',
      id: 'rhythm',
      version: '1',
    });
    expect(parseActor('human:ajh@example.com')).toEqual({
      kind: 'human',
      id: 'ajh@example.com',
    });
    expect(parseActor('unknown:actor')).toBeNull();
  });

  it('merges conservative status, earliest expiry, and verification union', () => {
    expect(mergeLifecycleMetadata([
      {
        status: 'deprecated',
        stale_after: '2026-10-01',
        verified: [
          {
            by: 'agent:reviewer/2',
            at: '2026-07-26T10:00:00Z',
            evidence: { source: 'review-run-1' },
          },
        ],
      },
      {
        status: 'draft',
        stale_after: '2026-09-01',
        verified: [
          { by: 'agent:reviewer/2', at: '2026-07-26T10:00:00Z' },
          { by: 'human:ajh', at: '2026-07-26T11:00:00Z' },
        ],
      },
    ])).toEqual({
      status: 'draft',
      stale_after: '2026-09-01',
      verified: [
        {
          by: 'agent:reviewer/2',
          at: '2026-07-26T10:00:00.000Z',
          evidence: { source: 'review-run-1' },
        },
        {
          by: 'human:ajh',
          at: '2026-07-26T11:00:00.000Z',
        },
      ],
    });
    expect(mergeLifecycleMetadata([
      { status: 'deprecated' },
      { status: 'deprecated' },
    ]).status).toBe('deprecated');
    expect(mergeLifecycleMetadata([
      { status: 'stable' },
      { status: 'draft' },
    ]).status).toBe('draft');
  });
});
