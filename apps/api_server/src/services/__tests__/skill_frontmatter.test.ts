/**
 * skill_frontmatter.test.ts — #874/#875/#876 shared parser contract.
 */
import { describe, it, expect } from 'vitest';
import { parseSkillFrontmatter } from '../skill_frontmatter';

describe('parseSkillFrontmatter', () => {
  it('returns all-empty extended fields for a plain name/description skill (regression)', () => {
    const md = ['---', 'name: my-skill', 'description: "Does a thing"', '---', '', '# Body', ''].join('\n');
    const fm = parseSkillFrontmatter(md);
    expect(fm.name).toBe('my-skill');
    expect(fm.description).toBe('Does a thing');
    expect(fm.requiredEnv).toEqual([]);
    expect(fm.requiresToolsets).toEqual([]);
    expect(fm.fallbackForToolsets).toEqual([]);
    expect(fm.pythonDependencies).toEqual([]);
  });

  it('returns empty fields for content with no frontmatter block at all', () => {
    const fm = parseSkillFrontmatter('# Just a markdown file\n\nNo frontmatter here.');
    expect(fm.requiredEnv).toEqual([]);
    expect(fm.requiresToolsets).toEqual([]);
    expect(fm.fallbackForToolsets).toEqual([]);
    expect(fm.pythonDependencies).toEqual([]);
  });

  it('never throws on malformed/garbage frontmatter', () => {
    const md = ['---', 'required_environment_variables: [', 'metadata: {{{', '---', 'body'].join('\n');
    expect(() => parseSkillFrontmatter(md)).not.toThrow();
  });

  // ── #874 — required_environment_variables ────────────────────────────────

  it('#874: parses a required_environment_variables list with prompt + help', () => {
    const md = [
      '---',
      'name: gif-search',
      'required_environment_variables:',
      '  - name: TENOR_API_KEY',
      '    prompt: "Your Tenor API key"',
      '    help: "Get one free at https://developers.google.com/tenor"',
      '---',
      '',
      'body',
    ].join('\n');
    const fm = parseSkillFrontmatter(md);
    expect(fm.requiredEnv).toEqual([
      {
        name: 'TENOR_API_KEY',
        prompt: 'Your Tenor API key',
        help: 'Get one free at https://developers.google.com/tenor',
      },
    ]);
  });

  it('#874: parses multiple required_environment_variables entries', () => {
    const md = [
      '---',
      'name: multi-key',
      'required_environment_variables:',
      '  - name: FOO_KEY',
      '  - name: BAR_KEY',
      '    prompt: "Bar key"',
      '---',
      'body',
    ].join('\n');
    const fm = parseSkillFrontmatter(md);
    expect(fm.requiredEnv).toEqual([{ name: 'FOO_KEY' }, { name: 'BAR_KEY', prompt: 'Bar key' }]);
  });

  it('#874: a skill with no required_environment_variables field parses to []', () => {
    const md = ['---', 'name: plain', 'description: "no env needed"', '---', 'body'].join('\n');
    expect(parseSkillFrontmatter(md).requiredEnv).toEqual([]);
  });

  // ── #875 — metadata.rhythm toolset conditions ────────────────────────────

  it('#875: parses requires_toolsets and fallback_for_toolsets under metadata.rhythm', () => {
    const md = [
      '---',
      'name: terminal-automation',
      'metadata:',
      '  rhythm:',
      '    requires_toolsets: [terminal]',
      '---',
      'body',
    ].join('\n');
    const fm = parseSkillFrontmatter(md);
    expect(fm.requiresToolsets).toEqual(['terminal']);
    expect(fm.fallbackForToolsets).toEqual([]);
  });

  it('#875: parses fallback_for_toolsets alone', () => {
    const md = [
      '---',
      'name: duckduckgo-fallback',
      'metadata:',
      '  rhythm:',
      '    fallback_for_toolsets: [web]',
      '---',
      'body',
    ].join('\n');
    const fm = parseSkillFrontmatter(md);
    expect(fm.fallbackForToolsets).toEqual(['web']);
    expect(fm.requiresToolsets).toEqual([]);
  });

  it('#875: parses both fields together with multiple entries', () => {
    const md = [
      '---',
      'name: dual-condition',
      'metadata:',
      '  rhythm:',
      '    requires_toolsets: [terminal, browser]',
      '    fallback_for_toolsets: [web]',
      '---',
      'body',
    ].join('\n');
    const fm = parseSkillFrontmatter(md);
    expect(fm.requiresToolsets).toEqual(['terminal', 'browser']);
    expect(fm.fallbackForToolsets).toEqual(['web']);
  });

  it('#875: a skill with no metadata.rhythm block parses to empty toolset arrays', () => {
    const md = ['---', 'name: plain', '---', 'body'].join('\n');
    const fm = parseSkillFrontmatter(md);
    expect(fm.requiresToolsets).toEqual([]);
    expect(fm.fallbackForToolsets).toEqual([]);
  });

  // ── #876 — python_dependencies ────────────────────────────────────────────

  it('#876: parses python_dependencies with package + version', () => {
    const md = [
      '---',
      'name: httpx-user',
      'python_dependencies:',
      '  - package: "httpx"',
      '    version: ">=0.27"',
      '  - package: "pandas"',
      '    version: ">=2.0"',
      '---',
      'body',
    ].join('\n');
    const fm = parseSkillFrontmatter(md);
    expect(fm.pythonDependencies).toEqual([
      { package: 'httpx', version: '>=0.27' },
      { package: 'pandas', version: '>=2.0' },
    ]);
  });

  it('#876: a skill with no python_dependencies field parses to []', () => {
    const md = ['---', 'name: plain', '---', 'body'].join('\n');
    expect(parseSkillFrontmatter(md).pythonDependencies).toEqual([]);
  });
});
