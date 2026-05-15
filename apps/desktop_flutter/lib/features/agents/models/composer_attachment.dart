/// Attachment chips above the composer's text field (M4-2).
///
/// When the user sends, the composer emits a `parts` array on the
/// `session.input` WS frame containing `{type:'text', text}` followed by
/// one part per attachment. M4-1 wires the backend side.
class ComposerAttachment {
  const ComposerAttachment({
    required this.type,
    required this.path,
    this.displayName,
  });

  /// 'file' for arbitrary paths; 'image' for image files.
  final String type;
  final String path;
  final String? displayName;

  Map<String, dynamic> toJson() => {
        'type': type,
        'filePath': path,
      };
}
