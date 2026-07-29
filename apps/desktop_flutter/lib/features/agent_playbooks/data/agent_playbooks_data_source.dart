import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';

/// A single custom slash-command ("Playbook") row from `GET /opencode/commands`.
///
/// Mirrors [OpencodeSkillEntry]/opencode_skills_data_source.dart: the engine's
/// command list is the source of truth. `managed` is true only when a
/// Rhythm-managed file actually exists for the name — built-in commands
/// (init/review) and MCP/skill-sourced commands are read-only here.
class PlaybookEntry {
  const PlaybookEntry({
    required this.name,
    this.description,
    required this.source,
    required this.managed,
  });

  final String name;
  final String? description;

  /// Provenance reported by the engine (e.g. `command`, `mcp`, `skill`).
  /// Falls back to `command` server-side when the SDK omits it.
  final String source;

  /// True when a Rhythm-managed `.md` file exists for this name
  /// (editable/deletable). False for built-in/MCP/skill-sourced rows.
  final bool managed;

  factory PlaybookEntry.fromJson(Map<String, dynamic> json) => PlaybookEntry(
    name: json['name'] as String? ?? '',
    description: json['description'] as String?,
    source: json['source'] as String? ?? 'command',
    managed: json['managed'] as bool? ?? false,
  );
}

/// Frontmatter + body for one Rhythm-managed playbook, as returned by
/// `GET /:name/content`, `POST /`, and `PUT /:name` (all three share this
/// shape server-side — see rhythm_managed_commands.ts `readManagedCommand`).
class PlaybookContent {
  const PlaybookContent({
    required this.name,
    required this.frontmatter,
    required this.template,
  });

  final String name;
  final Map<String, dynamic> frontmatter;
  final String template;

  String? get description => frontmatter['description'] as String?;
  String? get agent => frontmatter['agent'] as String?;
  String? get model => frontmatter['model'] as String?;
  bool get subtask => frontmatter['subtask'] as bool? ?? false;

  factory PlaybookContent.fromJson(Map<String, dynamic> json) =>
      PlaybookContent(
        name: json['name'] as String? ?? '',
        frontmatter: (json['frontmatter'] as Map<String, dynamic>?) ?? const {},
        template: json['template'] as String? ?? '',
      );
}

/// Data source for the Playbooks manager (#1051 / OCU-10), against the LOCAL
/// agent server. Mirrors [OpencodeSkillsDataSource] for `/opencode/commands`
/// (OCU-09 #1050 backend): list/create/update/delete + content fetch.
class AgentPlaybooksDataSource {
  AgentPlaybooksDataSource({http.Client? client})
    : _baseUrl = AppConstants.agentLocalBaseUrl,
      _client = client ?? http.Client();

  final String _baseUrl;
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

  /// Lists engine commands merged with the Rhythm-managed flag via
  /// `GET /opencode/commands`. Returns an empty list on any error so the
  /// manager can render its empty state instead of crashing.
  Future<List<PlaybookEntry>> list() async {
    try {
      final response = await _client.get(
        Uri.parse('$_baseUrl/opencode/commands'),
      );
      if (response.statusCode != 200) return [];
      final list = jsonDecode(response.body) as List<dynamic>;
      return list
          .map((e) => PlaybookEntry.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }

  /// Fetches frontmatter + body for one managed playbook via
  /// `GET /opencode/commands/:name/content`.
  Future<PlaybookContent> getContent(String name) async {
    final response = await _client.get(
      Uri.parse(
        '$_baseUrl/opencode/commands/${Uri.encodeComponent(name)}/content',
      ),
    );
    if (response.statusCode != 200) {
      throw Exception(_errorMessage(response));
    }
    return PlaybookContent.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  /// Creates a managed playbook via `POST /opencode/commands`.
  Future<PlaybookContent> create({
    required String name,
    String? description,
    String? agent,
    String? model,
    bool? subtask,
    required String template,
  }) async {
    final response = await _client.post(
      Uri.parse('$_baseUrl/opencode/commands'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'name': name,
        if (description != null) 'description': description,
        if (agent != null) 'agent': agent,
        if (model != null) 'model': model,
        if (subtask != null) 'subtask': subtask,
        'template': template,
      }),
    );
    if (response.statusCode != 200) {
      throw Exception(_errorMessage(response));
    }
    return PlaybookContent.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  /// Overwrites a managed playbook via `PUT /opencode/commands/:name`.
  Future<PlaybookContent> update(
    String name, {
    String? description,
    String? agent,
    String? model,
    bool? subtask,
    required String template,
  }) async {
    final response = await _client.put(
      Uri.parse('$_baseUrl/opencode/commands/${Uri.encodeComponent(name)}'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        if (description != null) 'description': description,
        if (agent != null) 'agent': agent,
        if (model != null) 'model': model,
        if (subtask != null) 'subtask': subtask,
        'template': template,
      }),
    );
    if (response.statusCode != 200) {
      throw Exception(_errorMessage(response));
    }
    return PlaybookContent.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  /// Deletes a managed playbook via `DELETE /opencode/commands/:name`.
  Future<void> delete(String name) async {
    final response = await _client.delete(
      Uri.parse('$_baseUrl/opencode/commands/${Uri.encodeComponent(name)}'),
    );
    if (response.statusCode != 204) {
      throw Exception(_errorMessage(response));
    }
  }
}
