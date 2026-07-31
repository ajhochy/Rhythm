import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';

import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/agent_session.dart';
import '../models/agent_session_message.dart';
import '../models/agent_ws_message.dart';
import '../models/chat_models.dart';

// Sentinel used by updateSession to distinguish "not provided" from "null".
// Must use a named object rather than a bare const Object() so comparisons work.
const _dssentinel = _DsSentinel();

class _DsSentinel {
  const _DsSentinel();
}

// The sentinel value used at runtime (same object as _dssentinel since it's const).
const Object _dssentinelValue = _dssentinel;

/// Responses at or above this size are decoded away from the Flutter UI
/// isolate. The recent-first transcript window keeps most responses below it;
/// this remains a guard for tool-heavy messages and older full-detail servers.
const int largeJsonDecodeThresholdBytes = 256 * 1024;

Map<String, dynamic> _decodeJsonMap(String source) =>
    jsonDecode(source) as Map<String, dynamic>;

Map<String, dynamic> _decodeJsonMapBytes(List<int> bytes) =>
    _decodeJsonMap(utf8.decode(bytes));

Future<Map<String, dynamic>> _decodeResponseMap(http.Response response) {
  if (response.bodyBytes.length >= largeJsonDecodeThresholdBytes) {
    return compute(_decodeJsonMapBytes, response.bodyBytes);
  }
  return Future.value(_decodeJsonMap(response.body));
}

class AgentsDataSource {
  AgentsDataSource({http.Client? client})
      : _baseUrl = AppConstants.agentLocalBaseUrl,
        _wsUrl = AppConstants.agentLocalWsUrl,
        _client = client ?? http.Client();

  final String _baseUrl;
  final String _wsUrl;

