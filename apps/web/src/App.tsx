import { useEffect, useState } from 'react';
import { AgentsWorkspace } from './components/AgentsWorkspace';
import { EndpointMap } from './components/EndpointMap';
import { Icon } from './icons';
import { Profiles } from './components/Profiles';
import { Shell, navigate } from './components/Shell';
import { ToolWorkspace } from './components/ToolWorkspace';
import { LiveArtifactsShell } from './pages/dashboard/LiveArtifactsShell';
import { MobileAccessPage } from './pages/mobile-access';
import { PlannerPage } from './pages/planner';
import { TasksPage } from './pages/tasks';
import { RhythmsPage } from './pages/rhythms';
import { ProjectsPage } from './pages/projects';
import { MessagesPage } from './pages/messages';
import { FacilitiesPage } from './pages/facilities';
import { AutomationsPage } from './pages/automations';
import { IntegrationsPage } from './pages/integrations';
import { EnvironmentReceipt, useGateway } from './gateway/context';
import { useAuthUser } from './gateway/auth';

function useHashRoute() {
  const read = () => (window.location.hash.replace(/^#/, '').split('?')[0] || '/agents');
  const [route, setRoute] = useState(read);
  useEffect(() => { if (!window.location.hash) navigate('/agents'); const onHash = () => setRoute(read()); window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash); }, []);
  return route;
}

// Every destination now renders a real page; unknown routes get a recoverable not-found state.
function RouteNotFound({ path }: { path: string }) {
  return (
    <section className="module-placeholder" aria-labelledby="module-title" data-testid="route-not-found">
      <div className="module-mark"><Icon name="artifact" size={22} /></div>
      <h1 id="module-title">Page not found</h1>
      <p>No destination matches <code>{path}</code>. Choose a workspace to continue.</p>
      <div className="not-found-actions">
        <button className="primary-button" type="button" onClick={() => navigate('/dashboard')} data-testid="not-found-open-dashboard">Open Dashboard</button>
        <button className="secondary-button" type="button" onClick={() => navigate('/agents')} data-testid="not-found-open-agents">Open Agents</button>
      </div>
    </section>
  );
}

export function App() {
  const route = useHashRoute();
  const gateway = useGateway();
  const authUser = useAuthUser();
  const isDashboard = route === '/dashboard' || route.startsWith('/dashboard/');
  const hasLiveArtifactsWorkspace = gateway.mode === 'live' && !!authUser &&
    !!gateway.domains.liveArtifacts && !!gateway.domains.userPreferences && !!gateway.domains.messages;
  let content: React.ReactNode;
  if (route === '/agents' || route === '/') content = <AgentsWorkspace />;
  // LiveArtifactsShell falls back to the plain fixture DashboardPage internally whenever gateway
  // mode isn't live or the artifact/preferences domains are absent, so this is the single route
  // for both modes — not a live-only replacement of the fixture page.
  else if (isDashboard) content = hasLiveArtifactsWorkspace ? null : <LiveArtifactsShell route={route} />;
  else if (route === '/planner' || route.startsWith('/planner/')) content = <PlannerPage route={route} />;
  else if (route === '/tasks' || route.startsWith('/tasks/')) content = <TasksPage route={route} />;
  else if (route === '/rhythms' || route.startsWith('/rhythms/')) content = <RhythmsPage route={route} />;
  else if (route === '/projects' || route.startsWith('/projects/')) content = <ProjectsPage route={route} />;
  else if (route === '/messages' || route.startsWith('/messages/')) content = <MessagesPage route={route} />;
  else if (route === '/facilities' || route.startsWith('/facilities/')) content = <FacilitiesPage route={route} />;
  else if (route === '/automations' || route.startsWith('/automations/')) content = <AutomationsPage route={route} />;
  else if (route === '/integrations' || route.startsWith('/integrations/')) content = <IntegrationsPage route={route} />;
  else if (route === '/profiles') content = <Profiles />;
  else if (route === '/endpoint-map') content = <EndpointMap />;
  else if (route === '/mobile-access') content = <MobileAccessPage />;
  else if (route.startsWith('/tools/')) content = <ToolWorkspace slug={route.split('/')[2]} />;
  else content = <RouteNotFound path={route} />;
  return <><EnvironmentReceipt /><Shell route={route}>
    {content}
    {hasLiveArtifactsWorkspace && (
      <div hidden={!isDashboard} className="live-artifact-route-pane">
        <LiveArtifactsShell route="/dashboard" />
      </div>
    )}
  </Shell></>;
}
