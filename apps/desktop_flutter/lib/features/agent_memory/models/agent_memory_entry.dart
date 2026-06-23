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

    return AgentMemoryEntry(
      id: asString(json['id']) ?? '',
      kind: asString(json['kind']) ?? 'fact',
      content: asString(json['content']) ?? '',
      source: asString(json['source']),
      sourceId: asString(json['sourceId']),
      tags: parseTags(json['tagsJson'] ?? json['tags']),
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
  final int? ownerUserId;
  final String createdAt;
  final String updatedAt;
}
