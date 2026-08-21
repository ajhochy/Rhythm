import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectsScreen } from '../src/screens/ProjectsScreen';
import { RhythmWorkspaceProvider } from '../src/context';
import { RhythmGatewayError } from '../src/domain/types';
import { defaultRhythmTokens } from '../src/host/theme';
import { assertScreenContract } from './test-utils/screenContract';
import { fixtureDomainGateway, fixtureProjectsGateway, failingProjectsGateway, emptyProjectsGateway } from './test-utils/fixtures';
import { mount, flush, actClick, actSetValue } from './test-utils/mount';

function buildHost(overrides: Record<string, unknown> = {}) {
  return { tokens: defaultRhythmTokens, viewport: 'regular' as const, currentUser: { id: 'workspace-user-1', displayName: 'AJ Hochhalter', initials: 'AH', capabilities: ['projects.write'] as const }, ...overrides };
}

function mountProjects(gatewayOverrides: Partial<ReturnType<typeof fixtureDomainGateway>> = {}, hostOverrides: Record<string, unknown> = {}) {
  const gateway = { ...fixtureDomainGateway(), ...gatewayOverrides };
  return mount(createElement(RhythmWorkspaceProvider, { gateway, host: buildHost(hostOverrides), children: createElement(ProjectsScreen) }));
}

