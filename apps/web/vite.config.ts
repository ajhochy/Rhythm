import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev server only: let a browser session reach an isolated sandbox API/engine
 * (e.g. tools/dev/sandbox.sh on 4098/4097) that the shipped CSP, pinned to the
 * live 4001/4096 ports, would block. Builds keep index.html's CSP unchanged.
 */
function devSandboxConnectSrc(): Plugin {
  const origins = [process.env.VITE_RHYTHM_API_BASE, process.env.VITE_RHYTHM_ENGINE_BASE]
    .flatMap((base) => (base ? [new URL(base).origin] : []))
    .flatMap((origin) => [origin, origin.replace(/^http/, 'ws')]);
  return {
    name: 'rhythm-dev-sandbox-connect-src',
    apply: 'serve',
    transformIndexHtml: (html) => origins.length
      ? html.replace('connect-src ', `connect-src ${origins.join(' ')} `)
      : html,
  };
}

// Live-mode proxy/middleware wiring is paused; the canceled partial config is
// preserved at docs/ai/paused-live-mode/vite.config.live.ts.txt.
export default defineConfig({
  base: './',
  cacheDir: '.vite',
  plugins: [react(), devSandboxConnectSrc()],
  resolve: {
    alias: { '@ajhochy/rhythm-workspace-ui': fileURLToPath(new URL('../../packages/rhythm-workspace-ui/src', import.meta.url)) },
    dedupe: ['react', 'react-dom', 'lucide-react'],
  },
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
