import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';

/// The #792 sidecar metadata joined onto a live engine skill by `name`, as
/// returned under the `metadata` key when listing with `?withMetadata=true`
/// (#793). Mirrors the api_server `SkillMetadata` shape exactly.
///
/// Auto-apply lifecycle only (`active`/`measuring`/`reverted`) — there is NO
/// human review queue / proposals feed. When a skill has no sidecar row the
/// server returns the defaults: `version: 1`, `status: 'active'`, all
/// measurement fields null.
class OpencodeSkillMetadata {
  const OpencodeSkillMetadata({
    this.confidence,
    this.version = 1,
    this.status,
    this.source,
    this.uses,
    this.baselineScore,
    this.postScore,
    this.isExternalFork = false,
  });

  /// Retrieval confidence in 0..1. Null when no sidecar row.
  final double? confidence;

  /// Current version of the live skill (bumped by auto-apply/auto-revert).
  final int version;

  /// Auto-apply lifecycle status: `active`, `measuring`, or `reverted`.
  /// Null when the sidecar row carries a legacy (pre-#797) status.
  final String? status;

  /// Provenance of the skill (e.g. `teacher-escalation`, `auto-extract`).
  final String? source;

  /// How many times this skill has been injected into a run. Null when no row.
  final int? uses;

  /// Judge score on the prior revision before an auto-applied change.
  final double? baselineScore;

  /// Judge score after an auto-applied change (compared to baseline).
  final double? postScore;

  /// True when this managed skill is a shadow fork of an external skill that
  /// the self-improvement loop auto-improved (the external original is
  /// untouched).
  final bool isExternalFork;

  factory OpencodeSkillMetadata.fromJson(Map<String, dynamic> json) {
    return OpencodeSkillMetadata(
      confidence: (json['confidence'] as num?)?.toDouble(),
      version: (json['version'] as num?)?.toInt() ?? 1,
      status: json['status'] as String?,
      source: json['source'] as String?,
      uses: (json['uses'] as num?)?.toInt(),
      baselineScore: (json['baselineScore'] as num?)?.toDouble(),
      postScore: (json['postScore'] as num?)?.toDouble(),
      isExternalFork: json['isExternalFork'] as bool? ?? false,
    );
  }

  /// True once a measured change has both a baseline and a post score.
  bool get hasScores => baselineScore != null && postScore != null;
}

/// A single skill entry discovered by the opencode engine.
///
/// The engine's filesystem skill store is the single source of truth. `name`
/// matches the fork's `SKILL.md` `name` — these are the exact strings that must
/// be persisted into a profile's `allowed_skills_json` so per-session scoping
/// matches (CRITICAL #775: never transform/prefix these names).
class OpencodeSkillEntry {
  const OpencodeSkillEntry({
    required this.name,
    this.description,
    required this.location,
    required this.managed,
    this.metadata,
  });

  final String name;
  final String? description;

  /// Absolute path / location string the engine reported for this skill.
  final String location;

  /// True when the skill lives in the Rhythm-managed dir (editable/deletable).
  /// False for external skills (plugins, `~/.claude/skills`, etc.) which are
  /// read-only and scope-only.
  final bool managed;

  /// Sidecar provenance + lifecycle, present only when fetched with
  /// `?withMetadata=true` (#793). Null on the plain picker read.
  final OpencodeSkillMetadata? metadata;

  factory OpencodeSkillEntry.fromJson(Map<String, dynamic> json) {
    final rawMeta = json['metadata'];
    return OpencodeSkillEntry(
      name: json['name'] as String,
      description: json['description'] as String?,
      location: json['location'] as String? ?? '',
      managed: json['managed'] as bool? ?? false,
      metadata: rawMeta is Map<String, dynamic>
          ? OpencodeSkillMetadata.fromJson(rawMeta)
          : null,
    );
  }
}

