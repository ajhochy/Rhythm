import { Router } from 'express';

import { register as registerAgentsPatch } from '../shared_agents/bridge/agents_patch';
import { register as registerCatalog } from '../shared_agents/bridge/catalog';
import {
  defaultBridgeDeps,
  registerBodyParser,
  registerTerminalHandlers,
  type BridgeDeps,
} from '../shared_agents/bridge/common';
import { register as registerDelegation } from '../shared_agents/bridge/delegation';
import { register as registerMemory } from '../shared_agents/bridge/memory';
import { register as registerProjections } from '../shared_agents/bridge/projections';
import { register as registerRegistrar } from '../shared_agents/bridge/registrar';
import { register as registerRuntime } from '../shared_agents/bridge/runtime';

export function createAgentBridgeRouter(
  deps: BridgeDeps = defaultBridgeDeps,
): Router {
  const router = Router();

  registerBodyParser(router);
  registerRegistrar(router, deps);
  registerRuntime(router, deps);
  registerCatalog(router, deps);
  registerProjections(router, deps);
  registerAgentsPatch(router, deps);
  registerDelegation(router, deps);
  registerMemory(router, deps);
  registerTerminalHandlers(router, deps);

  return router;
}
