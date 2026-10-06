/**
 * Static metadata shared by the shell and renderer. This is deliberately a
 * browser-safe module: it contains no Node imports, dynamic loading, or host
 * execution authority.
 */
const descriptor = (value) => Object.freeze({
  ...value,
  capabilities: Object.freeze([...value.capabilities]),
  permissions: Object.freeze([...value.permissions]),
});

/** Builder-owned ToolWorkspace slug that renders the catalog. */
export const AGENT_TOOLS_CATALOG_ROUTE = '/tools/agent-tools';

// Hermes/Bot Crossing are existing App.tsx routes; OpenDesign is this slice's
// page. Dayflow is the ToolWorkspace slug `dayflow` (named export `DayflowTool`)
// backed by the Rhythm-owned native view (`dayflowView` facade). The legacy
// external-app opener (`dayflowDesktop`) is a separate explicit action. The
// permanent coordinator is intentionally absent.
export const AGENT_TOOL_DESCRIPTORS = Object.freeze([
  descriptor({ id: 'hermes', label: 'Hermes', route: '/hermes', description: 'Coordinate conversations and workspace work in Hermes.', service: 'bundled Hermes Desktop host', artifact: 'signed Rhythm Hermes Desktop artifact', lifecycle: 'Rhythm-owned native view', capabilities: ['conversation workspace', 'draft handoff'], permissions: ['Rhythm session access'], defaultPinned: true }),
  descriptor({ id: 'bot-crossing', label: 'Bot Crossing', route: '/colony', description: 'Review local agent activity in Bot Crossing.', service: 'Rhythm-owned Bot Crossing host', artifact: 'signed Bot Crossing artifact', lifecycle: 'Rhythm-owned native view', capabilities: ['local activity inventory', 'session navigation'], permissions: ['local profile access'], defaultPinned: true }),
  descriptor({ id: 'open-design', label: 'OpenDesign', route: '/open-design', description: 'Work on designs in your OpenDesign workspace.', service: 'installed OpenDesign local service', artifact: 'installed OpenDesign application', lifecycle: 'externally owned service, Rhythm-owned view', capabilities: ['design workspace'], permissions: ['verified loopback display only'], defaultPinned: true }),
  descriptor({ id: 'dayflow', label: 'Dayflow', route: '/tools/dayflow', description: 'Review your day in the original Dayflow, embedded in Rhythm.', service: 'Rhythm-owned native Dayflow (original SwiftUI and services)', artifact: 'signed Rhythm native Dayflow module', lifecycle: 'Rhythm-owned native view', capabilities: ['Dayflow timeline and services'], permissions: ['user-granted macOS permissions at use'], defaultPinned: false }),
]);

const knownIds = new Set(AGENT_TOOL_DESCRIPTORS.map((tool) => tool.id));

/** Creates a closed registration map; adapters are supplied by explicit shell hooks only. */
export function createAgentToolAdapterRegistry() {
  return new Map();
}

/**
 * @template T
 * @param {Map<string, T>} registry
 * @param {string} id
 * @param {T} adapter
 * @returns {T}
 */
export function registerAgentToolAdapter(registry, id, adapter) {
  if (!(registry instanceof Map)) throw new TypeError('Agent Tool adapter registry is invalid.');
  if (!knownIds.has(id)) throw new Error('Only known Agent Tool IDs may be registered.');
  if (registry.has(id)) throw new Error('This Agent Tool adapter is already registered.');
  if (!adapter || (typeof adapter !== 'object' && typeof adapter !== 'function')) throw new TypeError('Agent Tool adapter is invalid.');
  registry.set(id, adapter);
  return adapter;
}

export function findAgentTool(id) {
  return AGENT_TOOL_DESCRIPTORS.find((tool) => tool.id === id) ?? null;
}
