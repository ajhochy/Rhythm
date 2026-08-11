import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // *.contract.test.mjs are pre-implementation harnesses run by `node --test`.
    // Vitest's default include matches .mjs and fails them with "No test suite
    // found", so it must skip them — they are not vitest suites.
    exclude: [...configDefaults.exclude, '**/*.contract.test.mjs'],
  },
});
