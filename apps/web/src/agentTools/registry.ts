// Keep renderer metadata identical to the native host metadata. The imported
// module is intentionally browser-safe and has no Node or plugin-loading code.
export {
  AGENT_TOOL_DESCRIPTORS,
  AGENT_TOOLS_CATALOG_ROUTE,
  createAgentToolAdapterRegistry,
  findAgentTool,
  registerAgentToolAdapter,
} from '../../../electron/src/rhythm-agent-tools.mjs';
export type { AgentToolDescriptor } from '../../../electron/src/rhythm-agent-tools.mjs';
