import {
  decodePlainTextEntities,
  normalizeResearchMarkdown,
} from '@/components/tools/tool-display-text';

test('email preview text decodes ordinary entities as text without parsing HTML', () => {
  expect(decodePlainTextEntities('We haven&#39;t &amp; we&lt;never&gt; run &quot;HTML&quot;.'))
    .toBe('We haven\'t & we<never> run "HTML".');
  expect(decodePlainTextEntities('&#x1F44B; &#128075;')).toBe('👋 👋');
});

test('research display normalizes tables and markdown links without creating an action', () => {
  const text = normalizeResearchMarkdown([
    '## Findings',
    '| Finding | Assessment |',
    '|---|---|',
    '| [MCP SDK](https://example.test/releases) | Review credentials. |',
  ].join('\n'));

  expect(text).toContain('## Findings');
  expect(text).toContain('**Finding:** MCP SDK (https://example.test/releases)');
  expect(text).toContain('Assessment: Review credentials.');
  expect(text).not.toContain('|');
  expect(text).not.toContain('[MCP SDK](');
});
