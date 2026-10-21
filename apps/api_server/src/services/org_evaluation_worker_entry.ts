/** Private child entry point. The parent invokes this only through sandbox-exec. */
import { readFileSync } from 'node:fs';
import {
  executeOrgEvaluationTaskAsync,
  materializeOrgEvaluationCandidateAsync,
  type EvaluationExecuteRequest,
  type EvaluationMaterializeRequest,
} from './org_evaluation_worker';

async function main(): Promise<void> {
  if (process.env.RHYTHM_EVALUATION_WORKER !== '1') {
    throw new Error('Evaluation worker entry requires an isolated environment');
  }
  const bytes = readFileSync(0);
  if (bytes.length > 256_000) throw new Error('Evaluation worker request is too large');
  const request = JSON.parse(bytes.toString('utf8')) as
    (EvaluationMaterializeRequest & { mode?: 'materialize' }) |
    (EvaluationExecuteRequest & { mode: 'execute' });
  const result = request.mode === 'execute'
    ? await executeOrgEvaluationTaskAsync(request)
    : await materializeOrgEvaluationCandidateAsync(request);
  process.stdout.write(`RHYTHM_EVALUATION_RESULT:${JSON.stringify(result)}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`Evaluation worker failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