  // Injectable so tests can capture the real outgoing HTTP request at the
  // network boundary (see opc_terminal_button_http_test.dart). Defaults to a
  // real client in production. Mirrors collaborators/commands/agent_projects.
  final http.Client _client;

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
    // #1025 (USO A2) — server category scope: chats | scheduled |
    // self_improvement. Null omits the param (server defaults to chats).
    String? scope,
  }) async {
    final uri = Uri.parse('$_baseUrl/agent-sessions').replace(
      queryParameters: {
        if (includeArchived) 'includeArchived': 'true',
        if (archivedOnly) 'archivedOnly': 'true',
        if (scope != null && scope.isNotEmpty) 'scope': scope,
      },
    );
    final response = await _client.get(
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
    final response = await _client.get(
      Uri.parse('$_baseUrl/agent-sessions/$id').replace(
        queryParameters: {'transcriptLimit': '50'},
      ),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final body = await _decodeResponseMap(response);
    final session = AgentSession.fromJson(
      body['session'] as Map<String, dynamic>? ?? body,
    );
    // OPC-M1-3: use fromStructuredJson so parts/sdkMessageId/tokens/cost are
    // parsed from the listBySessionStructured() REST payload.
    final rawMessages = body['messages'] as List<dynamic>? ?? const [];
    final msgs = rawMessages
        .map((j) =>
            AgentSessionMessage.fromStructuredJson(j as Map<String, dynamic>))
        .toList();
    return (session: session, messages: msgs);
  }

  /// Fetch one older transcript page. [before] is the exclusive cursor from
  /// the first row of the current window; rows are returned in display order.
  Future<
      ({
        List<AgentSessionMessage> messages,
        String? nextCursor,
        bool hasMore,
      })> fetchTranscriptPage(
    String id, {
    int limit = 50,
    String? before,
  }) async {
    final response = await _client.get(
      Uri.parse('$_baseUrl/agent-sessions/$id/messages').replace(
        queryParameters: {
          'limit': '$limit',
          if (before != null) 'before': before,
        },
      ),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final body = await _decodeResponseMap(response);
    final rawMessages = body['messages'] as List<dynamic>? ?? const [];
    final pageInfo =
        body['pageInfo'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    return (
      messages: rawMessages
          .map(
            (item) => AgentSessionMessage.fromStructuredJson(
              item as Map<String, dynamic>,
            ),
          )
          .toList(),
      nextCursor: pageInfo['nextCursor'] as String?,
      hasMore: pageInfo['hasMore'] as bool? ?? false,
    );
  }

  Future<AgentSession> createSession({
    String? agentId, // #602: null → agent-less session
    String? taskId,
    required String cwd,
    // OPC-#710: name defaults to '' for instant-create sessions.
    String name = '',
    String? projectId,
    String? branch,
    String? stash,
    bool createBranch = false,
    String? mcpRole,
    String? anthropicAccountId,
    // OCU-18 (#1059): run this session in an isolated git worktree.
    bool isolateWorktree = false,
    String? worktreeName,
  }) async {
    final response = await _client.post(
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
        if (mcpRole != null) 'mcpRole': mcpRole,
        if (anthropicAccountId != null)
          'anthropicAccountId': anthropicAccountId,
        if (isolateWorktree) 'isolateWorktree': true,
        if (worktreeName != null) 'worktreeName': worktreeName,
      }),
    );
    assertOk(response);
    return AgentSession.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  /// OCU-18 (#1059) — reset an isolated session's worktree branch via
  /// `POST /agent-sessions/:id/worktree/reset`.
  Future<void> resetWorktree(String sessionId) async {
    final response = await _client.post(
      Uri.parse('$_baseUrl/agent-sessions/$sessionId/worktree/reset'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
  }

  /// OCU-18 (#1059) — remove an isolated session's git worktree via
  /// `POST /agent-sessions/:id/worktree/remove`. Returns the updated session
  /// (worktree fields cleared) so the caller can refresh local state.
  Future<AgentSession> removeWorktree(String sessionId) async {
    final response = await _client.post(
      Uri.parse('$_baseUrl/agent-sessions/$sessionId/worktree/remove'),
      headers: AuthSessionStore.headers(),
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
    String? anthropicAccountId,
    String? agentId,
  }) async {
    final payload = <String, dynamic>{};
    if (name != null) payload['name'] = name;
    // #1119 — persist an explicit profile switch so it survives an app
    // restart (see AgentsController.setSelectedAgent).
    if (agentId != null) payload['agentId'] = agentId;
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
    if (anthropicAccountId != null) {
      payload['anthropicAccountId'] = anthropicAccountId;
    }
    final response = await _client.patch(
      Uri.parse('$_baseUrl/agent-sessions/$id'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode(payload),
    );
    assertOk(response);
    return AgentSession.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  /// #608 — respond to a pending permission (accept, deny, or always-allow).
  ///
  /// OCU-02 (#1043): [message] is an optional deny reason forwarded to the
  /// agent when [decision] is 'deny'.
  Future<void> respondPermission(
    String sessionId,
    String permissionId,
    String decision, {
    String? message,
  }) async {
    final response = await _client.post(
      Uri.parse(
          '$_baseUrl/agent-sessions/$sessionId/permission/$permissionId/$decision'),
      headers: AuthSessionStore.headers(json: message != null),
      body: message != null ? jsonEncode({'message': message}) : null,
    );
    if (response.statusCode != 204) {
      assertOk(response);
    }
  }

  /// Answer a pending `question` (AskUserQuestion) tool call.
  ///
  /// [answers] is one `List<String>` per question (the selected option labels).
  /// The server resolves [callId] → opencode's requestID and POSTs the reply,
  /// which unblocks the agent. Without this the question tool hangs forever.
  Future<void> replyQuestion(
    String sessionId,
    String callId,
    List<List<String>> answers,
  ) async {
    final response = await _client.post(
      Uri.parse('$_baseUrl/agent-sessions/$sessionId/question/$callId/reply'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'answers': answers}),
    );
    if (response.statusCode != 204) {
      assertOk(response);
    }
  }

  /// Dismiss a pending question (the user declines to answer).
  Future<void> rejectQuestion(String sessionId, String callId) async {
    final response = await _client.post(
      Uri.parse('$_baseUrl/agent-sessions/$sessionId/question/$callId/reject'),
      headers: AuthSessionStore.headers(),
    );
    if (response.statusCode != 204) {
      assertOk(response);
    }
  }

  // M2-4: cancel an in-flight turn for a session.
  Future<void> cancelSession(String id) async {
    final response = await _client.post(
      Uri.parse('$_baseUrl/agent-sessions/$id/cancel'),
      headers: AuthSessionStore.headers(),
    );
    if (response.statusCode != 204) {
      assertOk(response);
    }
  }

  Future<void> closeSession(String id) async {
    final response = await _client.delete(
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
    final response = await _client.delete(
      Uri.parse('$_baseUrl/agent-sessions/$id/hard'),
      headers: AuthSessionStore.headers(),
    );
    if (response.statusCode != 204) {
      assertOk(response);
    }
  }

  /// Archive a session (soft-delete, keeps history). Distinct from [deleteSession].
  Future<AgentSession> archiveSession(String id) async {
    final response = await _client.patch(
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
    final response = await _client.patch(
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
    final response = await _client.post(
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
    final response = await _client.get(
      uri,
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => AgentSessionMessage.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  /// OPC-M3-1 — GET /agent-sessions/:id/diff
  ///
  /// Returns the list of FileDiff entries for the session's working tree.
  /// Each entry is a raw JSON map with keys: file, before, after, additions,
  /// deletions. Returns an empty list when the session has no SDK mapping or
  /// no working-tree changes. Throws [AppException] on HTTP error.
  Future<List<Map<String, dynamic>>> fetchSessionDiff(String id) async {
    final response = await _client.get(
      Uri.parse('$_baseUrl/agent-sessions/$id/diff'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list.cast<Map<String, dynamic>>();
  }

  /// OPC-M3-2 — POST /agent-sessions/:id/revert { messageId }
  ///
  /// Reverts the session to the message identified by [messageId], undoing
  /// all file changes that occurred after that point. Throws on HTTP error.
  Future<void> revertSession(String id, String messageId) async {
    final response = await _client.post(
      Uri.parse('$_baseUrl/agent-sessions/$id/revert'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'messageId': messageId}),
    );
    assertOk(response);
  }

  /// OPC-M3-2 — POST /agent-sessions/:id/unrevert
  ///
  /// Restores all messages that were reverted. Throws on HTTP error.
  Future<void> unrevertSession(String id) async {
    final response = await _client.post(
      Uri.parse('$_baseUrl/agent-sessions/$id/unrevert'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
  }

  /// OPC-M3-3 — POST /agent-sessions/:id/summarize
  ///
  /// Triggers session compaction (summarize) via the SDK. The SDK picks the
  /// default model for the session; no model override is sent. Throws on HTTP
  /// error — the error is surfaced to the view via the controller.
  Future<void> summarizeSession(String id) async {
    final response = await _client.post(
      Uri.parse('$_baseUrl/agent-sessions/$id/summarize'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
  }

  /// OPC-M3-5 — GET /agent-sessions/:id/todo
  ///
  /// Returns the current todo list for the session. Each entry has:
  /// { id, content, status, priority }. Returns an empty list when the session
  /// has no todos or no active SDK mapping.
  Future<List<Map<String, dynamic>>> fetchSessionTodos(String id) async {
    final response = await _client.get(
      Uri.parse('$_baseUrl/agent-sessions/$id/todo'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list.cast<Map<String, dynamic>>();
  }

  /// Issue #862 — GET /agent-sessions/:id/memory-provenance
  ///
  /// Returns "Memories used in this reply" for the session's latest turn:
  /// `{ recorded, memoryIds, notePaths }`. `recorded: false` means no turn has
  /// ever been recorded (e.g. memory injection is disabled or the session
  /// predates this feature) — distinct from a recorded turn whose
  /// `memoryIds` is an empty list (that turn genuinely used no memories).
  Future<Map<String, dynamic>> fetchMemoryProvenance(String id) async {
    final response = await _client.get(
      Uri.parse('$_baseUrl/agent-sessions/$id/memory-provenance'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  /// OPC-M3-6 — GET /agent-sessions/:id/children/:childSdkId/messages
  ///
  /// Returns the messages for a specific child session as
  /// AgentSessionMessage objects (same structured M1-2 shape). Throws on
  /// HTTP error.
  Future<List<AgentSessionMessage>> fetchChildMessages(
      String parentSessionId, String childSdkId,
      {String? cwd}) async {
    final encodedChildId = Uri.encodeComponent(childSdkId);
    // #861 smoke fix: engine session reads are directory-scoped. For nested
    // hops the parent id is a raw SDK id with no local row, so the server
    // can't resolve the cwd itself — pass the root session's cwd along.
    final query = (cwd != null && cwd.isNotEmpty)
        ? '?cwd=${Uri.encodeQueryComponent(cwd)}'
        : '';
    final response = await _client.get(
      Uri.parse(
          '$_baseUrl/agent-sessions/$parentSessionId/children/$encodedChildId/messages$query'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final rawMessages = body['messages'] as List<dynamic>? ?? const [];
    return rawMessages
        .map((j) =>
            AgentSessionMessage.fromStructuredJson(j as Map<String, dynamic>))
        .toList();
  }

  /// OPC-M4-2 — POST /agent-sessions/:id/fork { messageId }
  ///
  /// Forks the session at [messageId], creating a new session that starts
  /// from that point in the transcript. Returns the new [AgentSession].
  /// Throws on HTTP error — the error is surfaced to the view via the
  /// controller.
  Future<AgentSession> forkSession(String id, String messageId) async {
    final response = await _client.post(
      Uri.parse('$_baseUrl/agent-sessions/$id/fork'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'messageId': messageId}),
    );
    assertOk(response);
    return AgentSession.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  /// OPC-M4-4 — GET /agent-sessions/agents?cwd=<dir>
  ///
  /// Returns the list of agents (built-ins + custom) reported by the local
  /// OpenCode SDK for the given [cwd]. When [cwd] is null the server uses
  /// the SDK default directory. Returns an empty list on any error so callers
  /// can safely ignore failures (agent selector gracefully degrades).
  Future<List<AgentInfo>> fetchAvailableAgents({String? cwd}) async {
    final uri = Uri.parse('$_baseUrl/agent-sessions/agents').replace(
      queryParameters: {
        if (cwd != null) 'cwd': cwd,
        'view': 'picker',
      },
    );
    final response = await _client.get(
      uri,
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final body = await _decodeResponseMap(response);
    final list = body['agents'] as List<dynamic>? ?? const [];
    return list
        .map((j) => AgentInfo.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  // --------------------------------------------------------------------------
  // VCS (OCU-22 #1063 / OCU-23 #1064)
  // --------------------------------------------------------------------------

  /// GET /agent-sessions/:id/vcs — `{branch?, default_branch?}` for the
  /// session's directory. Returns `{}` (both null) for a non-git directory.
  Future<Map<String, dynamic>> getVcs(String sessionId) async {
    final response = await _client.get(
      Uri.parse('$_baseUrl/agent-sessions/$sessionId/vcs'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  /// GET /agent-sessions/:id/vcs/status — changed files in the working tree.
  /// Each entry: `{file, additions, deletions, status}`.
  Future<List<Map<String, dynamic>>> getVcsStatus(String sessionId) async {
    final response = await _client.get(
      Uri.parse('$_baseUrl/agent-sessions/$sessionId/vcs/status'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list.cast<Map<String, dynamic>>();
  }

  /// GET /agent-sessions/:id/vcs/diff?mode= — structured diff. `mode` is
  /// 'git' (working-tree uncommitted) or 'branch' (vs the default branch).
  /// Each entry: `{file, patch, additions, deletions, status}`.
  Future<List<Map<String, dynamic>>> getVcsDiff(
    String sessionId,
    String mode,
  ) async {
    final response = await _client.get(
      Uri.parse('$_baseUrl/agent-sessions/$sessionId/vcs/diff?mode=$mode'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list.cast<Map<String, dynamic>>();
  }

  /// GET /agent-sessions/:id/vcs/diff/raw — the raw text/x-diff patch for
  /// uncommitted working-tree changes (used by the Changes-tab patch export).
  Future<String> getVcsDiffRaw(String sessionId) async {
    final response = await _client.get(
      Uri.parse('$_baseUrl/agent-sessions/$sessionId/vcs/diff/raw'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    return response.body;
  }

  // --------------------------------------------------------------------------
  // session.shell / session.init (OCU-24 #1065 / OCU-25 #1066)
  // --------------------------------------------------------------------------

  /// POST /agent-sessions/:id/shell {command} — run a non-interactive shell
  /// command through the session so the invocation + output land in history.
  Future<void> shellCommand(String sessionId, String command) async {
    final response = await _client.post(
      Uri.parse('$_baseUrl/agent-sessions/$sessionId/shell'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'command': command}),
    );
    assertOk(response);
  }

  /// POST /agent-sessions/:id/init — run the engine's init flow (analyze the
  /// project + generate/update AGENTS.md). Progress streams via the normal
  /// transcript. The server defaults providerID/modelID/messageID from the
  /// session's persisted model when omitted.
  Future<void> initProject(String sessionId) async {
    final response = await _client.post(
      Uri.parse('$_baseUrl/agent-sessions/$sessionId/init'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode(const {}),
    );
    assertOk(response);
  }

  // --------------------------------------------------------------------------
  // File / find proxy (OCU-19 #1060 consumers: OCU-20 #1061 / OCU-21 #1062)
  // --------------------------------------------------------------------------

  /// GET /agent-sessions/:id/files/find-files?query=&limit=&type=
  /// Fuzzy file/dir search scoped to the session directory (worktree dir when
  /// isolated). Returns matched relative paths.
  Future<List<String>> findFiles(
    String sessionId,
    String query, {
    int? limit,
    String? type,
  }) async {
    final uri =
        Uri.parse('$_baseUrl/agent-sessions/$sessionId/files/find-files')
            .replace(
      queryParameters: {
        'query': query,
        if (limit != null) 'limit': '$limit',
        if (type != null) 'type': type,
      },
    );
    final response =
        await _client.get(uri, headers: AuthSessionStore.headers());
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list.cast<String>();
  }

  /// GET /agent-sessions/:id/files/list?path= — list files/dirs at [path]
  /// (default '.') within the session directory.
  Future<List<Map<String, dynamic>>> listSessionFiles(
    String sessionId, {
    String path = '.',
  }) async {
    final uri = Uri.parse('$_baseUrl/agent-sessions/$sessionId/files/list')
        .replace(queryParameters: {'path': path});
    final response =
        await _client.get(uri, headers: AuthSessionStore.headers());
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list.cast<Map<String, dynamic>>();
  }

  /// GET /agent-sessions/:id/files/content?path= — read a file's content
  /// (worktree-safe: fetched through the proxy, never local file IO, so it
  /// works for isolated worktree sessions too). Throws [AppException] on a
  /// 413 (>2MB cap) or other HTTP error.
  Future<Map<String, dynamic>> fileContent(
    String sessionId,
    String path,
  ) async {
    final uri = Uri.parse('$_baseUrl/agent-sessions/$sessionId/files/content')
        .replace(queryParameters: {'path': path});
    final response =
        await _client.get(uri, headers: AuthSessionStore.headers());
    assertOk(response);
    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  /// GET /agent-sessions/:id/files/status — git-aware file status list for
  /// the session directory. Each entry: `{file, additions, deletions, status}`.
  Future<List<Map<String, dynamic>>> filesGitStatus(String sessionId) async {
    final response = await _client.get(
      Uri.parse('$_baseUrl/agent-sessions/$sessionId/files/status'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list.cast<Map<String, dynamic>>();
  }

  // --------------------------------------------------------------------------
  // PTY
  // --------------------------------------------------------------------------

  /// POST /agent-sessions/:id/pty — create a new PTY for the session.
  ///
  /// Returns the ptyId assigned by the server.
  Future<String> createPty(String sessionId) async {
    final response = await _client.post(
      Uri.parse('$_baseUrl/agent-sessions/$sessionId/pty'),
      headers: AuthSessionStore.headers(json: true),
    );
    assertOk(response);
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return body['ptyId'] as String;
  }

  /// PATCH /pty/:id — resize the PTY to [cols] × [rows].
  Future<void> resizePty(String ptyId, int cols, int rows) async {
    final response = await _client.patch(
      Uri.parse('$_baseUrl/pty/$ptyId'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'cols': cols, 'rows': rows}),
    );
    assertOk(response);
  }

  /// DELETE /pty/:id — kill the PTY process.
  Future<void> killPty(String ptyId) async {
    await _client.delete(
      Uri.parse('$_baseUrl/pty/$ptyId'),
      headers: AuthSessionStore.headers(),
    );
  }

  /// Returns the WebSocket URL for the PTY with [ptyId].
  String ptyWsUrl(String ptyId) =>
      '${AppConstants.agentLocalWsBase}/ws/pty/$ptyId';
}
