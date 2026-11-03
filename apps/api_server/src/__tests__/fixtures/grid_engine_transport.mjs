import { createRequire } from 'node:module';
const { install } = createRequire(import.meta.url)('./grid_transport_guard.cjs');
// Module evaluation installs before hooks/sessions; no auth/provider/chat hooks replace native behavior.
const guard = install('engine');
await guard.ready;
export default async function GridLocalTransport(input) {
  if (input.serverUrl.port !== '4397') throw new Error('GRID_ENGINE_PORT_REFUSED');
  return {};
}
