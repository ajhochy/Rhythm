import { describe, expect, it, vi } from 'vitest';

import {
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
});
