/// Regression: attachment MIME must not default to octet-stream for images.
///
/// file_picker on macOS often returns an empty `extension`, which made every
/// attachment fall through to application/octet-stream — opencode then rejects
/// the FilePart, so even images failed to send. resolveAttachmentMime falls
/// back to the filename extension and then to magic-byte sniffing.
///
/// Issue #717: text-decodable files with unknown extensions resolve to
/// text/plain via UTF-8 probe (rather than application/octet-stream).
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/agents/views/_attachment_mime.dart';

const _png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00];
const _jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00];
const _gif = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

List<int> _utf8Bytes(String s) => utf8.encode(s);

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
      // Null bytes + non-UTF-8 sequences are not decodable → octet-stream.
      expect(
        resolveAttachmentMime([0x00, 0x01, 0x02, 0x80, 0x81], 'mystery', ''),
        'application/octet-stream',
      );
    });

    // Issue #717: UTF-8 probe for unknown-extension text files.
    test('unknown-ext UTF-8 decodable file resolves to text/plain', () {
      final bytes = _utf8Bytes('2026-06-01 ERROR: Connection refused\n');
      expect(resolveAttachmentMime(bytes, 'app-2026', ''), 'text/plain');
    });

    test('known source-code extensions resolve to text/plain', () {
      final bytes = _utf8Bytes('fn main() {}');
      expect(resolveAttachmentMime(bytes, 'main.rs', 'rs'), 'text/plain');
      expect(resolveAttachmentMime(bytes, 'lib.dart', 'dart'), 'text/plain');
      expect(resolveAttachmentMime(bytes, 'app.ts', 'ts'), 'text/plain');
      expect(resolveAttachmentMime(bytes, 'data.csv', 'csv'), 'text/csv');
      expect(resolveAttachmentMime(bytes, 'data.json', 'json'),
          'application/json');
    });

    // Issue #1137: Office docs classify to their real MIME, not octet-stream
    // (a zip-magic-byte body is realistic — docx/xlsx/pptx are zip archives).
    const zipMagic = [0x50, 0x4B, 0x03, 0x04];
    test('Office extensions resolve to their real MIME, not octet-stream', () {
      expect(
        resolveAttachmentMime(zipMagic, 'report.docx', 'docx'),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      expect(resolveAttachmentMime(zipMagic, 'legacy.doc', 'doc'),
          'application/msword');
      expect(
        resolveAttachmentMime(zipMagic, 'budget.xlsx', 'xlsx'),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(resolveAttachmentMime(zipMagic, 'legacy.xls', 'xls'),
          'application/vnd.ms-excel');
      expect(
        resolveAttachmentMime(zipMagic, 'deck.pptx', 'pptx'),
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      );
      expect(resolveAttachmentMime(zipMagic, 'legacy.ppt', 'ppt'),
          'application/vnd.ms-powerpoint');
    });
  });

  group('isSkillReadableBinaryMime', () {
    test('Office MIME types are skill-readable binaries', () {
      expect(
        isSkillReadableBinaryMime(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ),
        isTrue,
      );
      expect(isSkillReadableBinaryMime('application/msword'), isTrue);
      expect(
        isSkillReadableBinaryMime(
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ),
        isTrue,
      );
      expect(isSkillReadableBinaryMime('application/vnd.ms-excel'), isTrue);
      expect(
        isSkillReadableBinaryMime(
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ),
        isTrue,
      );
      expect(
          isSkillReadableBinaryMime('application/vnd.ms-powerpoint'), isTrue);
    });

    test('images, pdf, text, and octet-stream are NOT skill-readable binaries',
        () {
      expect(isSkillReadableBinaryMime('image/png'), isFalse);
      expect(isSkillReadableBinaryMime('application/pdf'), isFalse);
      expect(isSkillReadableBinaryMime('text/plain'), isFalse);
      expect(isSkillReadableBinaryMime('application/octet-stream'), isFalse);
    });
  });

  group('buildFileRefAttachment', () {
    test('builds a file: FilePart map for an Office document', () {
      final part = buildFileRefAttachment(
        mime:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: 'report.docx',
        absolutePath: '/tmp/report.docx',
      );
      expect(part['type'], 'file');
      expect(
        part['mime'],
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      expect(part['filename'], 'report.docx');
      // A `file:` URL, not a `data:` URI — this is the whole point (#1137):
      // the engine's Read tool + docx skill only fires on `file:` FileParts.
      expect(part['url'], 'file:///tmp/report.docx');
    });
  });

  group('isTextLikeMime', () {
    test('text/* variants are text-like', () {
      expect(isTextLikeMime('text/plain'), isTrue);
      expect(isTextLikeMime('text/markdown'), isTrue);
      expect(isTextLikeMime('text/csv'), isTrue);
      expect(isTextLikeMime('text/html'), isTrue);
    });

    test('application/json and application/xml are text-like', () {
      expect(isTextLikeMime('application/json'), isTrue);
      expect(isTextLikeMime('application/xml'), isTrue);
    });

    test('image/*, application/pdf, application/octet-stream are NOT text-like',
        () {
      expect(isTextLikeMime('image/png'), isFalse);
      expect(isTextLikeMime('image/jpeg'), isFalse);
      expect(isTextLikeMime('application/pdf'), isFalse);
      expect(isTextLikeMime('application/octet-stream'), isFalse);
      expect(isTextLikeMime('video/mp4'), isFalse);
    });
  });

  group('tryDecodeUtf8', () {
    test('decodes valid UTF-8 bytes correctly', () {
      const text = 'hello world\n';
      expect(tryDecodeUtf8(utf8.encode(text)), equals(text));
    });

    test('returns null for invalid UTF-8 (binary) bytes', () {
      // 0x80 alone is not valid UTF-8.
      expect(tryDecodeUtf8([0x80, 0x81, 0x82]), isNull);
    });

    test('returns null for null bytes that are not valid UTF-8 sequences', () {
      // Lone null byte is valid UTF-8 (U+0000), but [0xFE, 0xFF] is BOM / invalid.
      expect(tryDecodeUtf8([0xFE, 0xFF, 0x00]), isNull);
    });
  });
}
