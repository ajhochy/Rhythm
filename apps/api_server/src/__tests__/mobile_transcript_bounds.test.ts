import { describe, expect, it } from 'vitest';

import {
  boundMirrorTranscript,
  PART_BODY_LIMIT_BYTES,
} from '../services/mobile_transcript_bounds';
import { MOBILE_OPENCODE_RESPONSE_BODY_LIMIT_BYTES } from '../services/mobile_opencode_proxy';

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

const attachment = (id: string, size: number) => ({
  type: 'file',
  mime: 'image/png',
  url: `data:image/png;base64,${'A'.repeat(size)}`,
  id,
  sessionID: 'ses_test',
  messageID: 'msg_1',
});

const toolPart = (id: string, attachments: unknown[] = []) => ({
  id,
  messageID: 'msg_1',
  sessionID: 'ses_test',
  type: 'tool',
  callID: `call_${id}`,
  tool: 'read',
  state: { status: 'completed', input: {}, output: 'ok', title: 'read', metadata: {}, attachments },
});

const message = (id: string, parts: unknown[]) => ({ info: { id, sessionID: 'ses_test' }, parts });

describe('boundMirrorTranscript', () => {
  it('keeps a mirror-served page under the gateway response ceiling', () => {
    // Mirror pages bypass the engine, so they bypass its bound. Without this
    // one, mirrorResponse rejects the page with UPSTREAM_RESPONSE_TOO_LARGE
    // and the client seed is undeliverable — the same failure the engine
    // bound exists to prevent.
    const page = Array.from({ length: 20 }, (_, index) =>
      message(`msg_${index}`, [toolPart(`prt_${index}`, [attachment(`att_${index}`, 508 * 1024)])]),
    );
    expect(bytes(page)).toBeGreaterThan(MOBILE_OPENCODE_RESPONSE_BODY_LIMIT_BYTES);

    const bounded = boundMirrorTranscript(page);
    expect(bytes(bounded)).toBeLessThan(MOBILE_OPENCODE_RESPONSE_BODY_LIMIT_BYTES);
  });

  it('preserves part and attachment identity so deltas still attach', () => {
    const page = [message('msg_1', [toolPart('prt_1', [attachment('att_1', 508 * 1024)])])];
    const part = (boundMirrorTranscript(page)[0] as any).parts[0];
    expect(part.id).toBe('prt_1');
    expect(part.messageID).toBe('msg_1');
    expect(part.state.attachments[0].id).toBe('att_1');
    expect(part.state.attachments[0].mime).toBe('image/png');
    expect(part.state.attachments[0].url).toBe('');
    expect(part.metadata.truncated[0]).toMatchObject({
      field: 'attachments.att_1.url',
      keptLength: 0,
    });
  });

  it('trims oversized text bodies on a UTF-8 boundary', () => {
    const page = [
      message('msg_1', [
        { id: 'prt_1', messageID: 'msg_1', sessionID: 'ses_test', type: 'text', text: '😀'.repeat(20000) },
      ]),
    ];
    const text = (boundMirrorTranscript(page)[0] as any).parts[0].text as string;
    expect(text).not.toContain('�');
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(PART_BODY_LIMIT_BYTES);
  });

  it('returns a small page untouched', () => {
    const page = [message('msg_1', [toolPart('prt_1')])];
    expect(boundMirrorTranscript(page)).toBe(page);
  });
});
