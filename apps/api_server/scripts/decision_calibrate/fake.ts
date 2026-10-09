import type { RerankClient, RerankResult } from '../../src/services/decision/decision_client';
import { tokenize } from '../../src/services/decision/calibration_analysis';

/** Deterministic token-overlap scorer: exercises the pipeline only, says nothing about model quality. */
export class FakeRerankClient implements RerankClient {
  async rerank(query: string, documents: string[]): Promise<RerankResult> {
    const q = new Set(tokenize(query));
    const scores = documents.map((d) => {
      let common = 0;
      for (const t of new Set(tokenize(d))) if (q.has(t)) common++;
      return common / (common + 1.5);
    });
    return { status: 'ok', scores, latencyMs: 0, model: 'fake-token-overlap' };
  }
}
