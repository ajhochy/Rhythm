import { seedOrgReviewerTask } from './org_reviewer_seed';

/** Retained for the existing startup caller; the generator schedules are retired. */
export interface OrgOptimizerSeedResult {
  auditTaskSeeded: boolean;
  auditTaskSkippedReason?: string;
  externalTaskSeeded: boolean;
  externalTaskSkippedReason?: string;
  reviewerTaskSeeded?: boolean;
  reviewerTaskSkippedReason?: string;
  legacyRetired: boolean;
}

export async function seedOrgOptimizerTask(): Promise<OrgOptimizerSeedResult> {
  const reviewer = await seedOrgReviewerTask();
  return {
    auditTaskSeeded: false,
    auditTaskSkippedReason: 'retired in favor of Org Reviewer',
    externalTaskSeeded: false,
    externalTaskSkippedReason: 'automatic external discovery retired',
    reviewerTaskSeeded: reviewer.seeded,
    reviewerTaskSkippedReason: reviewer.skippedReason,
    legacyRetired: reviewer.legacyRetired,
  };
}
