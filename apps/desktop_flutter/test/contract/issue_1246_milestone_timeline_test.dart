import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('issue-1246-c4: project instance renders one ordered milestone timeline',
      () {
    final model = File(
      'lib/features/projects/models/project_instance.dart',
    ).readAsStringSync();
    final view = File(
      'lib/features/projects/views/projects_view.dart',
    ).readAsStringSync();

    expect(model, contains('class ProjectMilestone'));
    expect(model, contains('final String? milestoneId'));
    expect(model, contains('final List<ProjectMilestone> milestones'));
    expect(view, contains("ValueKey('project-milestone-\${milestone.id}')"));
    expect(view, contains("ValueKey('project-milestone-ungrouped')"));
  });

  test('issue-1246-layering: milestone writes use the layered project feature',
      () {
    final data = File(
      'lib/features/projects/data/project_milestones_data_source.dart',
    );
    final repository = File(
      'lib/features/projects/repositories/project_milestones_repository.dart',
    );
    final controller = File(
      'lib/features/projects/controllers/project_milestones_controller.dart',
    );

    expect(data.existsSync(), isTrue);
    expect(repository.existsSync(), isTrue);
    expect(controller.existsSync(), isTrue);
  });
}
