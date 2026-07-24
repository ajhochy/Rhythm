/// MIME resolution for composer attachments (OPC-M4-1 / issue #717).
///
/// file_picker on macOS frequently returns an empty/null `extension`, which
/// made every attachment fall through to `application/octet-stream` — opencode
/// then rejects the FilePart ("media type application/octet-stream functionality
/// not supported"), so even images failed. We therefore resolve the MIME from
/// (1) the picker extension, (2) the filename, then (3) magic-byte sniffing for
/// common images, and (4) UTF-8 decodability for unknown-extension files, before
/// giving up.
///
/// Issue #717: text-like files (log, txt, md, source code, etc.) resolve to
/// text/plain (or a more specific text MIME) so the _pickFiles handler can
/// inline their content as a text part rather than a FilePart data URI that
/// the model rejects.
library;

import 'dart:convert';

const Map<String, String> _kMimeByExtension = {
  // images
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'svg': 'image/svg+xml',
  'bmp': 'image/bmp',
  'ico': 'image/x-icon',
  'tif': 'image/tiff',
  'tiff': 'image/tiff',
  'heic': 'image/heic',
  // docs
  'pdf': 'application/pdf',
  // text / code → text/plain so the model can read them
  'txt': 'text/plain',
  'log': 'text/plain',
  'md': 'text/markdown',
  'markdown': 'text/markdown',
  'csv': 'text/csv',
  'json': 'application/json',
  'xml': 'application/xml',
  'yaml': 'text/plain',
  'yml': 'text/plain',
  'ts': 'text/plain',
  'tsx': 'text/plain',
  'js': 'text/plain',
  'jsx': 'text/plain',
  'dart': 'text/plain',
  'py': 'text/plain',
  'sh': 'text/plain',
  'rb': 'text/plain',
  'go': 'text/plain',
  'rs': 'text/plain',
  'java': 'text/plain',
  'kt': 'text/plain',
  'swift': 'text/plain',
  'html': 'text/html',
  'css': 'text/plain',
  'sql': 'text/plain',
  'toml': 'text/plain',
  'ini': 'text/plain',
  'conf': 'text/plain',
  // other
  'zip': 'application/zip',
  'mp4': 'video/mp4',
  'mp3': 'audio/mpeg',
  'wav': 'audio/wav',
  // Office documents (issue #1137) — classify to their real MIME instead of
  // falling through to octet-stream. These are NOT sent as `data:` FileParts
  // (providers reject the MIME as unsupported media); see
  // [isSkillReadableBinaryMime] — the attach path routes them to a `file:`
  // reference instead so the engine's Read tool + docx/xlsx/pptx skill can
  // read the real bytes.
  'docx':
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'doc': 'application/msword',
  'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'xls': 'application/vnd.ms-excel',
  'pptx':
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'ppt': 'application/vnd.ms-powerpoint',
};

/// Office document MIME types (issue #1137). The model can't take these as a
/// native `data:` FilePart (media type rejected), but the engine's `file:`
/// FilePart branch runs the Read tool (which bypasses the cwd check for
/// FileParts) and the docx/xlsx/pptx skill extracts the text from there.
const Set<String> _kSkillReadableBinaryMimes = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
};

/// True when [mime] is a binary type the model can't read as a `data:`
/// FilePart, but that a skill (docx/xlsx/pptx) can read once the engine Reads
/// it from a real path. Attach these as a `file:` reference, not a data URI.
bool isSkillReadableBinaryMime(String mime) =>
    _kSkillReadableBinaryMimes.contains(mime);

/// Builds a `file:`-source FilePart map pointing at [absolutePath] (issue
/// #1137). The engine's prompt pipeline branches on the FilePart URL
/// protocol: `file:` runs the Read tool against the real path — the only
/// path that reaches the docx/xlsx/pptx skill — while `data:` is handed to
/// the model as a media part and rejected for Office MIME types.
Map<String, dynamic> buildFileRefAttachment({
  required String mime,
  required String filename,
  required String absolutePath,
}) =>
    {
      'type': 'file',
      'mime': mime,
      'filename': filename,
      'url': Uri.file(absolutePath).toString(),
    };

/// MIME from a bare extension (no dot, any case). Returns octet-stream when
/// unknown.
String mimeFromExtension(String ext) {
  final lower = ext.toLowerCase().replaceAll('.', '');
  return _kMimeByExtension[lower] ?? 'application/octet-stream';
}

/// Sniff common image formats by their magic bytes. Returns null when the
/// bytes don't match a known image signature.
String? sniffImageMime(List<int> b) {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b.length >= 8 &&
      b[0] == 0x89 &&
      b[1] == 0x50 &&
      b[2] == 0x4E &&
      b[3] == 0x47) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (b.length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) {
    return 'image/jpeg';
  }
  // GIF: "GIF8"
  if (b.length >= 4 &&
      b[0] == 0x47 &&
      b[1] == 0x49 &&
      b[2] == 0x46 &&
      b[3] == 0x38) {
    return 'image/gif';
  }
  // WEBP: "RIFF"...."WEBP"
  if (b.length >= 12 &&
      b[0] == 0x52 &&
      b[1] == 0x49 &&
      b[2] == 0x46 &&
      b[3] == 0x46 &&
      b[8] == 0x57 &&
      b[9] == 0x45 &&
      b[10] == 0x42 &&
      b[11] == 0x50) {
    return 'image/webp';
  }
  return null;
}

/// Returns true when [mime] is a text-renderable type that should be inlined
/// as a text part rather than a FilePart data URI.
///
/// Includes text/*, application/json, application/xml — types the model can
/// read as prose when embedded in the conversation text. Excludes application/pdf
/// because PDF is sent as a native FilePart (some providers support it).
bool isTextLikeMime(String mime) {
  if (mime.startsWith('text/')) return true;
  if (mime == 'application/json') return true;
  if (mime == 'application/xml') return true;
  return false;
}

/// Try to decode [bytes] as UTF-8. Returns the decoded string on success,
/// or null if the bytes are not valid UTF-8 (i.e. a binary file).
///
/// Uses a strict-mode codec so replacement characters are never silently
/// inserted; the FormatException path indicates a genuine binary.
String? tryDecodeUtf8(List<int> bytes) {
  try {
    // ignore: avoid_catching_errors
    return utf8.decode(bytes, allowMalformed: false);
  } catch (_) {
    return null;
  }
}

/// Resolve the best MIME for an attachment: picker extension → filename
/// extension → image magic-byte sniff → UTF-8 probe → octet-stream.
///
/// Issue #717: unknown-extension files that decode as valid UTF-8 resolve to
/// text/plain rather than application/octet-stream.
String resolveAttachmentMime(List<int> bytes, String filename, String? ext) {
  var e = (ext != null && ext.isNotEmpty) ? ext : '';
  if (e.isEmpty && filename.contains('.')) {
    e = filename.split('.').last;
  }
  final byExt = mimeFromExtension(e);
  if (byExt != 'application/octet-stream') return byExt;
  // Magic-byte image sniff.
  final imageMime = sniffImageMime(bytes);
  if (imageMime != null) return imageMime;
  // UTF-8 probe: if the bytes decode cleanly, treat as text/plain.
  if (tryDecodeUtf8(bytes) != null) return 'text/plain';
  return 'application/octet-stream';
}
