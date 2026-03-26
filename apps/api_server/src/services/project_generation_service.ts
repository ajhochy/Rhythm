import type { ProjectInstance } from '../models/project_instance';
import { ProjectInstancesRepository } from '../repositories/project_instances_repository';
import { ProjectTemplatesRepository } from '../repositories/project_templates_repository';

export class ProjectGenerationService {
  private readonly templateRepo = new ProjectTemplatesRepository();
  private readonly instanceRepo = new ProjectInstancesRepository();

  /**
   * Generate a ProjectInstance from a template and an anchor date.
   * Each step's due date = anchorDate + offsetDays.
   * Idempotent: returns the existing instance if one already exists for this template + anchorDate.
   */
  generate(
    templateId: string,
    anchorDate: string,
    name?: string | null,
  ): ProjectInstance {
    const normalizedName = name?.trim() || null;
    const existing = this.instanceRepo.findByTemplateAndAnchor(
      templateId,
      anchorDate,
      normalizedName,
    );
    if (existing) return existing;

    const template = this.templateRepo.findById(templateId);
    const anchor = new Date(anchorDate + 'T00:00:00Z');

    const steps = template.steps.map((step) => {
      const dueDate = new Date(anchor);
      dueDate.setUTCDate(dueDate.getUTCDate() + step.offsetDays);
      return {
        stepId: step.id,
        title: step.title,
        dueDate: dueDate.toISOString().split('T')[0],
      };
    });

    return this.instanceRepo.createWithSteps(
      templateId,
      anchorDate,
      normalizedName,
      steps,
    );
  }
}
