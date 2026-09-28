import { SharedAgentsScreen } from '@ajhochy/rhythm-workspace-ui';
import '@ajhochy/rhythm-workspace-ui/styles/rhythm.css';
import { useGateway } from '../../gateway/context';

export function SharedAgentsTool() {
  const gateway = useGateway();
  const port = gateway.domains.sharedAgents;
  if (!port) return <section className="tool-state-panel warning" role="status" data-testid="shared-agents-unavailable"><h1>Shared Agents</h1><p>The shared-agent catalog is available only from the authenticated local runtime.</p></section>;
  return <SharedAgentsScreen port={port} viewport={window.innerWidth <= 720 ? 'compact' : 'regular'} />;
}
