import 'dart:convert';

import '../../../app/core/utils/json_parsing.dart';

class AgentMemoryEntry {
  AgentMemoryEntry({
    required this.id,
    required this.kind,
    required this.content,
    this.source,
    this.sourceId,
    required this.tags,
    this.lifecycleState = 'active',
    this.staleAfter,
    this.generatedBy,
    this.generatedAt,
    this.trustTier = 'unverified',
    this.sources = const [],
    this.verificationCount = 0,
    this.unverifiable = false,
    this.ownerUserId,
    required this.createdAt,
    required this.updatedAt,
  });

  factory AgentMemoryEntry.fromJson(Map<String, dynamic> json) {
    List<String> parseTags(dynamic v) {
      if (v == null) return [];
      if (v is List) return v.map((e) => e.toString()).toList();
      if (v is String && v.isNotEmpty) {
        try {
          final d = jsonDecode(v);
          if (d is List) return d.map((e) => e.toString()).toList();
        } catch (_) {}
      }
      return [];
    }

    List<Map<String, dynamic>> parseObjects(dynamic value) {
      dynamic decoded = value;
      if (value is String && value.isNotEmpty) {
        try {
          decoded = jsonDecode(value);
        } catch (_) {
          return const [];
        }
      }
      if (decoded is! List) return const [];
      return decoded
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList();
    }

    final verified = parseObjects(json['verifiedJson'] ?? json['verified']);
    return AgentMemoryEntry(
      id: asString(json['id']) ?? '',
      kind: asString(json['kind']) ?? 'fact',
      content: asString(json['content']) ?? '',
      source: asString(json['source']),
      sourceId: asString(json['sourceId']),
      tags: parseTags(json['tagsJson'] ?? json['tags']),
      lifecycleState: asString(json['lifecycleState']) ?? 'active',
      staleAfter: asString(json['staleAfter']),
      generatedBy: asString(json['generatedBy']),
      generatedAt: asString(json['generatedAt']),
      trustTier: asString(json['trustTier']) ?? 'unverified',
      sources: parseObjects(json['sourcesJson'] ?? json['sources']),
      verificationCount: verified.length,
      unverifiable: json['unverifiable'] == true,
      ownerUserId: asInt(json['ownerUserId']),
      createdAt: asString(json['createdAt']) ?? '',
      updatedAt: asString(json['updatedAt']) ?? '',
    );
  }

  final String id;
  final String kind;
  final String content;
  final String? source;
  final String? sourceId;
  final List<String> tags;
  final String lifecycleState;
  final String? staleAfter;
  final String? generatedBy;
  final String? generatedAt;
  final String trustTier;
  final List<Map<String, dynamic>> sources;
  final int verificationCount;
  final bool unverifiable;
  final int? ownerUserId;
  final String createdAt;
  final String updatedAt;
}
