/// Regression: attachment MIME must not default to octet-stream for images.
///
/// file_picker on macOS often returns an empty `extension`, which made every
/// attachment fall through to application/octet-stream — opencode then rejects
/// the FilePart, so even images failed to send. resolveAttachmentMime falls
/// back to the filename extension and then to magic-byte sniffing.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/agents/views/_attachment_mime.dart';

const _png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00];
const _jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00];
const _gif = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

void main() {
  group('resolveAttachmentMime', () {
    test('uses the picker extension when present', () {
      expect(resolveAttachmentMime(_png, 'shot.png', 'png'), 'image/png');
    });

    test('falls back to the filename extension when picker ext is empty', () {
      // The exact macOS bug: picker returned '' for a real PNG.
      expect(
        resolveAttachmentMime(_png, 'Screenshot 2026.png', ''),
        'image/png',
      );
      expect(resolveAttachmentMime(_png, 'Screenshot 2026.png', null),
          'image/png');
    });

    test('sniffs image magic bytes when there is no usable extension', () {
      expect(resolveAttachmentMime(_png, 'pasted-image', ''), 'image/png');
      expect(resolveAttachmentMime(_jpeg, 'noext', null), 'image/jpeg');
      expect(resolveAttachmentMime(_gif, 'noext', ''), 'image/gif');
    });

    test('text/log files resolve to a readable text mime, not octet-stream',
        () {
      expect(resolveAttachmentMime([0x68, 0x69], 'server.log', 'log'),
          'text/plain');
      expect(resolveAttachmentMime([0x68, 0x69], 'notes.md', 'md'),
          'text/markdown');
    });

    test('genuinely unknown binary stays octet-stream', () {
      expect(
        resolveAttachmentMime([0x00, 0x01, 0x02], 'mystery', ''),
        'application/octet-stream',
      );
    });
  });
}
