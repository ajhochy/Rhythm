import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';

import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/agent_session.dart';
import '../models/agent_session_message.dart';
import '../models/agent_ws_message.dart';

// Sentinel used by updateSession to distinguish "not provided" from "null".
// Must use a named object rather than a bare const Object() so comparisons work.
const _dssentinel = _DsSentinel();

class _DsSentinel {
  const _DsSentinel();
}

// The sentinel value used at runtime (same object as _dssentinel since it's const).
const Object _dssentinelValue = _dssentinel;

class AgentsDataSource {
  AgentsDataSource()
      : _baseUrl = AppConstants.agentLocalBaseUrl,
        _wsUrl = AppConstants.agentLocalWsUrl;

  final String _baseUrl;
  final String _wsUrl;

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _channelSub;
  final StreamController<AgentWsMessage> _msgController =
      StreamController.broadcast();
  final StreamController<bool> _connectivityController =
      StreamController<bool>.broadcast();

  Timer? _reconnectTimer;
  Timer? _disconnectFailTimer;
  Duration _backoff = const Duration(milliseconds: 250);

  Stream<AgentWsMessage> get messages => _msgController.stream;
  Stream<bool> get connectivityStream => _connectivityController.stream;
  bool get isConnected => _channel != null;

  // --------------------------------------------------------------------------
  // WebSocket
  // --------------------------------------------------------------------------

