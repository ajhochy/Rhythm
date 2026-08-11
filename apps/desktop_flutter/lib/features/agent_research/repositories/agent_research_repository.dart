import '../data/agent_research_data_source.dart';
import '../models/agent_research_job.dart';
import '../models/research_project.dart';

class AgentResearchRepository {
  AgentResearchRepository(this._dataSource);

  final AgentResearchDataSource _dataSource;

  Future<List<AgentResearchJob>> list() => _dataSource.list();

  Future<AgentResearchJob> get(String id) => _dataSource.get(id);

  Future<AgentResearchJob> create(Map<String, dynamic> input) =>
      _dataSource.create(input);

  Future<AgentResearchJob> retry(String id) => _dataSource.retry(id);

  Future<List<ResearchProject>> listProjects() => _dataSource.listProjects();
  Future<ResearchProject> createProject(Map<String, dynamic> input) =>
      _dataSource.createProject(input);
  Future<ResearchProject> updateProject(
          String id, Map<String, dynamic> input) =>
      _dataSource.updateProject(id, input);
  Future<ResearchProject> archiveProject(String id) =>
      _dataSource.archiveProject(id);
  Future<List<ResearchProjectRun>> listProjectRuns(String projectId) =>
      _dataSource.listProjectRuns(projectId);
  Future<ResearchProjectRun> getProjectRun(String projectId, String runId) =>
      _dataSource.getProjectRun(projectId, runId);
  Future<ResearchProjectRun> startProjectRun(String projectId) =>
      _dataSource.startProjectRun(projectId);
  Future<ResearchProjectRun> runAction(
          String projectId, String runId, String action) =>
      _dataSource.runAction(projectId, runId, action);
  Future<void> passAction(
          String projectId, String runId, String passId, String action) =>
      _dataSource.passAction(projectId, runId, passId, action);
  Uri magazineUri(String projectId, String runId) =>
      _dataSource.magazineUri(projectId, runId);
  Uri exportUri(String projectId, String runId, String format) =>
      _dataSource.exportUri(projectId, runId, format);
  Future<List<ResearchCapabilityWarning>> researchCapabilities() =>
      _dataSource.researchCapabilities();
}
