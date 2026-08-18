#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const statuses = new Set(['planned', 'review_required', 'covered', 'deferred']);
export const layers = new Set(['unit', 'integration', 'ui', 'live', 'manual']);
export const dispositions = new Set(['retained_unit', 'retained_integration', 'retained_ui', 'manual_check', 'review_required', 'deferred']);
export const requiredTaxonomy = new Set([
  'launch-auth-onboarding', 'nav-a11y', 'dashboard-planner-tasks-rhythms-projects-messages-facilities-automations-integrations',
  'profiles-providers-models', 'sessions-composer-attachments-stream-retry-cancel-reconnect-transcript',
  'permissions-questions-approvals-delegation', 'files-search-diffs-worktrees', 'mcp-skills-commands',
  'memory-research-gallery-playbooks-cookbook-schedules-run-quality', 'notifications', 'live-artifacts',
  'mobile-pairing-cloud-gateway', 'settings-updates', 'electron-windows-dialogs-deep-links-security-process-lifecycle-packaging',
  'empty-loading-error-offline-forbidden', 'ownership-isolation', 'terminal-pty',
]);
const requiredBehavior = ['behaviorId', 'taxonomy', 'actor', 'precondition', 'action', 'outcome', 'failure', 'security', 'layers', 'journeys', 'status', 'owner', 'rationale'];

function parseCsv(text) {
  const lines = text.trimEnd().split('\n');
  if (!lines[0]) return [];
  const columns = lines.shift().split(',');
  return lines.filter(Boolean).map((line, index) => {
    try { const values = JSON.parse(`[${line}]`); return Object.fromEntries(columns.map((column, i) => [column, values[i]])); }
    catch { return { __error: `malformed CSV row ${index + 2}` }; }
  });
}

export function validate({ sources, behaviors, mappings }) {
  const errors = [];
  const unique = (items, field, label) => { const seen = new Set(); for (const item of items) { if (!item[field]) errors.push(`${label} missing ${field}`); else if (seen.has(item[field])) errors.push(`duplicate ${label} ${item[field]}`); else seen.add(item[field]); } return seen; };
  const sourceIds = unique(sources, 'sourceId', 'source');
  const behaviorIds = unique(behaviors.behaviors ?? [], 'behaviorId', 'behavior');
  const mappingIds = unique(mappings, 'sourceId', 'mapping');
  for (const taxonomy of requiredTaxonomy) if (!behaviors.taxonomy?.includes(taxonomy)) errors.push(`missing required taxonomy ${taxonomy}`);
  for (const row of sources) if (!row.surface || !row.path || !row.anchor || !Number.isInteger(row.line) || !row.title || !row.kind || !row.parserLimitations) errors.push(`malformed source ${row.sourceId ?? '<unknown>'}`);
  for (const behavior of behaviors.behaviors ?? []) {
    for (const field of requiredBehavior) if (behavior[field] === undefined || behavior[field] === '' || (Array.isArray(behavior[field]) && !behavior[field].length)) errors.push(`behavior ${behavior.behaviorId ?? '<unknown>'} missing ${field}`);
    if (!behaviors.taxonomy?.includes(behavior.taxonomy)) errors.push(`behavior ${behavior.behaviorId} has unknown taxonomy ${behavior.taxonomy}`);
    if (!statuses.has(behavior.status)) errors.push(`behavior ${behavior.behaviorId} has invalid status ${behavior.status}`);
    if (!Array.isArray(behavior.layers) || behavior.layers.some(layer => !layers.has(layer))) errors.push(`behavior ${behavior.behaviorId} has invalid layer`);
    if (behavior.taxonomy === 'terminal-pty' && behavior.status !== 'deferred') errors.push('Terminal/PTTY must be deferred');
    if (behavior.taxonomy !== 'terminal-pty' && behavior.status === 'deferred') errors.push(`non-Terminal behavior ${behavior.behaviorId} may not be deferred`);
  }
  for (const taxonomy of behaviors.taxonomy ?? []) if (!(behaviors.behaviors ?? []).some(behavior => behavior.taxonomy === taxonomy)) errors.push(`missing taxonomy behavior ${taxonomy}`);
  for (const mapping of mappings) {
    if (mapping.__error) errors.push(mapping.__error);
    if (!sourceIds.has(mapping.sourceId)) errors.push(`mapping references unknown source ${mapping.sourceId}`);
    if (!behaviorIds.has(mapping.behaviorId)) errors.push(`mapping references unknown behavior ${mapping.behaviorId}`);
    if (!dispositions.has(mapping.disposition)) errors.push(`mapping ${mapping.sourceId} has invalid disposition ${mapping.disposition}`);
    if (!mapping.rationale?.trim()) errors.push(`mapping ${mapping.sourceId} lacks rationale`);
    const behavior = (behaviors.behaviors ?? []).find(candidate => candidate.behaviorId === mapping.behaviorId);
    if (behavior?.taxonomy === 'terminal-pty' && mapping.disposition !== 'deferred') errors.push(`Terminal/PTTY mapping ${mapping.sourceId} must be deferred`);
    if (behavior?.taxonomy !== 'terminal-pty' && mapping.disposition === 'deferred') errors.push(`non-Terminal mapping ${mapping.sourceId} may not be deferred`);
  }
  for (const sourceId of sourceIds) if (!mappingIds.has(sourceId)) errors.push(`source missing mapping ${sourceId}`);
  return { errors, counts: { sources: sources.length, mappings: mappings.length, behaviors: (behaviors.behaviors ?? []).length, reviewRequired: mappings.filter(mapping => mapping.disposition === 'review_required').length } };
}

export async function loadAndValidate(directory) {
  const [sourceText, behaviorText, mappingText] = await Promise.all(['source-inventory.jsonl', 'behaviors.json', 'mappings.csv'].map(file => readFile(resolve(directory, file), 'utf8')));
  const sources = sourceText.trim() ? sourceText.trimEnd().split('\n').map((line, index) => { try { return JSON.parse(line); } catch { return { sourceId: `invalid:L${index + 1}` }; } }) : [];
  return validate({ sources, behaviors: JSON.parse(behaviorText), mappings: parseCsv(mappingText) });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const directory = resolve(process.cwd(), process.argv[2] ?? 'docs/ai/coverage/react-electron');
  const result = await loadAndValidate(directory);
  process.stdout.write(`sources=${result.counts.sources} mappings=${result.counts.mappings} behaviors=${result.counts.behaviors} review_required=${result.counts.reviewRequired} errors=${result.errors.length}\n`);
  for (const error of result.errors) process.stderr.write(`ERROR: ${error}\n`);
  process.exitCode = result.errors.length ? 1 : 0;
}
