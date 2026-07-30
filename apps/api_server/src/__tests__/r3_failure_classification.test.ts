/**
 * R3 contract: scheduled infrastructure failures must never fan out into a
 * teacher retry. Regression caught: status='error' alone used to make every
 * unclassified engine/MCP/auth/permission/restart failure teacher-retryable.
 */
import { describe, expect, it } from 'vitest';
import { shouldEscalate } from '../services/agent_runner';

type FailureCategory =
  | 'engine_not_ready'
  | 'required_mcp_unavailable'
  | 'restart_interruption'
  | 'authentication'
  | 'permission'
  | 'infra_config'
  | 'model_quality';

interface FailureClassification {
  category: FailureCategory;
  teacherRetryable: boolean;
}

interface FailureClassifierModule {
  classifyAgentRunFailure(input: {
    error?: unknown;
    errorCode?: string;
    failureCategory?: FailureCategory;
  }): FailureClassification;
}

const classificationModulePath = '../services/agent_run_failure_classification';

async function loadClassifier(): Promise<FailureClassifierModule | null> {
  return import(/* @vite-ignore */ classificationModulePath)
    .then((module) => module as unknown as FailureClassifierModule)
    .catch(() => null);
}

const infrastructureCases: Array<{
  label: string;
  error: string;
  category: Exclude<FailureCategory, 'model_quality'>;
}> = [
  {
    label: 'engine-not-ready',
    error: 'Opencode engine is not initialized (not ready) — no session was created',
    category: 'engine_not_ready',
  },
  {
    label: 'required-MCP-unavailable',
    error: 'AgentRunner: required MCP unavailable: pco-services (needs_auth)',
    category: 'required_mcp_unavailable',
  },
  {
    label: 'restart/interruption',
    error: 'Server restarted — run interrupted',
    category: 'restart_interruption',
  },
  {
    label: 'authentication',
    error: '401 Unauthorized: provider authentication failed',
    category: 'authentication',
  },
  {
    label: 'permission',
    error: '403 Forbidden: permission denied for tool call',
    category: 'permission',
  },
  {
    label: 'other infra/config',
    error: 'Invalid provider/model configuration',
    category: 'infra_config',
  },
];

describe.each(infrastructureCases)(
  'r3-c3: $label failure classification',
  ({ error, category }) => {
    it(`classifies as ${category} and is NON-teacher-retryable`, async () => {
      const classifier = await loadClassifier();
      expect(classifier, 'R3 failure-classification helper must exist').not.toBeNull();
      if (!classifier) return;

      const classified = classifier.classifyAgentRunFailure({ error });
      expect(classified).toEqual({ category, teacherRetryable: false });
      expect(
        shouldEscalate(
          {
            status: 'error',
            error,
            failureCategory: classified.category,
          } as Parameters<typeof shouldEscalate>[0],
          {},
          true,
        ),
      ).toBe(false);
    });
  },
);

describe('r3-c4: teacher escalation is model-quality-only', () => {
  it('keeps an explicit genuine model-quality failure teacher-retryable', async () => {
    const classifier = await loadClassifier();
    expect(classifier, 'R3 failure-classification helper must exist').not.toBeNull();
    if (!classifier) return;

    const classified = classifier.classifyAgentRunFailure({
      error: 'Model response failed the output-quality gate',
      failureCategory: 'model_quality',
    });
    expect(classified).toEqual({
      category: 'model_quality',
      teacherRetryable: true,
    });
    expect(
      shouldEscalate(
        {
          status: 'error',
          error: 'Model response failed the output-quality gate',
          failureCategory: classified.category,
        } as Parameters<typeof shouldEscalate>[0],
        {},
        true,
      ),
    ).toBe(true);
  });
});
