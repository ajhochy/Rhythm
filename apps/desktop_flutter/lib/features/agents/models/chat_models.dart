// OPC-M4-4 — Agent descriptor returned by GET /agent-sessions/agents.
class AgentInfo {
  const AgentInfo({
    required this.name,
    required this.builtIn,
    this.description,
    this.mode,
  });

  final String name;
  final bool builtIn;
  final String? description;
  final String? mode;

  factory AgentInfo.fromJson(Map<String, dynamic> json) => AgentInfo(
        name: (json['name'] as String?) ?? '',
        builtIn: (json['builtIn'] as bool?) ?? false,
        description: json['description'] as String?,
        mode: json['mode'] as String?,
      );
}

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
    this.cost,
    this.tokens,
    this.isReverted = false,
  });

  final String id;
  final String sessionId;
  final String role; // 'user' | 'assistant' | 'system'
  final DateTime createdAt;

  /// OPC-M2-4: message cost in USD (null for user / legacy rows).
  double? cost;

  /// OPC-M2-4: token usage map (null for user / legacy rows).
  /// Keys: 'input', 'output', 'reasoning', 'cache'.
  Map<String, dynamic>? tokens;

  /// OPC-M3-2: true when this message has been reverted (undone) by the user.
  /// Reverted messages render dimmed with a "reverted" badge.
  bool isReverted;

  /// OPC-M1-3: construct a [ChatMessage] from a structured REST row.
  ///
  /// The [id] field accepts either a string (sdkMessageId) or an integer
  /// (legacy db id), so we coerce it to string safely.
  factory ChatMessage.fromJson(Map<String, dynamic> json) {
    final rawId = json['sdkMessageId'] ?? json['id'];
    return ChatMessage(
      id: rawId?.toString() ?? '',
      sessionId: (json['sessionId'] as String?) ?? '',
      role: (json['role'] as String?) ?? 'output',
      createdAt: _parseDateTime(json['createdAt']) ?? DateTime.now(),
    );
  }
}

DateTime? _parseDateTime(dynamic value) {
  if (value == null) return null;
  final s = value as String?;
  if (s == null || s.isEmpty) return null;
  return DateTime.tryParse(s);
}

/// M3-2: discriminator string values mirroring the SDK's part `type` field.
///
/// `text` — assistant prose (current Rhythm renderer covers this).
/// `tool` — tool call (bash / read / edit / write / grep / glob / etc.);
///         payload lives in `toolName`, `toolArgs`, `toolOutput`, `toolStatus`.
/// `reasoning` — model thinking text; rendered as a dimmer collapsible block.
/// `step-start` / `step-finish` — turn boundaries; usually hidden from the UI
///         but kept on the part list so future inspectors can scrub by step.
/// `compaction` — OPC-M3-3: emitted after a summarize call; rendered as a
///         horizontal divider labeled "Conversation compacted" with the summary
///         text (stored in [ChatPart.text]) expandable on demand.
/// `file` — OPC-M4-1: a file or image attachment sent by the user. The data
///         URI is stored in [fileUrl], MIME type in [fileMime], and original
///         filename in [fileFilename].
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
    this.durationMs,
    this.fileMime,
    this.fileFilename,
    this.fileUrl,
    this.agentName,
  })  : _text = text,
        _toolArgs = toolArgs,
        _toolOutput = toolOutput,
        _toolStatus = toolStatus;

  final String id;
  final String messageId;
  final String type;

  String _text;

  /// OPC-M2-2: Duration in milliseconds for a finished reasoning part.
  /// Populated from the part's `time.end - time.start` when `time.end` is
  /// present (reasoning part from step-finish). Null while streaming.
  int? durationMs;

  /// Tool-part fields. Null for non-tool parts.
  String? toolName;
  Map<String, dynamic>? _toolArgs;
  String? _toolOutput;
  String? _toolStatus;

  /// OPC-M4-1: File-part fields. Non-null when [type] == 'file'.
  /// [fileMime] — MIME type, e.g. 'image/png', 'application/pdf'.
  /// [fileFilename] — original filename, e.g. 'photo.png'.
  /// [fileUrl] — data URI: 'data:<mime>;base64,<payload>'.
  String? fileMime;
  String? fileFilename;
  String? fileUrl;

  /// OPC-M4-4: Agent-part field. Non-null when [type] == 'agent'.
  /// Carries the name of the agent the session switched to (e.g. 'plan', 'build').
  String? agentName;

  String get text => _text;
  set text(String v) => _text = v;
  void appendDelta(String delta) => _text = _text + delta;

  Map<String, dynamic>? get toolArgs => _toolArgs;
  set toolArgs(Map<String, dynamic>? v) => _toolArgs = v;

  String? get toolOutput => _toolOutput;
  set toolOutput(String? v) => _toolOutput = v;

  String? get toolStatus => _toolStatus;
  set toolStatus(String? v) => _toolStatus = v;

  /// OPC-M1-3: construct a [ChatPart] from a structured REST part object.
  ///
  /// A structured part looks like:
  ///   { type: 'text', text: '...' }
  ///   { type: 'tool', tool: 'bash', state: { input: {...}, output: '...', status: 'completed' } }
  ///   { type: 'reasoning', text: '...' }
  ///
  /// The [messageId] must be passed from the parent message's id, since parts
  /// from the REST response don't re-embed their own message id.
  factory ChatPart.fromJson(String messageId, Map<String, dynamic> raw) {
    final type = (raw['type'] as String?) ?? 'text';
    // Generate a stable part id: prefer 'id' field; fall back to hash.
    final partId = (raw['id'] as String?) ??
        '${messageId}_${type}_${raw.hashCode.toRadixString(16)}';
    final part = ChatPart(
      id: partId,
      messageId: messageId,
      type: type,
      text: (raw['text'] as String?) ?? '',
    );
    // Apply tool/reasoning-specific fields using the existing mergePart logic.
    part.mergePart(raw);
    return part;
  }

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
      // OPC-M2-2: extract duration from time.end - time.start when available.
      final timeMap = raw['time'] as Map<String, dynamic>?;
      if (timeMap != null) {
        final start = timeMap['start'];
        final end = timeMap['end'];
        if (start is num && end is num) {
          durationMs = (end - start).round();
        }
      }
    } else if (raw['type'] == 'text') {
      final t = raw['text'];
      if (t is String) text = t;
    } else if (raw['type'] == 'compaction') {
      // OPC-M3-3: compaction parts carry optional summary text in a sibling
      // TextPart (the SDK may include a text part in the same message with the
      // summary). When a 'text' field is present on the compaction part itself
      // (e.g. in a bridge-serialised row), use it as the summary.
      final t = raw['text'];
      if (t is String) text = t;
    } else if (raw['type'] == 'file') {
      // OPC-M4-1: file / image attachment. Carry MIME, filename, and data URI.
      final m = raw['mime'] as String?;
      if (m != null) fileMime = m;
      final fn = raw['filename'] as String?;
      if (fn != null) fileFilename = fn;
      final u = raw['url'] as String?;
      if (u != null) fileUrl = u;
    } else if (raw['type'] == 'agent') {
      // OPC-M4-4: agent-switch marker. Carries the name of the switched-to agent.
      final n = raw['name'] as String?;
      if (n != null) agentName = n;
    }
  }
}
