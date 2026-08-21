import { defineConfig } from 'tsup';

// Produces both ESM and CJS builds plus .d.ts declarations under dist/, so a consumer can
// resolve this package with plain Node/bundler module resolution instead of importing raw
// .ts/.tsx from src/ (see F3 in the M1 repair review). react/react-dom stay external — they
// are peer dependencies the host provides; bundling them would create a second React
// instance in the host's tree, exactly what the singleton-react contract forbids.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client'],
});