async function confirmProject(mounted: ReturnType<typeof mountProjects>) {
  await flush();
  await actClick(mounted.byTestId('project-operation-confirm')!);
  await flush();
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

  it('ignores a deferred stale load after the projects gateway is replaced', async () => {
    let releaseOld!: (value: Awaited<ReturnType<ReturnType<typeof fixtureProjectsGateway>['templates']>>) => void;
    const old = fixtureProjectsGateway();
    const staleGateway = { ...old, templates: () => new Promise<Awaited<ReturnType<typeof old.templates>>>((resolve) => { releaseOld = resolve; }) };
    const fresh = fixtureProjectsGateway();
    const freshTemplates = await fresh.templates();
    fresh.templates = async () => [{ ...freshTemplates[0]!, name: 'Fresh project gateway' }];
    const gateway = { ...fixtureDomainGateway(), projects: staleGateway };
    const mounted = mount(createElement(RhythmWorkspaceProvider, { gateway, host: buildHost(), children: createElement(ProjectsScreen) }));
    mounted.rerender(createElement(RhythmWorkspaceProvider, { gateway: { ...gateway, projects: fresh }, host: buildHost(), children: createElement(ProjectsScreen) }));
    await flush();
    expect(mounted.container.textContent).toContain('Fresh project gateway');
    releaseOld(await old.templates());
    await flush();
    expect(mounted.container.textContent).toContain('Fresh project gateway');
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
    await actClick(mounted.byTestId('project-operation-confirm')!);
    await flush();
    const updated = await projectsGateway.list();
    const instance = updated.find((item) => item.id === 'instance-sunday-service-2026-08-16');
    expect(instance?.steps.find((step) => step.id === 'step-final-run-sheet')?.status).toBe('done');
    mounted.unmount();
  });

  it('uses the exact narrow Projects capability and one foreground confirmation before a project-step mutation', async () => {
    const projectsGateway = fixtureProjectsGateway();
    const updateStep = vi.fn(projectsGateway.updateStep);
    const confirmWorkspaceOperation = vi.fn(async () => true);
    const mounted = mountProjects({ projects: { ...projectsGateway, updateStep } }, {
      currentUser: { id: 'workspace-user-1', displayName: 'Hermes', initials: 'H', capabilities: ['projects.update-step'] },
      confirmWorkspaceOperation,
    });
    await flush();
    await actClick(mounted.byTestId('project-instance-expand-instance-sunday-service-2026-08-16')!);
    await flush();
    expect((mounted.byTestId('project-template-new') as HTMLButtonElement).disabled).toBe(true);
    expect((mounted.byTestId('project-milestone-add') as HTMLButtonElement).disabled).toBe(true);
    await actClick(mounted.byTestId('project-step-complete-step-final-run-sheet')!);
    await flush();
    expect(updateStep).not.toHaveBeenCalled();
    expect(mounted.byTestId('project-operation-confirmation')).toBeTruthy();
    await actClick(mounted.byTestId('project-operation-confirm')!);
    await flush();
    expect(confirmWorkspaceOperation).toHaveBeenCalledWith(expect.objectContaining({ operation: 'projects.update-step', entityId: 'step-final-run-sheet', payload: { status: 'done' }, generation: expect.any(String) }));
    expect(updateStep).toHaveBeenCalledOnce();
    mounted.unmount();
  });

  it.each([
    ['projects.create-template', 'project-template-new', 'project-start'],
    ['projects.create-instance', 'project-start', 'project-template-new'],
    ['projects.create-milestone', 'project-milestone-add', 'project-step-complete-step-final-run-sheet'],
    ['projects.create-step', 'project-template-step-add', 'project-template-new'],
    ['projects.update-template-step', 'project-template-step-edit-template-step-volunteer-plan', 'project-step-complete-step-final-run-sheet'],
    ['projects.delete-step', 'project-template-step-delete-template-step-volunteer-plan', 'project-template-step-add'],
  ] as const)('enables only the named narrow project family control for %s', async (capability, enabledId, disabledId) => {
    const mounted = mountProjects({}, { currentUser: { id: 'workspace-user-1', displayName: 'Hermes', initials: 'H', capabilities: capability.includes('step') ? [capability, 'projects.update-template'] : [capability] } });
    await flush();
    await actClick(mounted.byTestId('project-instance-expand-instance-sunday-service-2026-08-16')!);
    await flush();
    if (capability.includes('step')) {
      await actClick(mounted.byTestId('project-template-edit-template-sunday-service')!);
      await flush();
    }
    expect((mounted.byTestId(enabledId) as HTMLButtonElement | HTMLInputElement).disabled).toBe(false);
    expect((mounted.byTestId(disabledId) as HTMLButtonElement | HTMLInputElement).disabled).toBe(true);
    mounted.unmount();
  });

  it('cancels, invalidates deferred, and retains conflict context for Project operations without local success', async () => {
    const projectsGateway = fixtureProjectsGateway();
    const updateStep = vi.fn(async () => { throw new RhythmGatewayError('conflict', 'stale'); });
    let resolveConfirmation!: (approved: boolean) => void;
    const confirmWorkspaceOperation = vi.fn(() => new Promise<boolean>((resolve) => { resolveConfirmation = resolve; }));
    const mounted = mountProjects({ projects: { ...projectsGateway, updateStep } }, {
      currentUser: { id: 'workspace-user-1', displayName: 'Hermes', initials: 'H', capabilities: ['projects.update-step'] },
      confirmWorkspaceOperation,
    });
    await flush();
    await actClick(mounted.byTestId('project-instance-expand-instance-sunday-service-2026-08-16')!);
    await flush();
    await actClick(mounted.byTestId('project-step-complete-step-final-run-sheet')!);
    await actClick(mounted.byTestId('project-operation-cancel')!);
    expect(confirmWorkspaceOperation).not.toHaveBeenCalled();
    await actClick(mounted.byTestId('project-step-complete-step-final-run-sheet')!);
    await actClick(mounted.byTestId('project-operation-confirm')!);
    await actClick(mounted.byTestId('project-operation-confirm')!);
    expect(confirmWorkspaceOperation).toHaveBeenCalledOnce();
    await actClick(mounted.byTestId('project-template-select-template-empty')!);
    resolveConfirmation(true);
    await flush();
    expect(updateStep).not.toHaveBeenCalled();
    await actClick(mounted.byTestId('project-step-complete-step-final-run-sheet')!);
    await actClick(mounted.byTestId('project-operation-confirm')!);
    resolveConfirmation(true);
    await flush();
    expect(mounted.byTestId('project-operation-outcome')?.getAttribute('role')).toBe('alert');
    expect(mounted.byTestId('project-operation-confirmation')).toBeTruthy();
    mounted.unmount();
  });

  it('does not write after an in-flight Project confirmation resolves following unmount', async () => {
    const projectsGateway = fixtureProjectsGateway();
    const updateStep = vi.fn(projectsGateway.updateStep);
    let resolveConfirmation!: (approved: boolean) => void;
    const mounted = mountProjects({ projects: { ...projectsGateway, updateStep } }, {
      currentUser: { id: 'workspace-user-1', displayName: 'Hermes', initials: 'H', capabilities: ['projects.update-step'] },
      confirmWorkspaceOperation: () => new Promise<boolean>((resolve) => { resolveConfirmation = resolve; }),
    });
    await flush();
    await actClick(mounted.byTestId('project-instance-expand-instance-sunday-service-2026-08-16')!);
    await flush();
    await actClick(mounted.byTestId('project-step-complete-step-final-run-sheet')!);
    await actClick(mounted.byTestId('project-operation-confirm')!);
    mounted.unmount();
    resolveConfirmation(true);
    await flush();
    expect(updateStep).not.toHaveBeenCalled();
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
    await confirmProject(mounted);
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
    await confirmProject(mounted);
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
    await confirmProject(mounted);
    await flush();
    const updated = await projectsGateway.list();
    const instance = updated.find((item) => item.id === 'instance-sunday-service-2026-08-16');
    expect(instance?.milestones.some((milestone) => milestone.title === 'Wrap-up')).toBe(true);
    mounted.unmount();
  });

  it('never exposes collaborator/member writes, including for the general legacy Projects capability', async () => {
    const projectsGateway = fixtureProjectsGateway();
    const mounted = mountProjects({ projects: projectsGateway });
    await flush();
    await actClick(mounted.byTestId('project-instance-expand-instance-sunday-service-2026-08-16')!);
    await flush();
    await actClick(mounted.byTestId('project-collaborator-add')!);
    await flush();
    expect((mounted.byTestId('project-collaborator-add') as HTMLButtonElement).disabled).toBe(true);
    expect((mounted.byTestId('project-collaborator-remove-workspace-user-2') as HTMLButtonElement).disabled).toBe(true);
    expect(mounted.byTestId('project-collaborator-picker')).toBeNull();
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
    await confirmProject(mounted);
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
    await confirmProject(mounted);
    const created = await projectsGateway.list();
    expect(created.some((instance) => instance.templateId === 'template-sunday-service' && instance.anchorDate === '2026-09-06')).toBe(true);
    mounted.unmount();
  });

  it('creates, edits, and deletes a template through the gateway round trip', async () => {
    const projectsGateway = fixtureProjectsGateway();
    const mounted = mountProjects({ projects: projectsGateway });
    await flush();
    await actClick(mounted.byTestId('project-template-new')!);
    await flush();
    await actSetValue(mounted.byTestId('project-template-name') as HTMLInputElement, 'Funeral service');
    await actClick(mounted.byTestId('project-template-save')!);
    await confirmProject(mounted);
    const created = (await projectsGateway.templates()).find((template) => template.name === 'Funeral service')!;
    expect(created).toBeTruthy();
    await actClick(mounted.byTestId(`project-template-edit-${created.id}`)!);
    await flush();
    await actSetValue(mounted.byTestId('project-template-name') as HTMLInputElement, 'Funeral service follow-through');
    await actClick(mounted.byTestId('project-template-save')!);
    await confirmProject(mounted);
    expect((await projectsGateway.templates()).find((template) => template.id === created.id)?.name).toBe('Funeral service follow-through');
    await actClick(mounted.byTestId(`project-template-delete-${created.id}`)!);
    await confirmProject(mounted);
    expect((await projectsGateway.templates()).some((template) => template.id === created.id)).toBe(false);
    mounted.unmount();
  });

  it('adds, edits, and deletes a template step with offsets and assignee through the gateway round trip', async () => {
    const projectsGateway = fixtureProjectsGateway();
    const confirmWorkspaceOperation = vi.fn(async () => true);
    const mounted = mountProjects({ projects: projectsGateway }, { confirmWorkspaceOperation });
    await flush();
    await actClick(mounted.byTestId('project-template-edit-template-empty')!);
    await flush();
    await actClick(mounted.byTestId('project-template-step-add')!);
    await flush();
    await actSetValue(mounted.byTestId('project-template-step-title') as HTMLInputElement, 'Confirm care team');
    await actSetValue(mounted.byTestId('project-template-step-offset-days') as HTMLInputElement, '-3');
    await actSetValue(mounted.byTestId('project-template-step-offset-description') as HTMLInputElement, 'Three days before');
    await actSetValue(mounted.byTestId('project-template-step-assignee') as HTMLSelectElement, 'workspace-user-2');
    await actClick(mounted.byTestId('project-template-step-save')!);
    await confirmProject(mounted);
    const step = (await projectsGateway.templates()).find((template) => template.id === 'template-empty')!.steps[0]!;
    expect(step).toMatchObject({ title: 'Confirm care team', offsetDays: -3, offsetDescription: 'Three days before', assigneeId: 'workspace-user-2' });
    await actClick(mounted.byTestId(`project-template-step-edit-${step.id}`)!);
    await flush();
    await actSetValue(mounted.byTestId('project-template-step-title') as HTMLInputElement, 'Confirm care plan');
    await actClick(mounted.byTestId('project-template-step-save')!);
    await confirmProject(mounted);
    expect(confirmWorkspaceOperation).toHaveBeenLastCalledWith(expect.objectContaining({ operation: 'projects.update-template-step', entityId: step.id }));
    expect((await projectsGateway.templates()).find((template) => template.id === 'template-empty')!.steps[0]?.title).toBe('Confirm care plan');
    await actClick(mounted.byTestId(`project-template-step-delete-${step.id}`)!);
    await confirmProject(mounted);
    expect((await projectsGateway.templates()).find((template) => template.id === 'template-empty')!.steps).toHaveLength(0);
    mounted.unmount();
  });

  it('fails closed when collaboration capability is omitted: project controls and mutation handlers stay inert', async () => {
    const projectsGateway = fixtureProjectsGateway();
    const mutations = {
      generate: vi.fn(projectsGateway.generate), createTemplate: vi.fn(projectsGateway.createTemplate), updateTemplate: vi.fn(projectsGateway.updateTemplate), deleteTemplate: vi.fn(projectsGateway.deleteTemplate), addTemplateStep: vi.fn(projectsGateway.addTemplateStep), updateTemplateStep: vi.fn(projectsGateway.updateTemplateStep), deleteTemplateStep: vi.fn(projectsGateway.deleteTemplateStep), delete: vi.fn(projectsGateway.delete), updateStep: vi.fn(projectsGateway.updateStep), addMilestone: vi.fn(projectsGateway.addMilestone), addCollaborator: vi.fn(projectsGateway.addCollaborator), removeCollaborator: vi.fn(projectsGateway.removeCollaborator),
    };
    const mounted = mountProjects({ projects: { ...projectsGateway, ...mutations } }, { currentUser: { id: 'workspace-user-1', displayName: 'AJ', initials: 'AH' } });
    await flush();
    await actClick(mounted.byTestId('project-instance-expand-instance-sunday-service-2026-08-16')!);
    await flush();
    expect(mounted.byTestId('project-inspector')?.textContent).toContain('Sunday Service');
    const complete = mounted.byTestId('project-step-complete-step-final-run-sheet') as HTMLInputElement;
    expect(complete.disabled).toBe(true);
    expect(complete.title).toContain('inspection only');
    await actClick(complete);
    for (const control of ['project-template-new', 'project-start', 'project-instance-delete-instance-sunday-service-2026-08-16', 'project-collaborator-add', 'project-milestone-add']) {
      expect((mounted.byTestId(control) as HTMLButtonElement).disabled).toBe(true);
      await actClick(mounted.byTestId(control)!);
    }
    for (const mutation of Object.values(mutations)) expect(mutation).not.toHaveBeenCalled();
    mounted.unmount();
  });
});
