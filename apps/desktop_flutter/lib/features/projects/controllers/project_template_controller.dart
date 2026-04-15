import 'package:flutter/foundation.dart';
import '../models/project_template.dart';
import '../repositories/projects_repository.dart';

enum ProjectsStatus { idle, loading, error }

class ProjectTemplateController extends ChangeNotifier {
  ProjectTemplateController(this._repository);

  final ProjectsRepository _repository;

  List<ProjectTemplate> _templates = [];
  ProjectsStatus _status = ProjectsStatus.idle;
  String? _errorMessage;

  List<ProjectTemplate> get templates => _templates;
  ProjectsStatus get status => _status;
  String? get errorMessage => _errorMessage;

  Future<void> load() async {
    _status = ProjectsStatus.loading;
    _errorMessage = null;
    notifyListeners();

    try {
      _templates = await _repository.getAll();
      _status = ProjectsStatus.idle;
    } catch (e) {
      _errorMessage = e.toString();
      _status = ProjectsStatus.error;
    }
    notifyListeners();
  }

  Future<void> createTemplate(String name, {String? description}) async {
    try {
      final template = await _repository.create(name, description: description);
      _templates = [..._templates, template];
      notifyListeners();
    } catch (e) {
      _errorMessage = e.toString();
      _status = ProjectsStatus.error;
      notifyListeners();
    }
  }

  Future<void> deleteTemplate(String id) async {
    try {
      await _repository.delete(id);
      _templates = _templates.where((t) => t.id != id).toList();
      notifyListeners();
    } catch (e) {
      _errorMessage = e.toString();
      _status = ProjectsStatus.error;
      notifyListeners();
    }
  }

  Future<void> updateTemplate(
    String id, {
    String? name,
    String? description,
  }) async {
    try {
      final updated = await _repository.update(
        id,
        name: name,
        description: description,
      );
      _templates = _templates.map((t) => t.id == id ? updated : t).toList();
      notifyListeners();
    } catch (e) {
      _errorMessage = e.toString();
      _status = ProjectsStatus.error;
      notifyListeners();
    }
  }

  Future<void> updateStep(
    String templateId,
    String stepId, {
    String? title,
    int? offsetDays,
    String? offsetDescription,
    int? assigneeId,
  }) async {
    try {
      await _repository.updateStep(
        templateId,
        stepId,
        title: title,
        offsetDays: offsetDays,
        offsetDescription: offsetDescription,
        assigneeId: assigneeId,
      );
      await load();
    } catch (e) {
      _errorMessage = e.toString();
      _status = ProjectsStatus.error;
      notifyListeners();
    }
  }

  Future<void> deleteStep(String templateId, String stepId) async {
    try {
      await _repository.deleteStep(templateId, stepId);
      await load();
    } catch (e) {
      _errorMessage = e.toString();
      _status = ProjectsStatus.error;
      notifyListeners();
    }
  }

  Future<void> addStep(
    String templateId, {
    required String title,
    required int offsetDays,
    String? offsetDescription,
    int? sortOrder,
    int? assigneeId,
  }) async {
    try {
      await _repository.addStep(
        templateId,
        title: title,
        offsetDays: offsetDays,
        offsetDescription: offsetDescription,
        sortOrder: sortOrder,
        assigneeId: assigneeId,
      );
      // Reload to get updated template with new step
      await load();
    } catch (e) {
      _errorMessage = e.toString();
      _status = ProjectsStatus.error;
      notifyListeners();
    }
  }
}
