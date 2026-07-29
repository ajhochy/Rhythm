import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/session_transcript_message.dart';

/// #1027 (USO A4) — the client-side chats+scheduled list merge was retired
/// (the unified Agents list + `?scope=` server filter replaces it). Only the
/// transcript-detail fetch remains; it is reused by the Agents session detail
/// for any session (chat / scheduled / self_improvement).
class SessionHistoryDataSource {
  SessionHistoryDataSource({http.Client? client})
      : _client = client ?? http.Client(),
        _baseUrl = AppConstants.agentLocalBaseUrl;

  final http.Client _client;
  final String _baseUrl;

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
}
