import '../data/projects_local_data_source.dart';
import '../models/project_template.dart';
import '../models/project_template_step.dart';

class ProjectsRepository {
  ProjectsRepository(this._dataSource);

  final ProjectsLocalDataSource _dataSource;

  Future<List<ProjectTemplate>> getAll() => _dataSource.fetchAll();

  Future<ProjectTemplate> create(String name,
          {String? description, String? anchorType}) =>
      _dataSource.create(name,
          description: description, anchorType: anchorType);

  Future<ProjectTemplateStep> addStep(
    String templateId, {
    required String title,
    required int offsetDays,
    String? offsetDescription,
    int? sortOrder,
  }) =>
      _dataSource.addStep(
        templateId,
        title: title,
        offsetDays: offsetDays,
        offsetDescription: offsetDescription,
        sortOrder: sortOrder,
      );

  Future<ProjectTemplate> update(String id,
          {String? name, String? description}) =>
      _dataSource.update(id, name: name, description: description);

  Future<ProjectTemplateStep> updateStep(String templateId, String stepId,
          {String? title, int? offsetDays, String? offsetDescription}) =>
      _dataSource.updateStep(templateId, stepId,
          title: title,
          offsetDays: offsetDays,
          offsetDescription: offsetDescription);

  Future<void> deleteStep(String templateId, String stepId) =>
      _dataSource.deleteStep(templateId, stepId);

  Future<void> delete(String id) => _dataSource.delete(id);
}
