import '../data/agent_projects_remote_data_source.dart';
import '../models/agent_project.dart';
import '../models/project_branches.dart';

class AgentProjectsRepository {
  AgentProjectsRepository(this._remote);

  final AgentProjectsRemoteDataSource _remote;

  Future<List<AgentProject>> list({bool includeArchived = false}) =>
      _remote.list(includeArchived: includeArchived);

  Future<AgentProject> create({
    required String name,
    required String cwd,
    String? icon,
  }) =>
      _remote.create(name: name, cwd: cwd, icon: icon);

  Future<AgentProject> update(
    String id, {
    String? name,
    String? cwd,
    String? icon,
    DateTime? archivedAt,
    bool clearArchivedAt = false,
  }) =>
      _remote.update(
        id,
        name: name,
        cwd: cwd,
        icon: icon,
        archivedAt: archivedAt,
        clearArchivedAt: clearArchivedAt,
      );

  Future<void> delete(String id) => _remote.delete(id);

  Future<AgentProject> refreshVcs(String id) => _remote.refreshVcs(id);

  Future<ProjectBranches> listBranches(String id) => _remote.listBranches(id);

  Future<AgentProject> checkout(
    String id, {
    required String branch,
    String stash = 'none',
    bool createBranch = false,
  }) =>
      _remote.checkout(id,
          branch: branch, stash: stash, createBranch: createBranch);
}
