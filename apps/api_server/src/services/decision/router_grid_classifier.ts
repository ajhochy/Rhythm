import { getOpenAIDecisionsClient, type DecisionQuestion, type OpenAIDecisionsClient } from './openai_decisions_client';
import type { GridCategory, GridTier, RouterGridConfig } from './router_grid_config';

export interface GridClassification {
  tier: GridTier; category: GridCategory; canQueue: boolean; securitySensitive: boolean; estInputTokens: number;
}
export interface GridClassificationResult extends GridClassification {
  source: 'decisions' | 'rules'; reason: string;
}
export const GRID_CLASSIFIER_QUESTIONS: DecisionQuestion[] = [
  { type: 'score', name: 'tier', instructions: 'The input is a request a person sent to their AI assistant, which can use tools (files, email, calendar, web, code, other agents). Pick the LOWEST tier whose model will reliably do this request well. Judge the work it requires, not the length of the message or its subject area. When unsure between two tiers, pick the higher (harder) one.', levels: [
    { label: 'tier4', description: 'classify, extract, tag, route, reformat, summarize short text, simple lookups' },
    { label: 'tier3', description: 'single-file edits, routine emails/docs, straightforward Q&A, small UI tweaks' },
    { label: 'tier2', description: 'multi-file features, research write-ups, standard UI components/pages, moderate analysis' },
    { label: 'tier1', description: 'architecture, hard debugging, long-running agent work, polished design deliverables, high-stakes documents, anything a tier 2 would likely fail' },
  ] },
  // Calibrated wording (2026-10-08, 50 real first prompts); the API keys choices by `value`.
  { type: 'choice', name: 'category', instructions: 'What kind of task is this?', choices: [
    { value: 'coding', description: 'writing, editing, debugging, reviewing, or explaining code; terminal/devops work' },
    { value: 'design', description: 'front-end UI, web pages, components, visual layout, SVG/graphics, slides styling' },
    { value: 'knowledge', description: 'writing, research, analysis, documents, email, planning, data interpretation' },
  ] },
  { type: 'predicate', name: 'can_queue', instructions: 'Could this task wait several hours without harm?' },
  { type: 'predicate', name: 'security_sensitive', instructions: 'Is this vulnerability research, exploit analysis, or offensive security?' },
];
// ponytail: chars/3 over-estimates tokens on purpose (surcharge skips must not be missed); swap in a
// tokenizer if routing ever needs exact counts.
export function estimateInputTokens(prompt: string): number {
  return Math.ceil(prompt.length / 3);
}
export function gridTierFromScore(score: number, thresholds: readonly number[]): GridTier {
  return (4 - thresholds.filter(t => score >= t).length) as GridTier;
}
export function rulesGridClassification(prompt: string, config: RouterGridConfig, reason: string): GridClassificationResult {
  const category: GridCategory = /\b(code|coding|debug|bug|software|typescript|javascript|python|refactor|repository)\b/i.test(prompt) ? 'coding'
    : /\b(design|visual|ui|ux|layout|brand|logo)\b/i.test(prompt) ? 'design' : 'knowledge';
  // Fail safe: without a classifier, security-looking work is treated as security-sensitive.
  const securitySensitive = /\b(vulnerab\w*|exploit\w*|cve-\d|pentest\w*|malware|privilege escalation)\b/i.test(prompt);
  return { tier: config.classifier.rules_default_tier, category, canQueue: false, securitySensitive,
    estInputTokens: estimateInputTokens(prompt), source: 'rules', reason };
}
export async function classifyRouterGrid(prompt: string, config: RouterGridConfig, client?: OpenAIDecisionsClient): Promise<GridClassificationResult> {
  const estInputTokens = estimateInputTokens(prompt);
  try {
    const r = await (client ?? getOpenAIDecisionsClient()).decide(prompt, GRID_CLASSIFIER_QUESTIONS, config.classifier.model);
    if (r.status !== 'ok') return rulesGridClassification(prompt, config, r.reason);
    const [tier, category, queue, security] = r.answers;
    if (tier.type !== 'score' || category.type !== 'choice' || queue.type !== 'predicate' || security.type !== 'predicate') return rulesGridClassification(prompt, config, 'malformed_response');
    return { tier: gridTierFromScore(tier.score, config.classifier.tier_thresholds), category: category.choice as GridCategory,
      canQueue: queue.probability >= config.classifier.can_queue_min_p, securitySensitive: security.probability >= config.classifier.security_min_p,
      estInputTokens, source: 'decisions', reason: 'ok' };
  } catch {
    return rulesGridClassification(prompt, config, 'request_failed');
  }
}
