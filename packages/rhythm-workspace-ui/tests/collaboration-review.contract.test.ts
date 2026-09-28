import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('issue-4 review contracts', () => {
  it('publishes collaboration selectors through the consumer stylesheet entry', async () => {
    // Regression: consumers importing @ajhochy/rhythm-workspace-ui/styles.css received no
    // layout rules for these four extracted screens. Resolve the source import chain here so
    // this contract also runs in the isolated React 19 matrix before any build artifacts exist;
    // the package/consumer gate separately verifies that the same tree is copied to dist.
    const resolveConsumerCss = async (file: string): Promise<string> => {
      const css = await readFile(file, 'utf8');
      const imports = [...css.matchAll(/@import\s+['\"](.+?)['\"];/g)];
      const imported = await Promise.all(imports.map((match) => resolveConsumerCss(resolve(dirname(file), match[1]!))));
      return `${css}\n${imported.join('\n')}`;
    };
    const stylesheet = await resolveConsumerCss(resolve(process.cwd(), 'src/styles/rhythm.css'));
    for (const selector of ['.pg-planner', '.pg-projects', '.pg-rhythms', '.pg-messages']) {
      expect(stylesheet).toContain(`.rhythm-workspace-root ${selector}`);
    }
  });
});
