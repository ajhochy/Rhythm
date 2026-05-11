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

  Future<List<AgentSession>> listSessions() => _dataSource.listSessions();

  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) => _dataSource.getSession(id);

  Future<AgentSession> createSession({
    required String agentId,
    String? taskId,
    required String cwd,
    required String name,
  }) =>
      _dataSource.createSession(
        agentId: agentId,
        taskId: taskId,
        cwd: cwd,
        name: name,
      );

  Future<void> closeSession(String id) => _dataSource.closeSession(id);

  Future<AgentSession> resumeSession(String id) =>
      _dataSource.resumeSession(id);

  Future<List<AgentSessionMessage>> getMessages(String id, {int? limit}) =>
      _dataSource.getMessages(id, limit: limit);
}
