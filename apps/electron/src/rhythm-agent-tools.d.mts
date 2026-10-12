export type AgentToolDescriptor = Readonly<{
  id: 'hermes' | 'bot-crossing' | 'open-design' | 'dayflow';
  label: string;
  route: string;
  description: string;
  service: string;
  artifact: string;
  lifecycle: string;
  capabilities: readonly string[];
  permissions: readonly string[];
  defaultPinned: boolean;
}>;
export const AGENT_TOOLS_CATALOG_ROUTE: '/tools/agent-tools';
export const AGENT_TOOL_DESCRIPTORS: readonly AgentToolDescriptor[];
export function createAgentToolAdapterRegistry<T = unknown>(): Map<string, T>;
export function registerAgentToolAdapter<T>(registry: Map<string, T>, id: AgentToolDescriptor['id'], adapter: T): T;
export function findAgentTool(id: string): AgentToolDescriptor | null;
