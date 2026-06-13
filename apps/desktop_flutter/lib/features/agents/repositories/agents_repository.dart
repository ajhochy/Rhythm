import '../data/agents_data_source.dart';
import '../models/agent_session.dart';
import '../models/agent_session_message.dart';
import '../models/agent_ws_message.dart';

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
  }) =>
      _dataSource.listSessions(
        includeArchived: includeArchived,
        archivedOnly: archivedOnly,
      );

  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) => _dataSource.getSession(id);

  Future<AgentSession> createSession({
    String? agentId, // #602: null → agent-less session
    String? taskId,
    required String cwd,
    required String name,
    String? branch,
    String? stash,
    bool createBranch = false,
  }) =>
      _dataSource.createSession(
        agentId: agentId,
        taskId: taskId,
        cwd: cwd,
        name: name,
        branch: branch,
        stash: stash,
        createBranch: createBranch,
      );

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
      );

  /// Issue #604 — dedicated helper to update thinking budget (null = clear).
  Future<AgentSession> updateSessionThinkingBudget(
    String id,
    int? budget,
  ) =>
      _dataSource.updateSession(id, thinkingBudget: budget);

  /// #608 — respond to a pending permission (accept or deny).
  Future<void> respondPermission(
    String sessionId,
    String permissionId,
    String decision,
  ) =>
      _dataSource.respondPermission(sessionId, permissionId, decision);

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

  /// OPC-M3-6 — GET /agent-sessions/:id/children — list child sessions.
  Future<List<Map<String, dynamic>>> fetchChildSessions(
          String parentSessionId) =>
      _dataSource.fetchChildSessions(parentSessionId);

  /// OPC-M3-6 — GET /agent-sessions/:id/children/:childSdkId/messages
  /// Returns the child session's messages in M1-2 structured shape.
  Future<List<AgentSessionMessage>> fetchChildMessages(
          String parentSessionId, String childSdkId) =>
      _dataSource.fetchChildMessages(parentSessionId, childSdkId);

  /// OPC-M4-2 — POST /agent-sessions/:id/fork — fork the session at the given
  /// message. Returns the new [AgentSession].
  Future<AgentSession> forkSession(String sessionId, String messageId) =>
      _dataSource.forkSession(sessionId, messageId);

  /// OPC-M3-4 — Dispatch a slash command via the WS `session.command` frame.
  /// This is a no-op at the data-source level (the controller calls [send]
  /// directly); provided here for interface completeness and test doubles.
  Future<void> dispatchCommand(
    String sessionId,
    String command,
    String args,
  ) =>
      _dataSource.dispatchCommand(sessionId, command, args);
}
