import { describe, it, expect } from 'vitest';
import { TranscriptService } from './transcript_service';

const svc = new TranscriptService();
const strip = (s: string) => svc.stripAnsi(s);

describe('TranscriptService.stripAnsi', () => {
  it('passes through plain text unchanged', () => {
    expect(strip('Hello, world!')).toBe('Hello, world!');
  });

  it('removes basic SGR reset sequence', () => {
    expect(strip('\x1b[0mHello\x1b[0m')).toBe('Hello');
  });

  it('removes complex SGR sequences (bold, colour, underline)', () => {
    // Bold + red foreground text then reset
    expect(strip('\x1b[1;31mError\x1b[0m: something went wrong')).toBe(
      'Error: something went wrong',
    );
  });

  it('removes cursor-movement CSI sequences', () => {
    // Cursor up 3 lines + column 1
    expect(strip('\x1b[3A\x1b[1GHello')).toBe('Hello');
  });

  it('removes OSC sequences (e.g. terminal title set) terminated by BEL', () => {
    expect(strip('\x1b]0;My Terminal Title\x07visible text')).toBe('visible text');
  });

  it('removes OSC sequences terminated by ST (ESC \\)', () => {
    expect(strip('\x1b]2;tab title\x1b\\visible text')).toBe('visible text');
  });

  it('removes mixed ANSI and OSC in a realistic terminal line', () => {
    const raw =
      '\x1b]0;~/projects\x07' + // OSC title
      '\x1b[32m$\x1b[0m ' + // green $ prompt then reset
      'npm run build' + // command
      '\x1b[?25l'; // hide cursor
    expect(strip(raw)).toBe('$ npm run build');
  });

  it('removes lone ESC + single char sequences', () => {
    expect(strip('\x1b=hello')).toBe('hello');
    expect(strip('before\x1b7after')).toBe('beforeafter');
  });

  it('handles empty string', () => {
    expect(strip('')).toBe('');
  });

  it('handles string with no escape sequences', () => {
    const plain = 'Line 1\nLine 2\nLine 3';
    expect(strip(plain)).toBe(plain);
  });
});
