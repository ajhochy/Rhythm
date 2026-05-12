import { describe, it, expect } from 'vitest';
import { TranscriptService, expandCursorMoves } from './transcript_service';

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

  // Bug 3: cursor-aware expansion
  it('expands cursor-right (ESC[nC) into spaces', () => {
    expect(strip('Accessing\x1b[1Cworkspace')).toBe('Accessing workspace');
  });

  it('expands cursor-column (ESC[nG) into leading spaces', () => {
    // ESC[10G = go to column 10 → 9 leading spaces before the word
    expect(strip('Hello\x1b[10Gworld')).toBe('Hello         world');
  });

  it('expands absolute cursor position (ESC[r;cH) into newline + indent', () => {
    // ESC[2;5H = row 2, col 5 → newline + 4 spaces
    expect(strip('A\x1b[2;5HB')).toBe('A\n    B');
  });
});

describe('expandCursorMoves', () => {
  it('converts cursor-right with no argument to single space', () => {
    expect(expandCursorMoves('a\x1b[Cb')).toBe('a b');
  });

  it('converts cursor-right with explicit count', () => {
    expect(expandCursorMoves('a\x1b[3Cb')).toBe('a   b');
  });

  it('converts cursor-column 1 to empty string (already at column 1)', () => {
    expect(expandCursorMoves('\x1b[1Ghello')).toBe('hello');
  });

  it('does not alter text without cursor sequences', () => {
    expect(expandCursorMoves('plain text')).toBe('plain text');
  });
});
