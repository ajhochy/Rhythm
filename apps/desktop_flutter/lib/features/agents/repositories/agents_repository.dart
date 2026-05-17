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
    required String agentId,
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
}
