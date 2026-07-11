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

DateTime _parseDateTime(String? value) {
  final parsed = DateTime.tryParse(value ?? '');
  if (parsed == null) return DateTime.fromMillisecondsSinceEpoch(0);
  return parsed;
}
