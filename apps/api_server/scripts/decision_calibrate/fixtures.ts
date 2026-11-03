/** 20 calibration prompts with the tier a human would want. Edit freely, or pass --fixtures path.json. */
import type { Tier } from '../../src/services/decision/calibration_analysis';

export interface CalibrationFixture {
  prompt: string;
  expectedTier: Tier;
  why: string;
}

export const CALIBRATION_FIXTURES: CalibrationFixture[] = [
  // ---- cheap (7) ----
  { expectedTier: 'cheap', prompt: 'What tasks are due today?', why: 'single lookup' },
  { expectedTier: 'cheap', prompt: 'Mark the bulletin proofread task as done.', why: 'one status change' },
  { expectedTier: 'cheap', prompt: 'Is the Fellowship Hall free Friday at 6pm?', why: 'one availability check' },
  { expectedTier: 'cheap', prompt: 'Rename the variable tmp to pendingReservation in facilities_controller.ts.', why: 'mechanical rename; wording resembles a code edit' },
  { expectedTier: 'cheap', prompt: 'Fix the typo in the first line of this announcement: "Welcom to church".', why: 'trivial edit' },
  {
    expectedTier: 'cheap',
    prompt: 'Here is the full text of our Easter weekend volunteer schedule, with roles, arrival times, contact numbers and parking notes for each of the four services. Please just tell me what time the 11am worship team call time is, nothing else. Sunday 9:00 setup crew, 9:30 tech check, 10:15 band rehearsal, 10:45 worship team call time for the 11am service, 11:00 doors.',
    why: 'LONG prompt but the answer is a single lookup',
  },
  { expectedTier: 'cheap', prompt: 'Change the due date of the volunteer thank-you task to Friday.', why: 'one field update' },
  // ---- standard (7) ----
  { expectedTier: 'standard', prompt: 'Draft a friendly email to the volunteer team thanking them for Easter weekend and asking for feedback.', why: 'email drafting' },
  { expectedTier: 'standard', prompt: "Summarize this week's message threads and list any follow-ups I owe people.", why: 'summarize plus extract' },
  { expectedTier: 'standard', prompt: 'Pull the service plan from Planning Center and write a run-of-show for the tech team.', why: 'PCO fetch plus writing' },
  { expectedTier: 'standard', prompt: 'Write a unit test for the recurring-rule parser that covers weekly and monthly cases.', why: 'routine test writing' },
  { expectedTier: 'standard', prompt: 'Add a notes field to the reservation dialog and wire it to the API in the Flutter view.', why: 'single-feature implementation' },
  { expectedTier: 'standard', prompt: 'Plan next week\'s staff schedule around the two facility reservations and the Wednesday youth night.', why: 'weekly-planner task; "plan" overlaps frontier wording' },
  { expectedTier: 'standard', prompt: 'The rhythms list shows duplicates after I edit a step. Find and fix the bug in rhythms_controller.dart.', why: 'routine bug; "bug" overlaps frontier debugging wording' },
  // ---- frontier (6) ----
  { expectedTier: 'frontier', prompt: 'Why does sync lose data?', why: 'SHORT but open-ended distributed-systems debugging' },
  { expectedTier: 'frontier', prompt: 'Design how offline edits in the Flutter app should merge with the production Postgres API when two staff edit the same task, including conflict rules and a migration plan.', why: 'architecture with trade-offs' },
  { expectedTier: 'frontier', prompt: 'Tasks created by the recurring-rule scheduler occasionally appear twice, only after the server restarts near midnight, and only for weekly rules. Find the root cause across the scheduler, repository and migrations.', why: 'difficult multi-file debugging' },
  { expectedTier: 'frontier', prompt: 'Refactor the agent session layer so the local agent server and the production API share one auth and capability model without coupling their base URLs. Propose the plan, then outline the risks.', why: 'large refactor with planning' },
  { expectedTier: 'frontier', prompt: 'Review our OAuth token storage for PCO and Google for security weaknesses and rank them by exploitability.', why: 'security review' },
  { expectedTier: 'frontier', prompt: 'Should we consolidate Messages and email into one inbox, or keep them separate? Weigh staff workflows, the PCO integration and our small team before recommending.', why: 'ambiguous product judgement call' },
];
