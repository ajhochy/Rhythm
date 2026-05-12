import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/agents/ansi_strip.dart';

void main() {
  group('stripAnsi', () {
    test('removes standard SGR color codes', () {
      expect(stripAnsi('Hello\x1b[31m red\x1b[0m'), 'Hello red');
    });

    test('expands cursor-right (ESC[1C) to a space', () {
      expect(stripAnsi('Accessing\x1b[1Cworkspace'), 'Accessing workspace');
    });

    test('expands cursor-column (ESC[10G) to 9 leading spaces', () {
      // Column 10 means 9 spaces of padding before the word.
      expect(stripAnsi('Hello\x1b[10Gworld'), 'Hello         world');
    });

    test('expands absolute position (ESC[2;5H) to newline + 4 spaces', () {
      expect(stripAnsi('A\x1b[2;5HB'), 'A\n    B');
    });

    test('preserves runs of spaces in plain text', () {
      const plain = 'plain text  with  spaces';
      expect(stripAnsi(plain), plain);
    });

    test('removes erase-in-line (ESC[K)', () {
      expect(stripAnsi('before\x1b[Kafter'), 'beforeafter');
    });

    test('removes OSC title sequences terminated by BEL', () {
      expect(stripAnsi('\x1b]0;title\x07visible'), 'visible');
    });

    test('returns empty string unchanged', () {
      expect(stripAnsi(''), '');
    });
  });
}
