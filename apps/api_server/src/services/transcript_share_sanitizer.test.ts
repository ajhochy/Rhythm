import { describe, expect, it } from 'vitest';
import {
  sanitizeTranscriptShare,
  type TranscriptShareReview,
} from './transcript_share_sanitizer';

describe('transcript share sanitizer', () => {
  const protectedItems: TranscriptShareReview = {
    items: [
      { id: 'safe', category: 'message', content: 'ordinary reply' },
      { id: 'file', category: 'file_content', content: '/Users/staff/secret.txt' },
      { id: 'tool', category: 'tool_output', content: { result: 'private' } },
      { id: 'email', category: 'email', content: 'pastor@example.com' },
      { id: 'pco', category: 'pco_data', content: { personId: '123' } },
      { id: 'system', category: 'system_prompt', content: 'hidden instruction' },
      { id: 'secret', category: 'message', content: 'Authorization: Bearer abc.def.ghi' },
    ],
  };

  it.each([
    ['file contents', 'file'],
    ['tool outputs', 'tool'],
    ['emails', 'email'],
    ['PCO data', 'pco'],
    ['system prompts', 'system'],
    ['secret-pattern matches', 'secret'],
  ])('excludes %s by default', (_label, id) => {
    const snapshot = sanitizeTranscriptShare(protectedItems);
    expect(snapshot.items.map((item) => item.id)).not.toContain(id);
  });

  it('redacts secret patterns and host paths in explicitly included content', () => {
    const snapshot = sanitizeTranscriptShare(
      {
        items: [{
          id: 'included',
          category: 'tool_output',
          content: {
            authorization: 'Bearer abc.def.ghi',
            token: 'sk-test-12345678901234567890',
            path: '/Users/church/private/notes.txt',
          },
        }],
      },
      ['included'],
    );
    expect(JSON.stringify(snapshot)).not.toContain('abc.def.ghi');
    expect(JSON.stringify(snapshot)).not.toContain('sk-test');
    expect(JSON.stringify(snapshot)).not.toContain('/Users/church');
    expect(JSON.stringify(snapshot)).toContain('[REDACTED]');
  });

  it('honors explicit per-item inclusion for an excluded category', () => {
    const snapshot = sanitizeTranscriptShare(protectedItems, ['tool']);
    expect(snapshot.items).toContainEqual({
      id: 'tool',
      category: 'tool_output',
      content: { result: 'private' },
    });
  });

  it('produces a detached immutable snapshot when the source input is mutated', () => {
    const source: TranscriptShareReview = {
      items: [{ id: 'safe', category: 'message', content: { text: 'before' } }],
    };
    const storedJson = JSON.stringify(sanitizeTranscriptShare(source));
    (source.items[0].content as { text: string }).text = 'after';
    const reread = JSON.parse(storedJson) as TranscriptShareReview;
    expect(reread.items[0].content).toEqual({ text: 'before' });
  });
});
