/// Parts-based chat model mirroring Opencode Desktop's `Message` + `Part`
/// shape (see /tmp/opencode-ref/packages/app/src/context/global-sync/types.ts).
///
/// Streaming text deltas mutate `ChatPart.text` in place, so the UI re-renders
/// the same bubble as content grows — no separate "live preview" widget.
class ChatMessage {
  ChatMessage({
    required this.id,
    required this.sessionId,
    required this.role,
    required this.createdAt,
  });

  final String id;
  final String sessionId;
  final String role; // 'user' | 'assistant'
  final DateTime createdAt;
}

class ChatPart {
  ChatPart({
    required this.id,
    required this.messageId,
    required this.type,
    String text = '',
  }) : _text = text;

  final String id;
  final String messageId;
  final String type; // 'text' | 'tool' | 'reasoning' | ...
  String _text;

  String get text => _text;
  set text(String v) => _text = v;
  void appendDelta(String delta) => _text = _text + delta;
}
