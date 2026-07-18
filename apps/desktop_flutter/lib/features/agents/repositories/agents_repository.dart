import '../data/agents_data_source.dart';
import '../models/agent_session.dart';
import '../models/agent_session_message.dart';
import '../models/agent_ws_message.dart';
import '../models/chat_models.dart';

class AgentsRepository {
  AgentsRepository(this._dataSource);

  final AgentsDataSource _dataSource;

  Stream<AgentWsMessage> get messages => _dataSource.messages;
  Stream<bool> get connectivityStream => _dataSource.connectivityStream;
  bool get isConnected => _dataSource.isConnected;

  Future<void> connect() => _dataSource.connect();
  Future<void> dispose() => _dataSource.dispose();
  void send(Map<String, dynamic> msg) => _dataSource.send(msg);

  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
    String? scope,
  }) =>
      _dataSource.listSessions(
        includeArchived: includeArchived,
        archivedOnly: archivedOnly,
        scope: scope,
      );

  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) => _dataSource.getSession(id);

  Future<AgentSession> createSession({
    String? agentId, // #602: null → agent-less session
    String? taskId,
    required String cwd,
    // OPC-#710: name defaults to '' for instant-create sessions.
    String name = '',
    String? branch,
    String? stash,
    bool createBranch = false,
    String? mcpRole,
    String? anthropicAccountId,
    bool isolateWorktree = false,
    String? worktreeName,
  }) =>
      _dataSource.createSession(
        agentId: agentId,
        taskId: taskId,
        cwd: cwd,
        name: name,
        branch: branch,
        stash: stash,
        createBranch: createBranch,
        mcpRole: mcpRole,
        anthropicAccountId: anthropicAccountId,
        isolateWorktree: isolateWorktree,
        worktreeName: worktreeName,
      );

  /// OCU-18 (#1059) — Changes-tab worktree actions.
  Future<void> resetWorktree(String sessionId) =>
      _dataSource.resetWorktree(sessionId);

  Future<AgentSession> removeWorktree(String sessionId) =>
      _dataSource.removeWorktree(sessionId);

  Future<void> closeSession(String id) => _dataSource.closeSession(id);

  Future<void> deleteSession(String id) => _dataSource.deleteSession(id);

  Future<AgentSession> updateSession(
    String id, {
    String? name,
    String? providerId,
    String? modelId,
    bool clearProvider = false,
    bool clearModel = false,
    String? permissionMode,
    bool? fastMode,
    String? anthropicAccountId,
  }) =>
      _dataSource.updateSession(
        id,
        name: name,
        providerId: providerId,
        modelId: modelId,
        clearProvider: clearProvider,
        clearModel: clearModel,
        permissionMode: permissionMode,
        fastMode: fastMode,
        anthropicAccountId: anthropicAccountId,
      );

  /// Issue #604 — dedicated helper to update thinking budget (null = clear).
  Future<AgentSession> updateSessionThinkingBudget(
    String id,
    int? budget,
  ) =>
      _dataSource.updateSession(id, thinkingBudget: budget);

  /// #608 — respond to a pending permission (accept, deny, or always-allow).
  Future<void> respondPermission(
    String sessionId,
    String permissionId,
    String decision, {
    String? message,
  }) =>
      _dataSource.respondPermission(sessionId, permissionId, decision,
          message: message);

  Future<void> replyQuestion(
    String sessionId,
    String callId,
    List<List<String>> answers,
  ) =>
      _dataSource.replyQuestion(sessionId, callId, answers);

  Future<void> rejectQuestion(String sessionId, String callId) =>
      _dataSource.rejectQuestion(sessionId, callId);

  Future<void> cancelSession(String id) => _dataSource.cancelSession(id);

  Future<AgentSession> archiveSession(String id) =>
      _dataSource.archiveSession(id);

  Future<AgentSession> unarchiveSession(String id) =>
      _dataSource.unarchiveSession(id);

  Future<AgentSession> resumeSession(String id) =>
      _dataSource.resumeSession(id);

  Future<List<AgentSessionMessage>> getMessages(String id, {int? limit}) =>
      _dataSource.getMessages(id, limit: limit);

  /// OPC-M3-1 — GET /agent-sessions/:id/diff — fetch working-tree diff.
  Future<List<Map<String, dynamic>>> fetchSessionDiff(String id) =>
      _dataSource.fetchSessionDiff(id);

  /// OPC-M3-2 — POST /agent-sessions/:id/revert — revert to a prior message.
  Future<void> revertSession(String sessionId, String messageId) =>
      _dataSource.revertSession(sessionId, messageId);

  /// OPC-M3-2 — POST /agent-sessions/:id/unrevert — restore reverted messages.
  Future<void> unrevertSession(String sessionId) =>
      _dataSource.unrevertSession(sessionId);

  /// OPC-M3-3 — POST /agent-sessions/:id/summarize — trigger compaction.
  Future<void> summarizeSession(String sessionId) =>
      _dataSource.summarizeSession(sessionId);

  /// OPC-M3-5 — GET /agent-sessions/:id/todo — fetch the todo list.
  Future<List<Map<String, dynamic>>> fetchSessionTodos(String id) =>
      _dataSource.fetchSessionTodos(id);

  /// Issue #862 — GET /agent-sessions/:id/memory-provenance — "Memories used
  /// in this reply".
  Future<Map<String, dynamic>> fetchMemoryProvenance(String id) =>
      _dataSource.fetchMemoryProvenance(id);

  /// OPC-M3-6 — GET /agent-sessions/:id/children/:childSdkId/messages
  /// Returns the child session's messages in M1-2 structured shape.
  Future<List<AgentSessionMessage>> fetchChildMessages(
          String parentSessionId, String childSdkId,
          {String? cwd}) =>
      _dataSource.fetchChildMessages(parentSessionId, childSdkId, cwd: cwd);

  /// OPC-M4-2 — POST /agent-sessions/:id/fork — fork the session at the given
  /// message. Returns the new [AgentSession].
  Future<AgentSession> forkSession(String sessionId, String messageId) =>
      _dataSource.forkSession(sessionId, messageId);

  /// OPC-M4-4 — GET /agent-sessions/agents — list available agents for [cwd].
  /// Delegates to [AgentsDataSource.fetchAvailableAgents].
  Future<List<AgentInfo>> fetchAvailableAgents({String? cwd}) =>
      _dataSource.fetchAvailableAgents(cwd: cwd);

  // --------------------------------------------------------------------------
  // VCS (OCU-22 #1063 / OCU-23 #1064)
  // --------------------------------------------------------------------------

  Future<Map<String, dynamic>> getVcs(String sessionId) =>
      _dataSource.getVcs(sessionId);

  Future<List<Map<String, dynamic>>> getVcsStatus(String sessionId) =>
      _dataSource.getVcsStatus(sessionId);

  Future<List<Map<String, dynamic>>> getVcsDiff(
    String sessionId,
    String mode,
  ) =>
      _dataSource.getVcsDiff(sessionId, mode);

  Future<String> getVcsDiffRaw(String sessionId) =>
      _dataSource.getVcsDiffRaw(sessionId);

  // --------------------------------------------------------------------------
  // session.shell / session.init (OCU-24 #1065 / OCU-25 #1066)
  // --------------------------------------------------------------------------

  Future<void> shellCommand(String sessionId, String command) =>
      _dataSource.shellCommand(sessionId, command);

  Future<void> initProject(String sessionId) =>
      _dataSource.initProject(sessionId);

  // --------------------------------------------------------------------------
  // File / find proxy (OCU-20 #1061 / OCU-21 #1062)
  // --------------------------------------------------------------------------

  Future<List<String>> findFiles(
    String sessionId,
    String query, {
    int? limit,
    String? type,
  }) =>
      _dataSource.findFiles(sessionId, query, limit: limit, type: type);

  Future<List<Map<String, dynamic>>> listSessionFiles(
    String sessionId, {
    String path = '.',
  }) =>
      _dataSource.listSessionFiles(sessionId, path: path);

  Future<Map<String, dynamic>> fileContent(String sessionId, String path) =>
      _dataSource.fileContent(sessionId, path);

  Future<List<Map<String, dynamic>>> filesGitStatus(String sessionId) =>
      _dataSource.filesGitStatus(sessionId);

  // --------------------------------------------------------------------------
  // PTY
  // --------------------------------------------------------------------------

  /// POST /agent-sessions/:id/pty — create a new PTY. Returns the ptyId.
  Future<String> createPty(String sessionId) =>
      _dataSource.createPty(sessionId);

  /// PATCH /pty/:id — resize the PTY to [cols] × [rows].
  Future<void> resizePty(String ptyId, int cols, int rows) =>
      _dataSource.resizePty(ptyId, cols, rows);

  /// DELETE /pty/:id — kill the PTY process.
  Future<void> killPty(String ptyId) => _dataSource.killPty(ptyId);

  /// Returns the WebSocket URL for the PTY with [ptyId].
  String ptyWsUrl(String ptyId) => _dataSource.ptyWsUrl(ptyId);
}
