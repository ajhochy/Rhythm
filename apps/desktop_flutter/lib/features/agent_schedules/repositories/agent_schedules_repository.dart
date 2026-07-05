import '../../agents/models/agent_session.dart';
import '../data/agent_schedules_data_source.dart';
import '../models/agent_scheduled_task.dart';

class AgentSchedulesRepository {
  AgentSchedulesRepository(this._dataSource);

  final AgentSchedulesDataSource _dataSource;

  Future<List<AgentScheduledTask>> list() => _dataSource.list();

  Future<AgentScheduledTask> create(Map<String, dynamic> input) =>
      _dataSource.create(input);

  Future<AgentScheduledTask> update(String id, Map<String, dynamic> patch) =>
      _dataSource.update(id, patch);

  Future<void> delete(String id) => _dataSource.delete(id);

  Future<AgentScheduledTask> triggerNow(String id) =>
      _dataSource.triggerNow(id);

  /// #904 — recent runs of a scheduled task (activity log).
  Future<List<AgentSession>> listRuns(String scheduledTaskId) =>
      _dataSource.listRuns(scheduledTaskId);
}
