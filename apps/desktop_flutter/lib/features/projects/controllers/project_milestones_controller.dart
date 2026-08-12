import 'package:flutter/foundation.dart';

import '../repositories/project_milestones_repository.dart';

class ProjectMilestonesController extends ChangeNotifier {
  ProjectMilestonesController(this._repository);

  final ProjectMilestonesRepository _repository;
  String? errorMessage;

  Future<bool> create(String instanceId, String title, {int? sortOrder}) async {
    try {
      await _repository.create(
        instanceId,
        title: title,
        sortOrder: sortOrder,
      );
      errorMessage = null;
      notifyListeners();
      return true;
    } catch (error) {
      errorMessage = error.toString();
      notifyListeners();
      return false;
    }
  }

  Future<bool> delete(String instanceId, String milestoneId) async {
    try {
      await _repository.delete(instanceId, milestoneId);
      errorMessage = null;
      notifyListeners();
      return true;
    } catch (error) {
      errorMessage = error.toString();
      notifyListeners();
      return false;
    }
  }

  Future<bool> assignStep(String stepId, String? milestoneId) async {
    try {
      await _repository.assignStep(stepId, milestoneId);
      errorMessage = null;
      notifyListeners();
      return true;
    } catch (error) {
      errorMessage = error.toString();
      notifyListeners();
      return false;
    }
  }
}
