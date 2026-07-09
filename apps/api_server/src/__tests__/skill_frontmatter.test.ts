/**
 * Tests for skill_frontmatter.ts's #929 harvest-metadata scalar fields
 * (status/source/provenance/source_session/confidence/extracted_at/
 * evaluated_at/post_score/measure_reason) and stripFrontmatterBlock. The
 * pre-existing #874/#875/#876 fields (requiredEnv/toolsets/pythonDependencies)
 * are untouched and already exercised by their own feature's tests.
 */

import { describe, expect, it } from 'vitest';
import { parseSkillFrontmatter, stripFrontmatterBlock } from '../services/skill_frontmatter';
import { renderDraftSkillMarkdown } from '../services/rhythm_managed_skills';

describe('parseSkillFrontmatter — #929 harvest scalars', () => {
  it('parses every harvest-lifecycle field from a freshly-written draft', () => {
    const md = renderDraftSkillMarkdown({
      name: 'rebuild-abi',
      description: 'Rebuild the native module ABI',
      body: '# Rebuild ABI\n\nSteps...\n',
      sourceSessionId: 'sess-1',
      confidence: 0.85,
      provenance: 'auto-extract',
      extractedAt: '2026-07-08T00:00:00.000Z',
    });

    const fm = parseSkillFrontmatter(md);
    expect(fm.name).toBe('rebuild-abi');
    expect(fm.description).toBe('Rebuild the native module ABI');
    expect(fm.status).toBe('draft');
    expect(fm.source).toBe('harvested');
    expect(fm.provenance).toBe('auto-extract');
    expect(fm.sourceSession).toBe('sess-1');
    expect(fm.confidence).toBe(0.85);
    expect(fm.extractedAt).toBe('2026-07-08T00:00:00.000Z');
    expect(fm.evaluatedAt).toBeUndefined();
    expect(fm.postScore).toBeUndefined();
    expect(fm.measureReason).toBeUndefined();
  });

  it('parses the evaluation ledger fields once a draft has been evaluated', () => {
    const md = renderDraftSkillMarkdown({
      name: 'rebuild-abi',
      body: '# Rebuild ABI\n',
      sourceSessionId: 'sess-1',
      confidence: 0.85,
      status: 'rewrite-needed',
      evaluatedAt: '2026-07-09T00:00:00.000Z',
      postScore: 45,
      measureReason: 'covers the purpose at a basic level; missing edge cases',
    });

    const fm = parseSkillFrontmatter(md);
    expect(fm.status).toBe('rewrite-needed');
    expect(fm.evaluatedAt).toBe('2026-07-09T00:00:00.000Z');
    expect(fm.postScore).toBe(45);
    expect(fm.measureReason).toBe('covers the purpose at a basic level; missing edge cases');
  });

  it('leaves harvest fields undefined for an ordinary (non-draft) skill', () => {
    const fm = parseSkillFrontmatter('---\nname: some-skill\ndescription: "does a thing"\n---\n\nbody\n');
    expect(fm.status).toBeUndefined();
    expect(fm.source).toBeUndefined();
    expect(fm.confidence).toBeUndefined();
  });
});

describe('stripFrontmatterBlock', () => {
  it('returns only the body when frontmatter is present (callers .trim() the leading blank line)', () => {
    const content = '---\nname: x\n---\n\n# Body\n\ntext\n';
    // The regex consumes exactly one trailing newline after the closing `---`;
    // a SKILL.md's conventional blank separator line survives as a leading
    // '\n' here — every real caller (readDraftSkill/readDisabledSkill) trims it.
    expect(stripFrontmatterBlock(content)).toBe('\n# Body\n\ntext\n');
    expect(stripFrontmatterBlock(content).trim()).toBe('# Body\n\ntext');
  });

  it('returns the content unchanged when there is no frontmatter block', () => {
    expect(stripFrontmatterBlock('# Just a body\n')).toBe('# Just a body\n');
  });
});
