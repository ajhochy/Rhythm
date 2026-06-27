import 'dart:convert';

import '../../../app/core/utils/json_parsing.dart';

/// An immutable snapshot of an [AgentSkill]'s state at a point in time.
///
/// Mirrors the api_server `AgentSkillVersion` model (see
/// `apps/api_server/src/models/agent_skill.ts`). Returned by
/// `GET /agent-skills/:id/versions` (camelCase keys: `skillId`, `versionNo`,
/// `whenToUse`, `stepsJson`/`tagsJson` + parsed `steps`/`tags`, `createdAt`).
class AgentSkillVersion {
  AgentSkillVersion({
    required this.id,
    required this.skillId,
    required this.versionNo,
    required this.title,
    this.whenToUse,
    this.description,
    this.steps,
    this.tags,
    this.body,
    required this.confidence,
    this.source,
    required this.createdAt,
  });

  factory AgentSkillVersion.fromJson(Map<String, dynamic> json) {
    return AgentSkillVersion(
      id: asString(json['id']) ?? '',
      skillId: asString(json['skillId']) ?? '',
      versionNo: asInt(json['versionNo']) ?? 0,
      title: asString(json['title']) ?? '',
      whenToUse: asString(json['whenToUse']),
      description: asString(json['description']),
      steps: _parseStringList(json['steps'] ?? json['stepsJson']),
      tags: _parseStringList(json['tags'] ?? json['tagsJson']),
      body: asString(json['body']),
      confidence: asDouble(json['confidence']) ?? 0,
      source: asString(json['source']),
      createdAt: asString(json['createdAt']) ?? '',
    );
  }

  final String id;
  final String skillId;
  final int versionNo;
  final String title;
  final String? whenToUse;
  final String? description;
  final List<String>? steps;
  final List<String>? tags;
  final String? body;
  final double confidence;
  final String? source;
  final String createdAt;

  static List<String>? _parseStringList(dynamic value) {
    if (value == null) return null;
    if (value is List) return value.map((e) => e.toString()).toList();
    if (value is String && value.isNotEmpty) {
      try {
        final decoded = jsonDecode(value);
        if (decoded is List) return decoded.map((e) => e.toString()).toList();
      } catch (_) {}
    }
    return null;
  }
}
