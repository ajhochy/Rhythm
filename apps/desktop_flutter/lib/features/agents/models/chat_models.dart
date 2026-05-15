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

/// M3-2: discriminator string values mirroring the SDK's part `type` field.
///
/// `text` — assistant prose (current Rhythm renderer covers this).
/// `tool` — tool call (bash / read / edit / write / grep / glob / etc.);
///         payload lives in `toolName`, `toolArgs`, `toolOutput`, `toolStatus`.
/// `reasoning` — model thinking text; rendered as a dimmer collapsible block.
/// `step-start` / `step-finish` — turn boundaries; usually hidden from the UI
///         but kept on the part list so future inspectors can scrub by step.
class ChatPart {
  ChatPart({
    required this.id,
    required this.messageId,
    required this.type,
    String text = '',
    this.toolName,
    Map<String, dynamic>? toolArgs,
    String? toolOutput,
    String? toolStatus,
  })  : _text = text,
        _toolArgs = toolArgs,
        _toolOutput = toolOutput,
        _toolStatus = toolStatus;

  final String id;
  final String messageId;
  final String type;

  String _text;

  /// Tool-part fields. Null for non-tool parts.
  String? toolName;
  Map<String, dynamic>? _toolArgs;
  String? _toolOutput;
  String? _toolStatus;

  String get text => _text;
  set text(String v) => _text = v;
  void appendDelta(String delta) => _text = _text + delta;

  Map<String, dynamic>? get toolArgs => _toolArgs;
  set toolArgs(Map<String, dynamic>? v) => _toolArgs = v;

  String? get toolOutput => _toolOutput;
  set toolOutput(String? v) => _toolOutput = v;

  String? get toolStatus => _toolStatus;
  set toolStatus(String? v) => _toolStatus = v;

  /// Hydrate tool-specific fields from a raw `message.part.updated.part`
  /// payload forwarded by the api_server bridge. Safe to call repeatedly —
  /// field-level updates from `message.part.delta` events overwrite.
  void mergePart(Map<String, dynamic> raw) {
    if (raw['type'] == 'tool') {
      toolName = raw['tool'] as String?;
      final state = raw['state'] as Map<String, dynamic>?;
      if (state != null) {
        final input = state['input'];
        if (input is Map<String, dynamic>) toolArgs = input;
        final out = state['output'];
        if (out is String) toolOutput = out;
        toolStatus = state['status'] as String?;
      }
    } else if (raw['type'] == 'reasoning') {
      final t = raw['text'];
      if (t is String) text = t;
    } else if (raw['type'] == 'text') {
      final t = raw['text'];
      if (t is String) text = t;
    }
  }
}
