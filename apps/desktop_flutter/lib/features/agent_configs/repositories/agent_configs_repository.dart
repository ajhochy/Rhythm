import '../data/agent_configs_data_source.dart';
import '../models/agent_config.dart';

class AgentConfigsRepository {
  AgentConfigsRepository(this._dataSource);

  final AgentConfigsDataSource _dataSource;

  Future<List<AgentConfig>> getAll() => _dataSource.list();

  Future<AgentConfig> create(Map<String, dynamic> input) =>
      _dataSource.create(input);

  Future<AgentConfig> update(String id, Map<String, dynamic> patch) =>
      _dataSource.update(id, patch);

  Future<void> delete(String id) => _dataSource.delete(id);
}
