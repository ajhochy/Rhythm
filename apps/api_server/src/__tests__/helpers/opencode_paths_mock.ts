import fs from 'node:fs';
import path from 'node:path';
import { inject } from 'vitest';

// Provided by vitest.global-setup.ts (outside tsconfig's src/ include).
declare module 'vitest' {
  export interface ProvidedContext {
    rhythmTestRunRoot: string;
  }
}

// Hermetic stand-ins for config/env's opencode path helpers, for tests that
// replace that module with a hand-written mock. Spreading the real module
// instead would resolve the developer's real ~/.config/opencode and
// ~/.local/share/opencode. Lives under the global run root, removed at teardown.
const root = fs.mkdtempSync(path.join(inject('rhythmTestRunRoot'), 'opencode-paths-'));

export const opencodePathMocks = {
  opencodeDataFile: (name: string) => path.join(root, 'data', 'opencode', name),
  opencodeConfigFile: () => path.join(root, 'config', 'opencode', 'opencode.json'),
};
