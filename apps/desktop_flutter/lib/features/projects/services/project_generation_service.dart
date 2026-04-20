import '../models/project_template.dart';
import '../models/project_template_step.dart';

class ResolvedStep {
  ResolvedStep({required this.step, required this.dueDate});
  final ProjectTemplateStep step;
  final DateTime dueDate;
}

/// Client-side preview service for project generation.
/// Pure function — no side effects, used exclusively for UI previews.
class ProjectGenerationService {
  /// Returns each step of [template] with its resolved due date based on [anchorDate].
  List<ResolvedStep> previewSteps(
    ProjectTemplate template,
    DateTime anchorDate,
  ) {
    final anchor = DateTime.utc(
      anchorDate.year,
      anchorDate.month,
      anchorDate.day,
    );
    return template.steps
        .map(
          (step) => ResolvedStep(
            step: step,
            dueDate: anchor.add(Duration(days: step.offsetDays)),
          ),
        )
        .toList()
      ..sort((a, b) => a.dueDate.compareTo(b.dueDate));
  }
}
