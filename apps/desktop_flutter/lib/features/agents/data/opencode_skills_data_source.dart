import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';

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
  });

  final String name;
  final String? description;

  /// Absolute path / location string the engine reported for this skill.
  final String location;

  /// True when the skill lives in the Rhythm-managed dir (editable/deletable).
  /// False for external skills (plugins, `~/.claude/skills`, etc.) which are
  /// read-only and scope-only.
  final bool managed;

  factory OpencodeSkillEntry.fromJson(Map<String, dynamic> json) {
    return OpencodeSkillEntry(
      name: json['name'] as String,
      description: json['description'] as String?,
      location: json['location'] as String? ?? '',
      managed: json['managed'] as bool? ?? false,
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
      final response =
          await _client.get(Uri.parse('$_baseUrl/opencode/skills'));
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
    final response =
        await _client.delete(Uri.parse('$_baseUrl/opencode/skills/$name'));
    if (response.statusCode != 204) {
      throw Exception(_errorMessage(response));
    }
  }
}
