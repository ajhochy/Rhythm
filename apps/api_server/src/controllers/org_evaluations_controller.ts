import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { OrgEvaluationRepository } from '../repositories/org_evaluation_repository';
import { getOrgEvaluationSettingsAsync, saveOrgEvaluationSettingsAsync } from '../services/org_evaluation_settings';
import { getOrgEvaluationProviderRelay } from '../services/org_evaluation_provider_relay';

export class OrgEvaluationsController {
  async settings(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try { res.json(await getOrgEvaluationSettingsAsync()); } catch (error) { next(error); }
  }

  async saveSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try { res.json(await saveOrgEvaluationSettingsAsync(req.body)); } catch (error) { next(error); }
  }

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const repository = new OrgEvaluationRepository();
      const jobs = req.auth ? [...await repository.listJobsAsync(req.auth.user.id), ...await repository.listJobsAsync(null)]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : await repository.listJobsAsync();
      // The index is metadata. Owner-readable detail is fetched explicitly;
      // do not copy all frozen session text into every activity refresh.
      res.json({ jobs: jobs.map(job => ({ ...job, inputJson: '{}' })) });
    } catch (error) { next(error); }
  }

  async detail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const repository = new OrgEvaluationRepository();
      const job = await repository.getJobAsync(String(req.params.id));
      if (!job) throw AppError.notFound('Evaluation not found');
      if (req.auth && job.ownerUserId !== null && job.ownerUserId !== req.auth.user.id) throw AppError.notFound('Evaluation not found');
      const [candidates, results, budget] = await Promise.all([
        repository.listCandidatesAsync(job.id), repository.listResultsAsync(job.id), repository.getBudgetAsync(job.id),
      ]);
      const visibleJob = ['planning', 'exploring', 'validating'].includes(job.status)
        ? { ...job, inputJson: '{}' } : job;
      res.json({ job: visibleJob, candidates, results, budget });
    } catch (error) { next(error); }
  }

  async provider(req: Request, res: Response, next: NextFunction): Promise<void> {
    try { await getOrgEvaluationProviderRelay().handle(req, res, next); } catch (error) { next(error); }
  }
}
