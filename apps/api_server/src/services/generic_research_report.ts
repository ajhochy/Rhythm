import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveMemoryVaultPath } from '../config/env';

export const GENERIC_RESEARCH_REPORTS_ROOT = 'Areas/Research/General/Reports';

function reportSlug(topic: string): string {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'research';
}

function oneLineSummary(report: string): string {
  return report.replace(/^#+\s*/m, '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

export async function writeGenericResearchReport(input: { jobId: string; topic: string; report: string }): Promise<string> {
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${date}-${reportSlug(input.topic)}.md`;
  const root = path.join(resolveMemoryVaultPath(), GENERIC_RESEARCH_REPORTS_ROOT);
  const output = path.join(root, filename);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(output, [
    '---',
    `summary: ${JSON.stringify(oneLineSummary(input.report))}`,
    `job_id: ${JSON.stringify(input.jobId)}`,
    '---',
    `# ${input.topic}`,
    '',
    input.report.trim(),
    '',
  ].join('\n'), 'utf8');
  return output;
}
