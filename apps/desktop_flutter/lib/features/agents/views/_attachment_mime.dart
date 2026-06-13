/// MIME resolution for composer attachments (OPC-M4-1).
///
/// file_picker on macOS frequently returns an empty/null `extension`, which
/// made every attachment fall through to `application/octet-stream` — opencode
/// then rejects the FilePart ("media type application/octet-stream functionality
/// not supported"), so even images failed. We therefore resolve the MIME from
/// (1) the picker extension, (2) the filename, then (3) magic-byte sniffing for
/// common images, before giving up.
library;

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

/// Resolve the best MIME for an attachment: picker extension → filename
/// extension → image magic-byte sniff → octet-stream.
String resolveAttachmentMime(List<int> bytes, String filename, String? ext) {
  var e = (ext != null && ext.isNotEmpty) ? ext : '';
  if (e.isEmpty && filename.contains('.')) {
    e = filename.split('.').last;
  }
  final byExt = mimeFromExtension(e);
  if (byExt != 'application/octet-stream') return byExt;
  return sniffImageMime(bytes) ?? byExt;
}
