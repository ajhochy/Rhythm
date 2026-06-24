import 'dart:convert';

import '../../../app/core/utils/json_parsing.dart';

/// A single entry in the shared, self-improving skill library.
///
/// Mirrors the api_server `AgentSkill` model (see
/// `apps/api_server/src/models/agent_skill.ts`). The local agent server
/// (`:4001`) returns camelCase keys via `rowToModel`: `whenToUse`, `stepsJson`,
/// `tagsJson`, `createdAt`, `updatedAt`, plus already-parsed `steps` / `tags`
/// arrays. This `fromJson` matches those exact keys, falling back to the raw
/// `*Json` strings when the parsed arrays are absent.
class AgentSkill {
  AgentSkill({
    required this.id,
    required this.title,
    this.whenToUse,
    this.description,
    this.steps,
    this.tags,
    required this.confidence,
    required this.status,
    this.source,
    required this.uses,
    required this.createdAt,
    required this.updatedAt,
  });

  factory AgentSkill.fromJson(Map<String, dynamic> json) {
    return AgentSkill(
      id: asString(json['id']) ?? '',
      title: asString(json['title']) ?? '',
      whenToUse: asString(json['whenToUse']),
      description: asString(json['description']),
      steps: _parseStringList(json['steps'] ?? json['stepsJson']),
      tags: _parseStringList(json['tags'] ?? json['tagsJson']),
      confidence: asDouble(json['confidence']) ?? 0,
      status: asString(json['status']) ?? 'draft',
      source: asString(json['source']),
      uses: asInt(json['uses']) ?? 0,
      createdAt: asString(json['createdAt']) ?? '',
      updatedAt: asString(json['updatedAt']) ?? '',
    );
  }

  final String id;
  final String title;

  /// When this skill should be applied. Null when not specified.
  final String? whenToUse;

  /// Free-text description of the skill. Null when not specified.
  final String? description;

  /// Parsed list of steps. Null when the skill is prose-only.
  final List<String>? steps;

  /// Parsed list of tags. Null when none.
  final List<String>? tags;

  /// Retrieval confidence in 0..1.
  final double confidence;

  /// Lifecycle status — `'draft'` or `'published'`.
  final String status;

  /// Origin of the skill (e.g. `'auto-extract'`, `'teacher-escalation'`,
  /// `'agent-stack-seed'`). Null when unknown.
  final String? source;

  /// How many times this skill has been injected into a run.
  final int uses;

  final String createdAt;
  final String updatedAt;

  /// True when this skill is still a draft awaiting curation.
  bool get isDraft => status == 'draft';

  /// True when this skill was captured from a teacher-model escalation
  /// (i.e. learned from a prior failure).
  bool get isTeacherEscalation => source == 'teacher-escalation';

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

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'whenToUse': whenToUse,
        'description': description,
        'steps': steps,
        'tags': tags,
        'confidence': confidence,
        'status': status,
        'source': source,
        'uses': uses,
        'createdAt': createdAt,
        'updatedAt': updatedAt,
      };
}
