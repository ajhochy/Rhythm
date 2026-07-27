import { describe, expect, it, vi } from 'vitest';

import {
  MemoryAttributionMergeError,
  mergeAttributedMemoryContent,
} from '../services/memory_similarity';
import { validateNoteSources } from '../services/memory_note_format';
import { logger } from '../utils/logger';

describe('attribution-aware memory merging (#1193)', () => {
  it('unions three source sets, preserves survivor metadata, and widens usage', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const first = mergeAttributedMemoryContent(
      {
        body: 'Claim A.[^A]',
        sources: [
          {
            id: 'A',
            resource: 'https://example.test/a',
            title: 'Survivor title',
          },
        ],
        usageWindow: {
          from: '2026-03-01',
          to: '2026-04-15',
          calendar: 'service-local',
        },
      },
      {
        body: 'Claim B.[^B]',
        sources: [
          {
            id: 'A',
            resource: 'https://example.test/a',
            title: 'Incoming title',
          },
          { id: 'B', resource: 'https://example.test/b' },
        ],
        usageWindow: {
          from: '2026-02-01',
          to: '2026-04-01',
          precision: 'day',
        },
      },
    );
    const merged = mergeAttributedMemoryContent(
      first,
      {
        body: 'Claim C.[^C]\n\nThis claim has no attribution.',
        sources: [{ id: 'C', resource: 'https://example.test/c' }],
        usageWindow: { from: '2026-05-01', to: '2026-06-01' },
      },
    );

    expect(merged.sources).toEqual([
      {
        id: 'A',
        resource: 'https://example.test/a',
        title: 'Survivor title',
      },
      { id: 'B', resource: 'https://example.test/b' },
      { id: 'C', resource: 'https://example.test/c' },
    ]);
    expect(merged.usageWindow).toEqual({
      from: '2026-02-01',
      to: '2026-06-01',
      calendar: 'service-local',
      precision: 'day',
    });
    expect(merged.body).toContain('This claim has no attribution.');
    expect(merged.body).not.toContain('This claim has no attribution.[^');
    expect(validateNoteSources(merged)).toEqual({
      danglingFootnoteReferences: [],
      unreferencedSourceIds: [],
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('source metadata conflict for A'),
    );
    warn.mockRestore();
  });

  it('rekeys a resource collision without cascading through reserved ids', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const merged = mergeAttributedMemoryContent(
      {
        body: 'Survivor claim.[^X]',
        sources: [
          { id: 'X', resource: 'https://example.test/survivor' },
          { id: 'X-2', resource: 'https://example.test/already-reserved' },
        ],
      },
      {
        body: 'Incoming claim.[^X]\n\nExisting incoming id.[^X-2]',
        sources: [
          { id: 'X', resource: 'https://example.test/incoming' },
          { id: 'X-2', resource: 'https://example.test/already-reserved' },
        ],
      },
    );

    expect(merged.sources).toEqual([
      { id: 'X', resource: 'https://example.test/survivor' },
      { id: 'X-2', resource: 'https://example.test/already-reserved' },
      { id: 'X-3', resource: 'https://example.test/incoming' },
    ]);
    expect(merged.body).toContain('Survivor claim.[^X]');
    expect(merged.body).toContain('Incoming claim.[^X-3]');
    expect(merged.body).toContain('Existing incoming id.[^X-2]');
    expect(validateNoteSources(merged).danglingFootnoteReferences).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('rekeyed incoming X as X-3'),
    );
    warn.mockRestore();
  });

  it('rejects each dangling side before union can accidentally bind it', () => {
    expect(() => mergeAttributedMemoryContent(
      {
        body: 'Dangling survivor.[^X]',
        sources: [],
      },
      {
        body: 'Incoming claim.',
        sources: [{ id: 'X', resource: 'https://example.test/incoming' }],
      },
    )).toThrow(MemoryAttributionMergeError);
    expect(() => mergeAttributedMemoryContent(
      {
        body: 'Survivor claim.',
        sources: [{ id: 'X', resource: 'https://example.test/survivor' }],
      },
      {
        body: 'Dangling incoming.[^X]',
        sources: [],
      },
    )).toThrow(MemoryAttributionMergeError);
  });

  it('treats present-versus-missing resources as collisions in both directions', () => {
    const presentIncoming = mergeAttributedMemoryContent(
      {
        body: 'Survivor.[^X]',
        sources: [{ id: 'X' }],
      },
      {
        body: 'Incoming.[^X]',
        sources: [{ id: 'X', resource: 'https://example.test/incoming' }],
      },
    );
    expect(presentIncoming.sources).toEqual([
      { id: 'X' },
      { id: 'X-2', resource: 'https://example.test/incoming' },
    ]);
    expect(presentIncoming.body).toContain('Incoming.[^X-2]');

    const missingIncoming = mergeAttributedMemoryContent(
      {
        body: 'Survivor.[^X]',
        sources: [{ id: 'X', resource: 'https://example.test/survivor' }],
      },
      {
        body: 'Incoming.[^X]',
        sources: [{ id: 'X' }],
      },
    );
    expect(missingIncoming.sources).toEqual([
      { id: 'X', resource: 'https://example.test/survivor' },
      { id: 'X-2' },
    ]);
    expect(missingIncoming.body).toContain('Incoming.[^X-2]');
  });

  it('dedupes two absent resources but keeps different ids for one resource', () => {
    const merged = mergeAttributedMemoryContent(
      {
        body: 'Survivor.[^X]',
        sources: [{ id: 'X', title: 'Survivor metadata' }],
      },
      {
        body: 'Incoming.[^X] Other.[^Y]',
        sources: [
          { id: 'X', title: 'Incoming metadata' },
          { id: 'Y', resource: 'https://example.test/shared' },
        ],
      },
    );
    const withSameResource = mergeAttributedMemoryContent(
      merged,
      {
        body: 'Third.[^Z]',
        sources: [{ id: 'Z', resource: 'https://example.test/shared' }],
      },
    );

    expect(withSameResource.sources).toEqual([
      { id: 'X', title: 'Survivor metadata' },
      { id: 'Y', resource: 'https://example.test/shared' },
      { id: 'Z', resource: 'https://example.test/shared' },
    ]);
  });

  it('rewrites exact markers and definitions once without touching prefixes or links', () => {
    const merged = mergeAttributedMemoryContent(
      {
        body: 'Survivor.[^X]',
        sources: [{ id: 'X', resource: 'https://example.test/survivor' }],
      },
      {
        body: [
          'Incoming.[^X] Repeated.[^X] Prefix.[^Xlong]',
          '[^X]: incoming citation',
          '[ordinary X](https://example.test/X)',
        ].join('\n'),
        sources: [
          { id: 'X', resource: 'https://example.test/incoming' },
          { id: 'Xlong', resource: 'https://example.test/prefix' },
        ],
      },
    );

    expect(merged.body).toContain('Incoming.[^X-2] Repeated.[^X-2]');
    expect(merged.body).toContain('Prefix.[^Xlong]');
    expect(merged.body).toContain('[^X-2]: incoming citation');
    expect(merged.body).toContain(
      '[ordinary X](https://example.test/X)',
    );
    expect(merged.body).toContain('Survivor.[^X]');
  });

  it('keeps a colliding unreferenced source without inventing a marker', () => {
    const merged = mergeAttributedMemoryContent(
      {
        body: 'Survivor.[^X]',
        sources: [{ id: 'X', resource: 'https://example.test/survivor' }],
      },
      {
        body: 'Incoming claim has no citation.',
        sources: [{ id: 'X', resource: 'https://example.test/incoming' }],
      },
    );

    expect(merged.sources[1]).toEqual({
      id: 'X-2',
      resource: 'https://example.test/incoming',
    });
    expect(merged.body).not.toContain('[^X-2]');
    expect(validateNoteSources(merged).unreferencedSourceIds).toContain('X-2');
  });

  it('rejects invalid source ids and reversed usage windows', () => {
    expect(() => mergeAttributedMemoryContent(
      { body: 'Survivor.', sources: [] },
      {
        body: 'Incoming.',
        sources: [{ id: 'bad.id', resource: 'https://example.test' }],
      },
    )).toThrow(/invalid source id/);
    expect(() => mergeAttributedMemoryContent(
      { body: 'Survivor.', sources: [] },
      {
        body: 'Incoming.',
        sources: [],
        usageWindow: { from: '2026-07-26', to: '2026-07-01' },
      },
    )).toThrow(/reversed usage window/);
  });
});
