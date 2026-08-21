import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Runs the identical contract suite against a second, independently pinned React 19.2
// runtime (aliased devDependencies "react19"/"react-dom19", nested into each other's
// node_modules by scripts/link-react19.mjs on postinstall) to prove the package holds to
// its "React 18.3/19.2 peer compatibility, one host-owned singleton" contract instead of
// only ever having been exercised against whichever React the workspace happens to hoist.
const resolve = (specifier: string) => fileURLToPath(new URL(`./node_modules/${specifier}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      'react/jsx-dev-runtime': resolve('react19/jsx-dev-runtime.js'),
      'react/jsx-runtime': resolve('react19/jsx-runtime.js'),
      'react-dom/client': resolve('react-dom19/client.js'),
      'react-dom/server': resolve('react-dom19/server.js'),
      'react-dom': resolve('react-dom19/index.js'),
      react: resolve('react19/index.js'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.tsx', 'tests/**/*.test.ts'],
  },
});
