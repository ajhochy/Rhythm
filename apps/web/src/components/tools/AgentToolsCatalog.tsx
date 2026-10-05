import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentToolDescriptor } from '../../agentTools/registry';
import { AGENT_TOOL_DESCRIPTORS } from '../../agentTools/registry';
import { readAgentToolPins, resetAgentToolPins, subscribeAgentToolPins, toggleAgentToolPin, type AgentToolPinScope } from '../../agentTools/pins';
import './AgentToolsCatalog.css';

export type AgentToolsCatalogProps = {
  availableIds?: readonly string[];
  scope?: AgentToolPinScope;
  onOpen?: (tool: AgentToolDescriptor) => void;
  onPinnedChange?: (ids: string[]) => void;
};

export function AgentToolsCatalog({ availableIds, scope, onOpen, onPinnedChange }: AgentToolsCatalogProps) {
  const [stored, setStored] = useState(() => readAgentToolPins(scope));
  // Never render (or toggle from) another owner's pins while a scope change settles.
  const preference = stored.scope === scope ? stored : readAgentToolPins(scope);
  const available = useMemo(() => availableIds ? new Set(availableIds) : null, [availableIds]);
  const refresh = useCallback(() => setStored(readAgentToolPins(scope)), [scope]);
  useEffect(() => {
    refresh();
    return subscribeAgentToolPins(scope, refresh);
  }, [refresh, scope]);
  const toggle = useCallback((id: string) => {
    const next = toggleAgentToolPin(scope, id);
    setStored(next);
    if (!next.error) onPinnedChange?.(next.ids);
  }, [onPinnedChange, scope]);
  const reset = useCallback(() => {
    if (!resetAgentToolPins(scope).ok) { setStored({ ...readAgentToolPins(scope), error: true }); return; }
    const restored = readAgentToolPins(scope);
    setStored(restored);
    onPinnedChange?.(restored.ids);
  }, [onPinnedChange, scope]);
  const open = useCallback((tool: AgentToolDescriptor) => {
    if (available && !available.has(tool.id)) return;
    if (onOpen) { onOpen(tool); return; }
    window.location.hash = tool.route;
  }, [available, onOpen]);
  return <section className="agent-tools-catalog" aria-label="Agent Tools" data-testid="agent-tools-catalog">
    <header><div><p className="eyebrow">Agent Tools</p><h2>Choose a workspace</h2><p>Open a tool when you need it. Pinned tools add shortcuts without removing your existing tabs.</p></div><button type="button" className="secondary-button" onClick={reset} data-testid="agent-tools-reset-pins">Reset pins</button></header>
    {preference.error ? <p className="agent-tools-preference-error" role="status">Pin preferences can’t be saved on this device. Your selection may not persist.</p> : null}
    <div className="agent-tools-grid">
      {AGENT_TOOL_DESCRIPTORS.map((tool) => {
        const isAvailable = !available || available.has(tool.id);
        const pinned = preference.ids.includes(tool.id);
        return <article className="agent-tool-card" key={tool.id} data-testid={`agent-tool-${tool.id}`}>
          <div><h3>{tool.label}</h3><p>{tool.description}</p></div>
          {!isAvailable ? <p className="agent-tool-unavailable" role="status">Not available in this version of Rhythm.</p> : null}
          <div className="agent-tool-actions">
            <button type="button" className="primary-button" disabled={!isAvailable} onClick={() => open(tool)}>Open</button>
            <label className="agent-tool-pin"><input type="checkbox" checked={pinned} onChange={() => toggle(tool.id)} data-testid={`agent-tool-pin-${tool.id}`} /> Pin to tabs</label>
          </div>
        </article>;
      })}
    </div>
  </section>;
}
