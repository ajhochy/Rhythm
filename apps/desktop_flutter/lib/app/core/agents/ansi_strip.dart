// Mirror of apps/api_server/src/services/transcript_service.ts cursor-aware
// ANSI scrubbing. Used by the live PTY view to render raw output the same way
// stored messages are rendered.

// Stage 1: cursor-positioning sequences → whitespace approximations.
final RegExp _cursorRight = RegExp(r'\x1b\[(\d*)C');
final RegExp _cursorColumn = RegExp(r'\x1b\[(\d+)G');
final RegExp _cursorPos = RegExp(r'\x1b\[(\d+);(\d+)H');

// Stage 2: strip remaining CSI / OSC / single-char ESC sequences.
final RegExp _ansi = RegExp(
  r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\].*?(?:\x07|\x1b\\)|\x1b.',
);

String _expandCursorMoves(String raw) {
  return raw.replaceAllMapped(_cursorRight, (m) {
    final n = int.tryParse(m.group(1) ?? '') ?? 1;
    return ' ' * (n < 1 ? 1 : n);
  }).replaceAllMapped(_cursorColumn, (m) {
    final n = int.parse(m.group(1)!);
    return ' ' * (n < 1 ? 0 : n - 1);
  }).replaceAllMapped(_cursorPos, (m) {
    final c = int.parse(m.group(2)!);
    return '\n' + ' ' * (c < 1 ? 0 : c - 1);
  });
}

String stripAnsi(String raw) => _expandCursorMoves(raw).replaceAll(_ansi, '');
