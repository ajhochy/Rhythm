import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { ProjectsScreen } from '../src/screens/ProjectsScreen';
import { RhythmWorkspaceProvider } from '../src/context';
import { defaultRhythmTokens } from '../src/host/theme';
import { assertScreenContract } from './test-utils/screenContract';
import { fixtureDomainGateway, fixtureProjectsGateway, failingProjectsGateway, emptyProjectsGateway } from './test-utils/fixtures';
import { mount, flush, actClick, actSetValue } from './test-utils/mount';

function buildHost(overrides: Record<string, unknown> = {}) {
  return { tokens: defaultRhythmTokens, viewport: 'regular' as const, currentUser: { displayName: 'AJ Hochhalter', initials: 'AH' }, ...overrides };
}

function mountProjects(gatewayOverrides: Partial<ReturnType<typeof fixtureDomainGateway>> = {}, hostOverrides: Record<string, unknown> = {}) {
  const gateway = { ...fixtureDomainGateway(), ...gatewayOverrides };
  return mount(createElement(RhythmWorkspaceProvider, { gateway, host: buildHost(hostOverrides), children: createElement(ProjectsScreen) }));
}

describe('ProjectsScreen', () => {
  it('satisfies the shared page/focus/responsive/theme/accessibility contract', async () => {
    await assertScreenContract({ Screen: ProjectsScreen, screenName: 'Projects', testId: 'rhythm-projects-screen', gateway: fixtureDomainGateway() });
  });

  it('loads real project instances with owner and step-completion richness from the injected gateway', async () => {
    const mounted = mountProjects();
    await flush();
    expect(mounted.byTestId('project-instance-instance-sunday-service-2026-08-16')?.textContent).toContain('Sunday Service - August 16');
    expect(mounted.byTestId('project-instance-status-instance-sunday-service-2026-08-16')?.textContent).toContain('Active');
    mounted.unmount();
  });

  it('shows the loading state panel before the gateway resolves, then ready content', async () => {
    const mounted = mountProjects();
    expect(mounted.byTestId('page-state-loading')).toBeTruthy();
    await flush();
    expect(mounted.byTestId('page-state-loading')).toBeNull();
    mounted.unmount();
  });

  it('shows the empty state when the gateway returns no templates and no instances', async () => {
    const projects = emptyProjectsGateway();
    const mounted = mountProjects({ projects: { ...projects, templates: async () => [] } });
    await flush();
    expect(mounted.byTestId('page-state-empty')).toBeTruthy();
    mounted.unmount();
  });

  it('shows an inline no-active-projects message (while still offering templates) when only instances are empty', async () => {
    const mounted = mountProjects({ projects: emptyProjectsGateway() });
    await flush();
    expect(mounted.byTestId('page-state-empty')).toBeNull();
    expect(mounted.byTestId('projects-no-active')).toBeTruthy();
    expect(mounted.byTestId('project-templates-list')).toBeTruthy();
    mounted.unmount();
  });

  it('shows the forbidden state when the gateway rejects with a forbidden error', async () => {
    const mounted = mountProjects({ projects: failingProjectsGateway('forbidden') });
    await flush();
    expect(mounted.byTestId('page-state-forbidden')).toBeTruthy();
    mounted.unmount();
  });

  it('shows a retryable server-error state', async () => {
    const mounted = mountProjects({ projects: failingProjectsGateway('server_error') });
    await flush();
    expect(mounted.byTestId('page-state-server-error')).toBeTruthy();
    mounted.unmount();
  });

  it('expands an instance into the inspector showing owner, collaborators, and milestone-grouped steps', async () => {
    const mounted = mountProjects();
    await flush();
    await actClick(mounted.byTestId('project-instance-expand-instance-sunday-service-2026-08-16')!);
    await flush();
    const inspector = mounted.byTestId('project-inspector');
    expect(inspector?.textContent).toContain('Sunday Service - August 16');
    expect(inspector?.textContent).toContain('Morgan Lee');
    expect(mounted.byTestId('project-milestone-milestone-service-ready')?.textContent).toContain('Service ready');
    expect(mounted.byTestId('project-instance-step-step-volunteer-check-in')).toBeTruthy();
    mounted.unmount();
  });

  it('toggles showing completed instances', async () => {
    const mounted = mountProjects();
    await flush();
    expect(mounted.byTestId('project-instance-instance-finished-service')).toBeNull();
    const toggle = mounted.byTestId('projects-show-completed') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await actClick(toggle);
    await flush();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(mounted.byTestId('project-instance-instance-finished-service')).toBeTruthy();
    mounted.unmount();
  });

  it('completes a project step through the gateway', async () => {
    const projectsGateway = fixtureProjectsGateway();
    const mounted = mountProjects({ projects: projectsGateway });
    await flush();
    await actClick(mounted.byTestId('project-instance-expand-instance-sunday-service-2026-08-16')!);
    await flush();
    await actClick(mounted.byTestId('project-step-complete-step-final-run-sheet')!);
    await flush();
    const updated = await projectsGateway.list();
    const instance = updated.find((item) => item.id === 'instance-sunday-service-2026-08-16');
    expect(instance?.steps.find((step) => step.id === 'step-final-run-sheet')?.status).toBe('done');
    mounted.unmount();
  });

  it('reassigns a step to a different milestone (or Ungrouped) through the gateway', async () => {
    const projectsGateway = fixtureProjectsGateway();
    const mounted = mountProjects({ projects: projectsGateway });
    await flush();
    await actClick(mounted.byTestId('project-instance-expand-instance-sunday-service-2026-08-16')!);
    await flush();
    const select = mounted.byTestId('project-step-milestone-step-volunteer-check-in') as HTMLSelectElement;
    expect(select.value).toBe('milestone-service-ready');
    await actSetValue(select, '');
    await flush();
    const updated = await projectsGateway.list();
    const instance = updated.find((item) => item.id === 'instance-sunday-service-2026-08-16');
    expect(instance?.steps.find((step) => step.id === 'step-volunteer-check-in')?.milestoneId).toBeNull();
    mounted.unmount();
  });

  it('opens the step inspector (focus-trapped) and saves title/notes/dates/assignee through the gateway', async () => {
    const projectsGateway = fixtureProjectsGateway();
    const mounted = mountProjects({ projects: projectsGateway });
    await flush();
    await actClick(mounted.byTestId('project-instance-expand-instance-sunday-service-2026-08-16')!);
    await flush();
    await actClick(mounted.byTestId('project-step-inspect-step-final-run-sheet')!);
    await flush();
    const dialog = mounted.byTestId('project-step-inspector');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.contains(document.activeElement)).toBe(true);
    const titleInput = mounted.byTestId('project-step-title') as HTMLInputElement;
    await actSetValue(titleInput, 'Finalize the run sheet (urgent)');
    await actClick(mounted.byTestId('project-step-save')!);
    await flush();
    const updated = await projectsGateway.list();
    const instance = updated.find((item) => item.id === 'instance-sunday-service-2026-08-16');
    expect(instance?.steps.find((step) => step.id === 'step-final-run-sheet')?.title).toBe('Finalize the run sheet (urgent)');
    mounted.unmount();
  });

  it('adds a milestone through the gateway', async () => {
    const projectsGateway = fixtureProjectsGateway();
    const mounted = mountProjects({ projects: projectsGateway });
    await flush();
    await actClick(mounted.byTestId('project-instance-expand-instance-sunday-service-2026-08-16')!);
    await flush();
    await actClick(mounted.byTestId('project-milestone-add')!);
    await flush();
    const dialog = mounted.byTestId('project-milestone-dialog');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    await actSetValue(mounted.byTestId('project-milestone-title') as HTMLInputElement, 'Wrap-up');
    await actClick(mounted.byTestId('project-milestone-submit')!);
    await flush();
    const updated = await projectsGateway.list();
    const instance = updated.find((item) => item.id === 'instance-sunday-service-2026-08-16');
    expect(instance?.milestones.some((milestone) => milestone.title === 'Wrap-up')).toBe(true);
    mounted.unmount();
  });

  it('adds a collaborator through a focus-trapped picker and the gateway', async () => {
    const projectsGateway = fixtureProjectsGateway();
    const mounted = mountProjects({ projects: projectsGateway });
    await flush();
    await actClick(mounted.byTestId('project-instance-expand-instance-sunday-service-2026-08-16')!);
    await flush();
    await actClick(mounted.byTestId('project-collaborator-add')!);
    await flush();
    const dialog = mounted.byTestId('project-collaborator-picker');
    expect(dialog?.contains(document.activeElement)).toBe(true);
    mounted.unmount();
  });

  it('removes a collaborator through the gateway', async () => {
    const projectsGateway = fixtureProjectsGateway();
    const mounted = mountProjects({ projects: projectsGateway });
    await flush();
    await actClick(mounted.byTestId('project-instance-expand-instance-sunday-service-2026-08-16')!);
    await flush();
    await actClick(mounted.byTestId('project-collaborator-remove-workspace-user-2')!);
    await flush();
    const updated = await projectsGateway.list();
    const instance = updated.find((item) => item.id === 'instance-sunday-service-2026-08-16');
    expect(instance?.collaborators.some((person) => person.id === 'workspace-user-2')).toBe(false);
    mounted.unmount();
  });

  it('deletes a project instance through a confirmation dialog and the gateway', async () => {
    const projectsGateway = fixtureProjectsGateway();
    const mounted = mountProjects({ projects: projectsGateway });
    await flush();
    await actClick(mounted.byTestId('project-instance-expand-instance-sunday-service-2026-08-16')!);
    await flush();
    await actClick(mounted.byTestId('project-instance-delete-instance-sunday-service-2026-08-16')!);
    await flush();
    expect(mounted.byTestId('project-instance-delete-dialog')).toBeTruthy();
    await actClick(mounted.byTestId('project-instance-delete-confirm')!);
    await flush();
    const remaining = await projectsGateway.list();
    expect(remaining.some((instance) => instance.id === 'instance-sunday-service-2026-08-16')).toBe(false);
    mounted.unmount();
  });

  it('browses templates and starts a project from a template through the gateway', async () => {
    const projectsGateway = fixtureProjectsGateway();
    const mounted = mountProjects({ projects: projectsGateway });
    await flush();
    expect(mounted.byTestId('project-template-template-sunday-service')?.textContent).toContain('Sunday Service Launch');
    await actClick(mounted.byTestId('project-template-select-template-sunday-service')!);
    await flush();
    await actClick(mounted.byTestId('project-start')!);
    await flush();
    const dialog = mounted.byTestId('project-start-dialog');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    await actSetValue(mounted.byTestId('project-anchor-date') as HTMLInputElement, '2026-09-06');
    await actClick(mounted.byTestId('project-start-submit')!);
    await flush();
    const created = await projectsGateway.list();
    expect(created.some((instance) => instance.templateId === 'template-sunday-service' && instance.anchorDate === '2026-09-06')).toBe(true);
    mounted.unmount();
  });
});
