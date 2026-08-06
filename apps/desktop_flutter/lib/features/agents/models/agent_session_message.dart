import '../../../app/core/utils/json_parsing.dart';

class AgentSessionMessage {
  const AgentSessionMessage({
    required this.id,
    required this.sessionId,
    required this.role,
    required this.rawText,
    required this.strippedText,
    required this.createdAt,
    this.sdkMessageId,
    this.parts,
    this.tokens,
    this.cost,
  });

  final int id;
  final String sessionId;

  /// One of: 'output' | 'input' | 'system'
  final String role;
  final String rawText;
  final String strippedText;
  final DateTime createdAt;

  /// OPC-M1-3: SDK message id from structured REST rows (null for legacy rows).
  final String? sdkMessageId;

  /// OPC-M1-3: parsed parts array from structured REST rows.
  /// Legacy rows get a synthetic [{type:'text', text:rawText}] shim from the
  /// server's listBySessionStructured(). Never null for rows returned by
  /// getSession().
  final List<Map<String, dynamic>>? parts;

  /// OPC-M1-3: token usage object (null for legacy rows).
  final Map<String, dynamic>? tokens;

  /// OPC-M1-3: message cost in USD (null for legacy rows).
  final double? cost;

  /// OPC-M1-3: construct from a StructuredAgentSessionMessage REST payload.
  ///
  /// The server's listBySessionStructured() returns:
  ///   { id, sessionId, role, rawText, strippedText, createdAt,
  ///     sdkMessageId, cost, tokens,
  ///     parts: [ {type:'text',text:'...'}, ... ] }
  ///
  /// Legacy rows (no sdkMessageId) get parts: [{type:'text',text:rawText}].
  factory AgentSessionMessage.fromStructuredJson(Map<String, dynamic> json) {
    List<Map<String, dynamic>>? parsedParts;
    final rawParts = json['parts'];
    if (rawParts is List) {
      parsedParts = rawParts.whereType<Map<String, dynamic>>().toList();
    }

    Map<String, dynamic>? parsedTokens;
    final rawTokens = json['tokens'];
    if (rawTokens is Map<String, dynamic>) parsedTokens = rawTokens;

    return AgentSessionMessage(
      id: asInt(json['id']) ?? 0,
      sessionId: asString(json['sessionId']) ?? '',
      role: asString(json['role']) ?? 'output',
      rawText: asString(json['rawText']) ?? '',
      strippedText: asString(json['strippedText']) ?? '',
      createdAt: _parseDateTime(asString(json['createdAt'])),
      sdkMessageId: asString(json['sdkMessageId']),
      parts: parsedParts,
      tokens: parsedTokens,
      cost: (json['cost'] as num?)?.toDouble(),
    );
  }

  factory AgentSessionMessage.fromJson(Map<String, dynamic> json) {
    return AgentSessionMessage(
      id: asInt(json['id']) ?? 0,
      sessionId: asString(json['sessionId']) ?? '',
      role: asString(json['role']) ?? 'output',
      rawText: asString(json['rawText']) ?? '',
      strippedText: asString(json['strippedText']) ?? '',
      createdAt: _parseDateTime(asString(json['createdAt'])),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'sessionId': sessionId,
      'role': role,
      'rawText': rawText,
      'strippedText': strippedText,
      'createdAt': createdAt.toUtc().toIso8601String(),
    };
  }
}

/// Parse an api_server timestamp, treating a designator-less value as UTC.
///
/// The api_server stores and returns SQLite `datetime('now')` output, e.g.
/// `2026-08-05 22:18:21` — UTC, but with NO trailing `Z` and no offset. Dart reads
/// a string without a designator as LOCAL time, so that parsed to 22:18 local:
/// seven hours in the future on PDT. Streamed messages use
/// `DateTime.now().toUtc()` and are correct, so every REST-loaded message sorted
/// AFTER every live one and the transcript rendered badly out of order.
///
/// Measured: `DateTime.parse('2026-08-05 22:18:21')` → `2026-08-06 05:18:21Z`
/// versus `…21Z` → `2026-08-05 22:18:21Z`. A 7-hour skew.
///
/// This is why the `seq` tiebreaker in compareChatMessages did not fix the
/// ordering on its own — with a seven-hour skew the timestamps never tie, so the
/// tiebreaker is never consulted.
DateTime _parseDateTime(String? value) {
  final raw = (value ?? '').trim();
  if (raw.isEmpty) return DateTime.fromMillisecondsSinceEpoch(0, isUtc: true);
  final parsed = DateTime.tryParse(_asUtcInstant(raw));
  if (parsed == null)
    return DateTime.fromMillisecondsSinceEpoch(0, isUtc: true);
  return parsed.toUtc();
}

/// True when the string already states its zone (trailing `Z`, or a `+hh:mm` /
/// `-hh:mm` offset after the time portion).
bool _hasZoneDesignator(String raw) {
  if (raw.endsWith('Z') || raw.endsWith('z')) return true;
  // Only look past the date part, so the '-' in `2026-08-05` is not mistaken
  // for a negative offset.
  final timeStart = raw.indexOf(RegExp(r'[T ]'));
  if (timeStart < 0) return false;
  final timePart = raw.substring(timeStart);
  return timePart.contains('+') || timePart.contains('-');
}

String _asUtcInstant(String raw) => _hasZoneDesignator(raw) ? raw : '${raw}Z';
