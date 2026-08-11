import '../data/project_milestones_data_source.dart';
import '../models/project_instance.dart';

class ProjectMilestonesRepository {
  ProjectMilestonesRepository(this._dataSource);

  final ProjectMilestonesDataSource _dataSource;

  Future<ProjectMilestone> create(
    String instanceId, {
    required String title,
    String? dueDate,
    String? color,
    int? sortOrder,
  }) =>
      _dataSource.create(
        instanceId,
        title: title,
        dueDate: dueDate,
        color: color,
        sortOrder: sortOrder,
      );

  Future<void> delete(String instanceId, String milestoneId) =>
      _dataSource.delete(instanceId, milestoneId);

  Future<void> assignStep(String stepId, String? milestoneId) =>
      _dataSource.assignStep(stepId, milestoneId);
}
