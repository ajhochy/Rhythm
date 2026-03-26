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
}
