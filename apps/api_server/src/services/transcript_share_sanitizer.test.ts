import { describe, expect, it } from 'vitest';
import {
  deriveTranscriptShareReview,
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

  it('derives protected categories from persisted roles, part types, tools, and flags', () => {
    const review = deriveTranscriptShareReview([
      {
        id: 1,
        role: 'system',
        rawText: '',
        parts: [{ id: 'system', type: 'text', text: 'hidden' }],
      },
      {
        id: 2,
        role: 'output',
        rawText: '',
        parts: [
          { id: 'tool', type: 'tool', tool: 'read', state: { output: 'private' } },
          { id: 'email', type: 'tool', tool: 'gmail_search' },
          { id: 'pco', type: 'tool', tool: 'pco_people_search' },
          { id: 'attachment', type: 'text', attachment: true, text: 'upload' },
          { id: 'file', type: 'file_content', fileContent: 'contents' },
        ],
      },
    ]);
    expect(review.items.map(({ id, category }) => ({ id, category }))).toEqual([
      { id: 'system', category: 'system_prompt' },
      { id: 'tool', category: 'tool_output' },
      { id: 'email', category: 'email' },
      { id: 'pco', category: 'pco_data' },
      { id: 'attachment', category: 'attachment' },
      { id: 'file', category: 'file_content' },
    ]);
  });

  it.each([
    ['PEM block', '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----', 'secret'],
    ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature', 'eyJhbGci'],
    ['AWS AKIA key', 'AKIAIOSFODNN7EXAMPLE', 'AKIA'],
    ['AWS ASIA key', 'ASIAIOSFODNN7EXAMPLE', 'ASIA'],
    ['Google API key', 'AIzaSyA12345678901234567890123456789012', 'AIza'],
    ['Set-Cookie', 'Set-Cookie: session=very-private-value; HttpOnly', 'very-private'],
    ['session cookie', 'session=very-private-value', 'very-private'],
    ['Postgres URL', 'postgres://user:pass@db.example/app', 'user:pass'],
    ['MySQL URL', 'mysql://user:pass@db.example/app', 'user:pass'],
    ['Mongo URL', 'mongodb://user:pass@db.example/app', 'user:pass'],
    ['Bearer header', 'Authorization: Bearer opaque-access-value', 'opaque-access'],
    ['macOS path', '/Users/alice/private/file.txt', '/Users/alice'],
    ['Linux path', '/home/alice/private/file.txt', '/home/alice'],
  ])('redacts %s', (_label, secret, forbiddenSubstring) => {
    const snapshot = sanitizeTranscriptShare({
      items: [{ id: 'part-1', category: 'tool_output', content: secret }],
    }, ['part-1']);
    const json = JSON.stringify(snapshot);
    expect(json).not.toContain(forbiddenSubstring);
    expect(json).toContain('[REDACTED]');
  });
});
