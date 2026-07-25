import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { writeGenericResearchReport } from '../generic_research_report';

describe('writeGenericResearchReport', () => {
  let vault = '';

  afterEach(() => {
    delete process.env.MEMORY_VAULT_PATH;
    if (vault) rmSync(vault, { recursive: true, force: true });
  });

  it('writes a dated generic report with a one-line summary', async () => {
    vault = mkdtempSync(path.join(tmpdir(), 'generic-research-'));
    process.env.MEMORY_VAULT_PATH = vault;
    const output = await writeGenericResearchReport({
      jobId: 'job-1', topic: 'Local first software', report: '# Finding\n\nA cited finding.',
    });
    expect(output).toMatch(/Areas\/Research\/General\/Reports\/\d{4}-\d{2}-\d{2}-local-first-software\.md$/);
    expect(readFileSync(output, 'utf8')).toContain('summary: "Finding A cited finding."');
  });
});
