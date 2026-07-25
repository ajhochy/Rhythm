import '../data/agent_research_data_source.dart';
import '../models/agent_research_job.dart';

class AgentResearchRepository {
  AgentResearchRepository(this._dataSource);

  final AgentResearchDataSource _dataSource;

  Future<List<AgentResearchJob>> list() => _dataSource.list();

  Future<AgentResearchJob> get(String id) => _dataSource.get(id);

  Future<AgentResearchJob> create(Map<String, dynamic> input) =>
      _dataSource.create(input);

  Future<AgentResearchJob> retry(String id) => _dataSource.retry(id);
}