/// Data source for the engine's live skill list and Rhythm-managed skill
/// authoring, against the LOCAL agent server.
///
/// Always targets [AppConstants.agentLocalBaseUrl] (`http://localhost:4001`) —
/// NEVER the production server URL from ServerConfigService. Changing the
/// production Server URL in Settings must not affect the skills picker (see the
/// dual-endpoint architecture in CLAUDE.md). Mirrors [AgentModelsDataSource].
class OpencodeSkillsDataSource {
  OpencodeSkillsDataSource({http.Client? client})
      : _baseUrl = AppConstants.agentLocalBaseUrl,
        _client = client ?? http.Client();

  final String _baseUrl;

  // Injectable so the list→picker flow can be exercised end-to-end against a
  // fake backend in widget tests. Defaults to a real client in production.
  final http.Client _client;

  String _errorMessage(http.Response response) {
    try {
      final b = jsonDecode(response.body) as Map<String, dynamic>;
      final err = b['error'] as Map<String, dynamic>?;
      return err?['message'] as String? ?? 'HTTP ${response.statusCode}';
    } catch (_) {
      return 'HTTP ${response.statusCode}';
    }
  }

  /// Lists the engine's live discovered skills from `GET /opencode/skills`.
  ///
  /// Returns an empty list on any error so callers can degrade gracefully (the
  /// picker shows a "no skills" empty state rather than a stale hardcoded list).
  Future<List<OpencodeSkillEntry>> list() async {
    try {
      final response = await _client.get(
        Uri.parse('$_baseUrl/opencode/skills'),
      );
      if (response.statusCode != 200) return [];
      final list = jsonDecode(response.body) as List<dynamic>;
      return list
          .map((e) => OpencodeSkillEntry.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }

  /// Lists the engine's live skills with the #792/#793 sidecar metadata joined
  /// on by name, from `GET /opencode/skills?withMetadata=true`.
  ///
  /// Each entry carries a non-null [OpencodeSkillEntry.metadata]. Returns an
  /// empty list on any error so the standalone Skills menu can render its empty
  /// state instead of a stale hardcoded list (no fallback).
  Future<List<OpencodeSkillEntry>> listWithMetadata() async {
    try {
      final response = await _client.get(
        Uri.parse('$_baseUrl/opencode/skills?withMetadata=true'),
      );
      if (response.statusCode != 200) return [];
      final list = jsonDecode(response.body) as List<dynamic>;
      return list
          .map((e) => OpencodeSkillEntry.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }

  /// Creates (or overwrites) a Rhythm-managed skill via `POST /opencode/skills`.
  ///
  /// Throws [Exception] with the server's error message on a non-2xx response
  /// (e.g. 400 for an invalid/empty name).
  Future<OpencodeSkillEntry> create({
    required String name,
    String? description,
    required String content,
  }) async {
    final response = await _client.post(
      Uri.parse('$_baseUrl/opencode/skills'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'name': name,
        if (description != null) 'description': description,
        'content': content,
      }),
    );
    if (response.statusCode != 200) {
      throw Exception(_errorMessage(response));
    }
    return OpencodeSkillEntry.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  /// Overwrites a Rhythm-managed skill via `PUT /opencode/skills/:name`.
  Future<OpencodeSkillEntry> update(
    String name, {
    String? description,
    required String content,
  }) async {
    final response = await _client.put(
      Uri.parse('$_baseUrl/opencode/skills/$name'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        if (description != null) 'description': description,
        'content': content,
      }),
    );
    if (response.statusCode != 200) {
      throw Exception(_errorMessage(response));
    }
    return OpencodeSkillEntry.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  /// Deletes a Rhythm-managed skill via `DELETE /opencode/skills/:name`.
  ///
  /// Throws [Exception] on a non-204 response (e.g. 404 when the skill is not
  /// managed — external skills cannot be deleted).
  Future<void> delete(String name) async {
    final response = await _client.delete(
      Uri.parse('$_baseUrl/opencode/skills/$name'),
    );
    if (response.statusCode != 204) {
      throw Exception(_errorMessage(response));
    }
  }
}
