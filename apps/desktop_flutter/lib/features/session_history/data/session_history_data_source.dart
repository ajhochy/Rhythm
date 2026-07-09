import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../../../app/core/utils/json_parsing.dart';
import '../models/session_history_agent_session.dart';
import '../models/session_transcript_message.dart';

class SessionHistoryDataSource {
  SessionHistoryDataSource({http.Client? client})
    : _client = client ?? http.Client(),
      _baseUrl = AppConstants.agentLocalBaseUrl;

  final http.Client _client;
  final String _baseUrl;

  Future<List<SessionHistoryAgentSession>> listSessions() async {
    final cookbookSessions = await _listCookbookSessions();
    final scheduledSessions = await _listScheduledSessions();

    final combined = <SessionHistoryAgentSession>[
      ...cookbookSessions,
      ...scheduledSessions,
    ]..sort((a, b) => b.startTime.compareTo(a.startTime));
    return combined;
  }

  Future<List<SessionTranscriptMessage>> getTranscript(String sessionId) async {
    final response = await _client.get(
      Uri.parse('$_baseUrl/agent-sessions/$sessionId/messages'),
    );
    assertOk(response);
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final messages = body['messages'] as List<dynamic>? ?? const [];
    return messages
        .map(
          (item) =>
              SessionTranscriptMessage.fromJson(item as Map<String, dynamic>),
        )
        .toList();
  }

  Future<List<SessionHistoryAgentSession>> _listCookbookSessions() async {
    final response = await _client.get(Uri.parse('$_baseUrl/agent-sessions'));
    assertOk(response);
    final body = jsonDecode(response.body);
    final list = body is Map<String, dynamic>
        ? (body['sessions'] as List<dynamic>? ?? const [])
        : body as List<dynamic>;

    return list
        .whereType<Map<String, dynamic>>()
        .where(_looksLikeCookbookRun)
        .map(
          (item) => SessionHistoryAgentSession.fromJson(
            item,
            source: SessionHistorySource.cookbook,
          ),
        )
        .toList();
  }

  Future<List<SessionHistoryAgentSession>> _listScheduledSessions() async {
    final tasks = await _listScheduledTasks();
    final runsByTask = await Future.wait(
      tasks.map((task) => _listScheduledTaskRuns(task)),
    );
    return runsByTask.expand((runs) => runs).toList();
  }

  Future<List<_ScheduledTaskSummary>> _listScheduledTasks() async {
    final response = await _client.get(Uri.parse('$_baseUrl/agent-schedules'));
    assertOk(response);
    final data = jsonDecode(response.body) as List<dynamic>;
    return data
        .whereType<Map<String, dynamic>>()
        .map(
          (item) => _ScheduledTaskSummary(
            id: asString(item['id']) ?? '',
            name: asString(item['name']) ?? 'Scheduled task',
          ),
        )
        .where((task) => task.id.isNotEmpty)
        .toList();
  }

  Future<List<SessionHistoryAgentSession>> _listScheduledTaskRuns(
    _ScheduledTaskSummary task,
  ) async {
    final uri = Uri.parse(
      '$_baseUrl/agent-sessions',
    ).replace(queryParameters: {'scheduledTaskId': task.id});
    final response = await _client.get(uri);
    assertOk(response);
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final sessions = body['sessions'] as List<dynamic>? ?? const [];
    return sessions
        .whereType<Map<String, dynamic>>()
        .map(
          (item) => SessionHistoryAgentSession.fromJson(
            item,
            source: SessionHistorySource.scheduledTask,
            sourceName: task.name,
          ),
        )
        .toList();
  }

  bool _looksLikeCookbookRun(Map<String, dynamic> json) {
    final scheduledTaskId = asString(json['scheduledTaskId']);
    if (scheduledTaskId != null && scheduledTaskId.isNotEmpty) return false;

    final name = (asString(json['name']) ?? '').trim();
    return name == 'AgentRunner run' || name.startsWith('Cookbook:');
  }
}

class _ScheduledTaskSummary {
  const _ScheduledTaskSummary({required this.id, required this.name});

  final String id;
  final String name;
}