  Future<void> connect() async {
    if (_channel != null) return;
    try {
      _channel = WebSocketChannel.connect(Uri.parse(_wsUrl));
      _channelSub = _channel!.stream.listen(
        _onRaw,
        onDone: _handleDisconnect,
        onError: (_) => _handleDisconnect(),
        cancelOnError: false,
      );
      // Reset backoff on a successful connect attempt.
      _backoff = const Duration(milliseconds: 250);
      // Cancel any pending disconnect-fail timer and signal connected.
      _disconnectFailTimer?.cancel();
      _disconnectFailTimer = null;
      _connectivityController.add(true);
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _onRaw(dynamic raw) {
    try {
      final json = jsonDecode(raw as String) as Map<String, dynamic>;
      _msgController.add(AgentWsMessage.parse(json));
    } catch (e) {
      stdout.writeln('[AgentsDataSource] WS parse error: $e');
    }
  }

  void _handleDisconnect() {
    _channelSub?.cancel();
    _channelSub = null;
    _channel = null;
    // Delay the disconnected signal by 10s so a fast reconnect suppresses it.
    _disconnectFailTimer?.cancel();
    _disconnectFailTimer = Timer(
      const Duration(seconds: 10),
      () => _connectivityController.add(false),
    );
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    _reconnectTimer?.cancel();
    final delay = _backoff;
    _reconnectTimer = Timer(delay, () => connect());
    final doubled = _backoff * 2;
    _backoff = doubled > const Duration(seconds: 30)
        ? const Duration(seconds: 30)
        : doubled;
  }

  void send(Map<String, dynamic> msg) {
    final ch = _channel;
    if (ch == null) return;
    ch.sink.add(jsonEncode({'v': 1, ...msg}));
  }

  Future<void> dispose() async {
    _reconnectTimer?.cancel();
    _disconnectFailTimer?.cancel();
    await _channelSub?.cancel();
    await _channel?.sink.close();
    await _msgController.close();
    await _connectivityController.close();
  }

  // --------------------------------------------------------------------------
  // HTTP REST
  // --------------------------------------------------------------------------

  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
  }) async {
    final uri = Uri.parse('$_baseUrl/agent-sessions').replace(
      queryParameters: {
        if (includeArchived) 'includeArchived': 'true',
        if (archivedOnly) 'archivedOnly': 'true',
      },
    );
    final response = await http.get(
      uri,
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final body = jsonDecode(response.body);
    // Server returns { sessions: [...], resumable: [...] }. Older builds
    // returned a bare list; accept both for forward/back compat.
    final list = body is Map<String, dynamic>
        ? (body['sessions'] as List<dynamic>? ?? const [])
        : body as List<dynamic>;
    return list
        .map((j) => AgentSession.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async {
    final response = await http.get(
      Uri.parse('$_baseUrl/agent-sessions/$id'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final session = AgentSession.fromJson(
      body['session'] as Map<String, dynamic>? ?? body,
    );
    final rawMessages = body['messages'] as List<dynamic>? ?? const [];
    final msgs = rawMessages
        .map((j) => AgentSessionMessage.fromJson(j as Map<String, dynamic>))
        .toList();
    return (session: session, messages: msgs);
  }

  Future<AgentSession> createSession({
    String? agentId, // #602: null → agent-less session
    String? taskId,
    required String cwd,
    required String name,
    String? projectId,
    String? branch,
    String? stash,
    bool createBranch = false,
  }) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/agent-sessions'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({
        if (agentId != null) 'agentId': agentId,
        // When agentId is null, omit the field entirely so the server treats it
        // as an agent-less session (agentId: null path in the controller).
        'cwd': cwd,
        'name': name,
        if (taskId != null) 'taskId': taskId,
        if (projectId != null) 'projectId': projectId,
        if (branch != null) 'branch': branch,
        if (stash != null) 'stash': stash,
        if (createBranch) 'createBranch': true,
      }),
    );
    assertOk(response);
    return AgentSession.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  // M2-1 / #611 / #604: session-level rename + provider/model/permissionMode/thinking/fastMode override.
  Future<AgentSession> updateSession(
    String id, {
    String? name,
    String? providerId,
    String? modelId,
    bool clearProvider = false,
    bool clearModel = false,
    String? permissionMode,
    // Use Object? sentinel so callers can pass null explicitly to clear the field.
    Object? thinkingBudget = _dssentinel,
    bool? fastMode,
  }) async {
    final payload = <String, dynamic>{};
    if (name != null) payload['name'] = name;
    if (clearProvider) {
      payload['providerId'] = null;
    } else if (providerId != null) {
      payload['providerId'] = providerId;
    }
    if (clearModel) {
      payload['modelId'] = null;
    } else if (modelId != null) {
      payload['modelId'] = modelId;
    }
    if (permissionMode != null) {
      payload['permissionMode'] = permissionMode;
    }
    if (thinkingBudget != _dssentinelValue) {
      payload['thinkingBudget'] = thinkingBudget;
    }
    if (fastMode != null) {
      payload['fastMode'] = fastMode;
    }
    final response = await http.patch(
      Uri.parse('$_baseUrl/agent-sessions/$id'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode(payload),
    );
    assertOk(response);
    return AgentSession.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  /// #608 — respond to a pending permission (accept or deny).
  Future<void> respondPermission(
    String sessionId,
    String permissionId,
    String decision,
  ) async {
    final response = await http.post(
      Uri.parse(
          '$_baseUrl/agent-sessions/$sessionId/permission/$permissionId/$decision'),
      headers: AuthSessionStore.headers(),
    );
    if (response.statusCode != 204) {
      assertOk(response);
    }
  }

  // M2-4: cancel an in-flight turn for a session.
  Future<void> cancelSession(String id) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/agent-sessions/$id/cancel'),
      headers: AuthSessionStore.headers(),
    );
    if (response.statusCode != 204) {
      assertOk(response);
    }
  }

  Future<void> closeSession(String id) async {
    final response = await http.delete(
      Uri.parse('$_baseUrl/agent-sessions/$id'),
      headers: AuthSessionStore.headers(),
    );
    if (response.statusCode != 204) {
      assertOk(response);
    }
  }

  /// Hard-delete a session row and its messages. Distinct from
  /// [closeSession], which only flips status to closed.
  Future<void> deleteSession(String id) async {
    final response = await http.delete(
      Uri.parse('$_baseUrl/agent-sessions/$id/hard'),
      headers: AuthSessionStore.headers(),
    );
    if (response.statusCode != 204) {
      assertOk(response);
    }
  }

  /// Archive a session (soft-delete, keeps history). Distinct from [deleteSession].
  Future<AgentSession> archiveSession(String id) async {
    final response = await http.patch(
      Uri.parse('$_baseUrl/agent-sessions/$id'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'archived': true}),
    );
    assertOk(response);
    return AgentSession.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  /// Unarchive a session, returning it to the active list.
  Future<AgentSession> unarchiveSession(String id) async {
    final response = await http.patch(
      Uri.parse('$_baseUrl/agent-sessions/$id'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'archived': false}),
    );
    assertOk(response);
    return AgentSession.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<AgentSession> resumeSession(String id) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/agent-sessions/$id/resume'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    return AgentSession.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<List<AgentSessionMessage>> getMessages(
    String id, {
    int? limit,
  }) async {
    final uri = Uri.parse('$_baseUrl/agent-sessions/$id/messages').replace(
      queryParameters: limit != null ? {'limit': '$limit'} : null,
    );
    final response = await http.get(
      uri,
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => AgentSessionMessage.fromJson(j as Map<String, dynamic>))
        .toList();
  }
}
