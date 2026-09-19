import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { FocusDialog } from '../../components/FocusDialog';
import { ListInspector, useSelectedId, type ListInspectorItem } from '../../components/ListInspector';
import { navigate } from '../../components/Shell';
import { Icon } from '../../icons';
import { useFixtures } from '../../store';
import { useGateway } from '../../gateway/context';
import { useWorkspaceMembers } from '../../components/useWorkspaceMembers';
import {
  createFixtureProjectsGateway,
  ProjectsGatewayError,
  type ProjectInstance as GatewayProjectInstance,
  type ProjectTemplate as GatewayProjectTemplate,
} from '../../gateway/projects';
import {
  cloneProjectInstances,
  cloneProjectTemplates,
  currentProjectUserId,
  initialProjectReceipts,
  projectMembers,
  seededProjectInstances,
  seededProjectTemplates,
  type ProjectInstance,
  type ProjectInstanceStep,
  type ProjectMilestone,
  type ProjectTemplate,
  type ProjectTemplateStep,
} from './fixtures';
import './styles.css';

// Canonical shape: ProjectTemplate/ProjectTemplateStep apps/api_server/src/models/project_template.ts:1-20.
// assigneeName is server-resolved but this view only keeps the numeric id (no live Users gateway
// exists to re-resolve a name if one is ever missing); the fixture roster lookup used to render a
// label is a best-effort display convenience only, not sent back to the server.
function mapGatewayTemplateStep(step: GatewayProjectTemplate['steps'][number]): ProjectTemplateStep {
  return {
    id: step.id,
    title: step.title,
    offsetDays: step.offsetDays,
    offsetDescription: step.offsetDescription ?? '',
    sortOrder: step.sortOrder,
    assigneeId: step.assigneeId != null ? String(step.assigneeId) : '',
  };
}

function mapGatewayTemplate(template: GatewayProjectTemplate): ProjectTemplate {
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? '',
    anchorType: template.anchorType,
    steps: template.steps.map(mapGatewayTemplateStep),
  };
}

// Canonical shape: ProjectInstance/ProjectInstanceStep/ProjectMilestone
// apps/api_server/src/models/project_instance.ts:1-52. The list/generate/update responses carry
// only a numeric ownerId, not a resolved person, so the owner is shown by id rather than an
// invented display name; real collaborators are fetched separately per instance (below) since
// they are not embedded in this response.
function mapGatewayInstance(instance: GatewayProjectInstance, collaborators: ProjectInstance['collaborators'] = []): ProjectInstance {
  return {
    id: instance.id,
    templateId: instance.templateId,
    name: instance.name ?? '',
    anchorDate: instance.anchorDate,
    owner: instance.ownerId != null ? { id: String(instance.ownerId), name: `Member #${instance.ownerId}`, initials: '#' } : { id: '', name: 'Unassigned', initials: '?' },
    collaborators,
    milestones: instance.milestones.map((milestone) => ({ id: milestone.id, title: milestone.title, sortOrder: milestone.sortOrder })),
    steps: instance.steps.map((step) => ({
      id: step.id,
      title: step.title,
      notes: step.notes ?? '',
      dueDate: step.dueDate,
      scheduledDate: step.scheduledDate ?? '',
      status: step.status,
      assigneeId: step.assigneeId != null ? String(step.assigneeId) : '',
      milestoneId: step.milestoneId,
    })),
  };
}

type ProjectsState = 'ready' | 'loading' | 'empty' | 'server-error' | 'forbidden' | 'unavailable' | 'readonly';
type TemplateDialogState = { mode: 'create' } | { mode: 'edit'; template: ProjectTemplate } | null;
type StepDialogState = { mode: 'create'; templateId: string } | { mode: 'edit'; templateId: string; step: ProjectTemplateStep } | null;
type InspectorDraft = Pick<ProjectInstanceStep, 'title' | 'notes' | 'scheduledDate' | 'dueDate' | 'assigneeId'>;

const supportedStates: ProjectsState[] = ['ready', 'loading', 'empty', 'server-error', 'forbidden', 'unavailable', 'readonly'];

function hashParams() {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '');
}

function initialState(): ProjectsState {
  const requested = hashParams().get('state');
  return supportedStates.includes(requested as ProjectsState) ? requested as ProjectsState : 'ready';
}

function slugify(value: string) {
  return value.toLocaleLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 56) || 'created';
}

function addDays(date: string, offset: number) {
  const resolved = new Date(`${date}T12:00:00Z`);
  resolved.setUTCDate(resolved.getUTCDate() + offset);
  return resolved.toISOString().slice(0, 10);
}

function derivedStatus(instance: ProjectInstance) {
  return instance.steps.length > 0 && instance.steps.every((step) => step.status === 'done') ? 'Done' : 'Active';
}

const templateRowId = (id: string) => `project-template-${id}`;
const instanceRowId = (id: string) => `project-instance-${id}`;
const templateRowPrefix = 'project-template-';
const instanceRowPrefix = 'project-instance-';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="project-field"><span>{label}</span>{children}</label>;
}

export function ProjectsPage({ route }: { route: string }) {
  const { notify } = useFixtures();
  const gatewayCtx = useGateway();
  const { members: memberOptions, status: memberStatus, currentUserId: liveUserId } = useWorkspaceMembers(projectMembers.map((person) => ({ ...person, userId: Number(person.id), email: '' })));
  const live = gatewayCtx.mode === 'live';
  const templateMatch = route.match(/^\/projects\/templates\/([^/]+)(?:\/(instances))?$/);
  const instanceMatch = route.match(/^\/projects\/instances\/([^/]+)$/);
  const templateMode = route.startsWith('/projects/templates');
  const scopedInstances = templateMatch?.[2] === 'instances';
  const routeTemplateId = templateMatch ? decodeURIComponent(templateMatch[1]) : null;
  const routeInstanceId = instanceMatch ? decodeURIComponent(instanceMatch[1]) : null;
  const [selectedRowId, setSelectedRowId] = useSelectedId('projectId');
  const [surfaceState, setSurfaceState] = useState<ProjectsState>(initialState);
  const [templates, setTemplates] = useState<ProjectTemplate[]>(() => live ? [] : cloneProjectTemplates());
  const [instances, setInstances] = useState<ProjectInstance[]>(() => live ? [] : cloneProjectInstances());
  const [mutationPending, setMutationPending] = useState(false);
  const [receipts, setReceipts] = useState<string[]>(() => {
    if (live) return [];
    if (initialState() === 'server-error') return ['GET /project-templates → 503', 'GET /project-instances → 503'];
    return scopedInstances && routeTemplateId
      ? [...initialProjectReceipts, `GET /project-instances?templateId=${routeTemplateId} → 200`]
      : [...initialProjectReceipts];
  });
  const [showCompleted, setShowCompleted] = useState(false);
  const [templateDialog, setTemplateDialog] = useState<TemplateDialogState>(null);
  const [stepDialog, setStepDialog] = useState<StepDialogState>(null);
  const [templateDelete, setTemplateDelete] = useState<ProjectTemplate | null>(null);
  const [stepDelete, setStepDelete] = useState<{ templateId: string; step: ProjectTemplateStep } | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [startSuccess, setStartSuccess] = useState<{ name: string; anchorDate: string } | null>(null);
  const [anchorDate, setAnchorDate] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [milestoneOpenFor, setMilestoneOpenFor] = useState<string | null>(null);
  const [milestoneDelete, setMilestoneDelete] = useState<{ instanceId: string; milestone: ProjectMilestone } | null>(null);
  const [collaboratorOpenFor, setCollaboratorOpenFor] = useState<string | null>(null);
  const [instanceDelete, setInstanceDelete] = useState<ProjectInstance | null>(null);
  const [directInspector, setDirectInspector] = useState<{ instanceId: string; stepId: string } | null>(null);
  const [inspectorDraft, setInspectorDraft] = useState<InspectorDraft | null>(null);
  const templateNameRef = useRef<HTMLInputElement>(null);
  const stepTitleRef = useRef<HTMLInputElement>(null);
  const milestoneTitleRef = useRef<HTMLInputElement>(null);

  // apps/web/src/gateway/index.ts:98 — every domain shares the one bearer from the signed-in
  // session; Projects must not build its own gateway from a build-time/test-only env value.
  const projectsGateway = useMemo(
    () => (live ? gatewayCtx.domains.projects! : createFixtureProjectsGateway()),
    [live, gatewayCtx],
  );

  const appendReceipt = (receipt: string) => setReceipts((current) => [...current, receipt]);

  const handleGatewayError = (method: string, path: string, error: unknown) => {
    const status = error instanceof ProjectsGatewayError ? error.status : 0;
    appendReceipt(`${method} ${path} → ${status || 'network error'}`);
    setSurfaceState(status === 401 || status === 403 ? 'forbidden' : status === 404 ? 'unavailable' : 'server-error');
  };

  // apps/api_server/src/routes/project_templates_routes.ts:12 GET /project-templates
  // apps/api_server/src/routes/project_instances_routes.ts:10 GET /project-instances
  const loadAll = async (active: () => boolean = () => true) => {
    if (!projectsGateway) { setSurfaceState('unavailable'); return; }
    setSurfaceState('loading');
    try {
      const [gatewayTemplates, gatewayInstances] = await Promise.all([projectsGateway.templates(), projectsGateway.instances()]);
      if (!active()) return;
      setTemplates(gatewayTemplates.map(mapGatewayTemplate));
      const mappedInstances = gatewayInstances.map((instance) => mapGatewayInstance(instance));
      setInstances(mappedInstances);
      appendReceipt('GET /project-templates → 200');
      appendReceipt('GET /project-instances → 200');
      setSurfaceState(gatewayTemplates.length || mappedInstances.length ? 'ready' : 'empty');
    } catch (error) {
      if (!active()) return;
      handleGatewayError('GET', '/project-templates', error);
    }
  };

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    void loadAll(() => !cancelled);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, projectsGateway]);

  // Collaborators are not embedded in the templates/instances list response (project_instance.ts:40-52),
  // so the selected instance's collaborators are fetched lazily on selection.
  const selectedInstanceIdForLoad = selectedRowId?.startsWith(instanceRowPrefix)
    ? selectedRowId.slice(instanceRowPrefix.length)
    : selectedRowId === null ? routeInstanceId : null;
  useEffect(() => {
    if (!live || !projectsGateway || !selectedInstanceIdForLoad) return;
    let cancelled = false;
    (async () => {
      try {
        // apps/api_server/src/routes/project_instances_routes.ts:19 GET /project-instances/:id/collaborators
        const collaborators = await projectsGateway.collaborators(selectedInstanceIdForLoad);
        if (cancelled) return;
        setInstances((current) => current.map((instance) => instance.id === selectedInstanceIdForLoad ? { ...instance, collaborators: collaborators.map((c) => ({ id: String(c.userId), name: c.name, initials: c.name.slice(0, 2).toUpperCase() })) } : instance));
        appendReceipt(`GET /project-instances/${selectedInstanceIdForLoad}/collaborators → 200`);
      } catch { /* collaborator prefetch failure surfaces on the next explicit mutation instead of blocking the page */ }
    })();
    return () => { cancelled = true; };
  }, [live, projectsGateway, selectedInstanceIdForLoad]);

  useEffect(() => {
    if (templateDialog?.mode === 'create') templateNameRef.current?.focus();
  }, [templateDialog]);

  useEffect(() => {
    if (stepDialog?.mode === 'create') stepTitleRef.current?.focus();
  }, [stepDialog]);

  const isReadonly = surfaceState === 'readonly';
  const isForbidden = surfaceState === 'forbidden';
  const mutationDisabled = isReadonly || isForbidden || mutationPending;
  const visibleInstances = instances.filter((instance) => showCompleted || derivedStatus(instance) !== 'Done');
  const projectItems: ListInspectorItem[] = surfaceState === 'empty' ? [] : [
    ...templates.map((template) => ({
      id: templateRowId(template.id),
      title: template.name,
      subtitle: `${template.steps.length} ${template.steps.length === 1 ? 'step' : 'steps'} · ${template.anchorType}`,
      group: 'templates',
    })),
    ...visibleInstances.map((instance) => {
      const completeSteps = instance.steps.filter((step) => step.status === 'done').length;
      return {
        id: instanceRowId(instance.id),
        title: instance.name,
        subtitle: `${instance.owner.name} · ${completeSteps}/${instance.steps.length} steps`,
        badge: derivedStatus(instance),
        group: 'active-projects',
      };
    }),
  ];
  const routeSelectedRowId = routeTemplateId ? templateRowId(routeTemplateId) : routeInstanceId ? instanceRowId(routeInstanceId) : null;
  const defaultSelectedRowId = templateMode
    ? projectItems.find((item) => item.group === 'templates')?.id ?? projectItems[0]?.id ?? null
    : projectItems.find((item) => item.group === 'active-projects')?.id ?? projectItems[0]?.id ?? null;
  const effectiveSelectedRowId = selectedRowId ?? routeSelectedRowId ?? defaultSelectedRowId;
  const selectedTemplateId = effectiveSelectedRowId?.startsWith(templateRowPrefix) ? effectiveSelectedRowId.slice(templateRowPrefix.length) : null;
  const selectedTemplate = selectedTemplateId ? templates.find((template) => template.id === selectedTemplateId) ?? null : null;
  const selectedInspectorInstance = directInspector ? instances.find((instance) => instance.id === directInspector.instanceId) ?? null : null;
  const selectedInspectorStep = directInspector && selectedInspectorInstance ? selectedInspectorInstance.steps.find((step) => step.id === directInspector.stepId) ?? null : null;
  const hasUnsavedInspectorEdits = Boolean(inspectorDraft && selectedInspectorStep && (
    inspectorDraft.title !== selectedInspectorStep.title
    || inspectorDraft.notes !== selectedInspectorStep.notes
    || inspectorDraft.scheduledDate !== selectedInspectorStep.scheduledDate
    || inspectorDraft.dueDate !== selectedInspectorStep.dueDate
    || inspectorDraft.assigneeId !== selectedInspectorStep.assigneeId
  ));
  const fixtureSnapshot = JSON.stringify({
    templates: seededProjectTemplates.map((template) => [template.id, template.steps.map((step) => step.id)]),
    instances: seededProjectInstances.map((instance) => [instance.id, instance.steps.map((step) => [step.id, step.status])]),
  });

  useEffect(() => {
    if (selectedRowId === null && effectiveSelectedRowId && ['ready', 'readonly', 'forbidden'].includes(surfaceState)) setSelectedRowId(effectiveSelectedRowId);
  }, [effectiveSelectedRowId, selectedRowId, setSelectedRowId, surfaceState]);

  const selectProjectItem = (rowId: string) => {
    if (rowId === effectiveSelectedRowId) return;
    if (hasUnsavedInspectorEdits && !window.confirm('Discard unsaved step edits and select another project item?')) return;
    setDirectInspector(null);
    setInspectorDraft(null);
    setSelectedRowId(rowId);
  };

  const writeState = (next: ProjectsState) => {
    setSurfaceState(next);
    const [base = '#/projects', query = ''] = window.location.hash.split('?');
    const params = new URLSearchParams(query);
    params.set('state', next);
    history.replaceState(history.state, '', `${base}?${params.toString()}`);
  };
  const retry = () => {
    if (live) { void loadAll(); return; }
    setReceipts((current) => [...current, 'GET /project-templates → 200', scopedInstances && routeTemplateId ? `GET /project-instances?templateId=${routeTemplateId} → 200` : 'GET /project-instances → 200']);
    writeState('ready');
    notify('Projects refreshed');
  };
  const refresh = () => {
    if (live) { void loadAll(); return; }
    appendReceipt(scopedInstances && routeTemplateId ? `GET /project-instances?templateId=${routeTemplateId} → 200` : 'GET /project-instances → 200');
    notify('Active projects refreshed');
  };

  // Merges a canonical ProjectInstanceStep response (apps/api_server/src/models/project_instance.ts:1-13)
  // into whichever instance currently holds that step id.
  const mergeStep = (updated: Awaited<ReturnType<NonNullable<typeof projectsGateway>['updateInstanceStep']>>) => {
    const mapped: ProjectInstanceStep = { id: updated.id, title: updated.title, notes: updated.notes ?? '', dueDate: updated.dueDate, scheduledDate: updated.scheduledDate ?? '', status: updated.status, assigneeId: updated.assigneeId != null ? String(updated.assigneeId) : '', milestoneId: updated.milestoneId };
    setInstances((current) => current.map((instance) => instance.steps.some((step) => step.id === mapped.id) ? { ...instance, steps: instance.steps.map((step) => step.id === mapped.id ? mapped : step) } : instance));
  };

  // Canonical create/update bodies: CreateProjectTemplateDto/UpdateProjectTemplateDto
  // apps/api_server/src/models/project_template.ts:22-33.
  const saveTemplate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name') ?? '').trim();
    if (!name) { templateNameRef.current?.focus(); return; }
    const description = String(data.get('description') ?? '').trim();
    if (live) {
      if (!projectsGateway || mutationPending) return;
      setMutationPending(true);
      try {
        if (templateDialog?.mode === 'edit') {
          const id = templateDialog.template.id;
          const updated = await projectsGateway.updateTemplate(id, { name, description: description || null });
          setTemplates((current) => current.map((template) => template.id === id ? mapGatewayTemplate(updated) : template));
          appendReceipt(`PATCH /project-templates/${id} {name,description} → 200`);
          notify(`${name} updated`);
        } else {
          const created = await projectsGateway.createTemplate({ name, description: description || null });
          setTemplates((current) => [...current, mapGatewayTemplate(created)]);
          setSelectedRowId(templateRowId(created.id));
          appendReceipt('POST /project-templates {name,description} → 201');
          notify(`${name} created`);
        }
        setTemplateDialog(null);
      } catch (error) { handleGatewayError(templateDialog?.mode === 'edit' ? 'PATCH' : 'POST', '/project-templates', error); } finally { setMutationPending(false); }
      return;
    }
    if (templateDialog?.mode === 'edit') {
      const id = templateDialog.template.id;
      setTemplates((current) => current.map((template) => template.id === id ? { ...template, name, description } : template));
      appendReceipt(`PATCH /project-templates/${id} {name,description} → 200`);
      notify(`${name} updated`);
    } else {
      const id = `template-${slugify(name)}`;
      setTemplates((current) => [...current, { id, name, description, anchorType: 'Event date', steps: [] }]);
      setSelectedRowId(templateRowId(id));
      appendReceipt('POST /project-templates {name,description} → 201');
      notify(`${name} created`);
    }
    setTemplateDialog(null);
  };

  const confirmTemplateDelete = async () => {
    if (!templateDelete) return;
    const target = templateDelete;
    if (live) {
      if (!projectsGateway || mutationPending) return;
      setMutationPending(true);
      try {
        await projectsGateway.deleteTemplate(target.id);
        appendReceipt(`DELETE /project-templates/${target.id} → 204`);
        setTemplateDelete(null);
        notify(`${target.name} deleted`);
        await loadAll();
      } catch (error) { handleGatewayError('DELETE', `/project-templates/${target.id}`, error); } finally { setMutationPending(false); }
      return;
    }
    setTemplates((current) => current.filter((template) => template.id !== target.id));
    setInstances((current) => current.filter((instance) => instance.templateId !== target.id));
    appendReceipt(`DELETE /project-templates/${target.id} → 204`);
    setTemplateDelete(null);
    notify(`${target.name} deleted`);
  };

  // Canonical body: CreateStepDto apps/api_server/src/models/project_template.ts:35-41 (update is Partial).
  const saveTemplateStep = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!stepDialog) return;
    const data = new FormData(event.currentTarget);
    const title = String(data.get('title') ?? '').trim();
    if (!title) { stepTitleRef.current?.focus(); return; }
    const parsedOffset = Number.parseInt(String(data.get('offsetDays') ?? ''), 10);
    const previousOffset = stepDialog.mode === 'edit' ? stepDialog.step.offsetDays : 0;
    const offsetDays = Number.isFinite(parsedOffset) ? parsedOffset : previousOffset;
    const offsetDescription = String(data.get('offsetDescription') ?? '').trim();
    const assigneeId = String(data.get('assigneeId') ?? currentProjectUserId);
    const template = templates.find((item) => item.id === stepDialog.templateId);
    if (!template) return;
    if (live) {
      if (!projectsGateway || mutationPending) return;
      setMutationPending(true);
      try {
        if (stepDialog.mode === 'edit') {
          const stepId = stepDialog.step.id;
          const updated = await projectsGateway.updateTemplateStep(template.id, stepId, { title, offsetDays, offsetDescription: offsetDescription || null, assigneeId: assigneeId ? Number(assigneeId) : null });
          setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, steps: item.steps.map((step) => step.id === stepId ? mapGatewayTemplateStep(updated) : step) } : item));
          appendReceipt(`PATCH /project-templates/${template.id}/steps/${stepId} {title,offsetDays,offsetDescription,assigneeId} → 200`);
        } else {
          const created = await projectsGateway.addTemplateStep(template.id, { title, offsetDays, offsetDescription: offsetDescription || null, assigneeId: assigneeId ? Number(assigneeId) : null });
          setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, steps: [...item.steps, mapGatewayTemplateStep(created)] } : item));
          appendReceipt(`POST /project-templates/${template.id}/steps {title,offsetDays,offsetDescription,sortOrder,assigneeId} → 201`);
        }
        setStepDialog(null);
        notify('Template step saved');
      } catch (error) { handleGatewayError(stepDialog.mode === 'edit' ? 'PATCH' : 'POST', `/project-templates/${template.id}/steps`, error); } finally { setMutationPending(false); }
      return;
    }
    if (stepDialog.mode === 'edit') {
      const stepId = stepDialog.step.id;
      setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, steps: item.steps.map((step) => step.id === stepId ? { ...step, title, offsetDays, offsetDescription, assigneeId } : step) } : item));
      appendReceipt(`PATCH /project-templates/${template.id}/steps/${stepId} {title,offsetDays,offsetDescription,assigneeId} → 200`);
    } else {
      const step: ProjectTemplateStep = { id: `step-${slugify(title)}`, title, offsetDays, offsetDescription, sortOrder: template.steps.length, assigneeId };
      setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, steps: [...item.steps, step] } : item));
      appendReceipt(`POST /project-templates/${template.id}/steps {title,offsetDays,offsetDescription,sortOrder,assigneeId} → 201`);
    }
    appendReceipt('GET /project-templates → 200');
    setStepDialog(null);
    notify('Template step saved');
  };

  const confirmStepDelete = async () => {
    if (!stepDelete) return;
    if (live) {
      if (!projectsGateway || mutationPending) return;
      setMutationPending(true);
      try {
        await projectsGateway.deleteTemplateStep(stepDelete.templateId, stepDelete.step.id);
        setTemplates((current) => current.map((template) => template.id === stepDelete.templateId ? { ...template, steps: template.steps.filter((step) => step.id !== stepDelete.step.id) } : template));
        appendReceipt(`DELETE /project-templates/${stepDelete.templateId}/steps/${stepDelete.step.id} → 204`);
        notify(`${stepDelete.step.title} deleted`);
        setStepDelete(null);
      } catch (error) { handleGatewayError('DELETE', `/project-templates/${stepDelete.templateId}/steps/${stepDelete.step.id}`, error); } finally { setMutationPending(false); }
      return;
    }
    setTemplates((current) => current.map((template) => template.id === stepDelete.templateId ? { ...template, steps: template.steps.filter((step) => step.id !== stepDelete.step.id) } : template));
    appendReceipt(`DELETE /project-templates/${stepDelete.templateId}/steps/${stepDelete.step.id} → 204`);
    appendReceipt('GET /project-templates → 200');
    notify(`${stepDelete.step.title} deleted`);
    setStepDelete(null);
  };

  // Canonical body: GenerateProjectInput apps/web/src/gateway/projects.ts:13 → POST .../generate
  // (apps/api_server/src/routes/project_templates_routes.ts:20).
  const startProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedTemplate || !anchorDate) return;
    const resolvedName = instanceName.trim() || `${selectedTemplate.name} - ${anchorDate}`;
    if (live) {
      if (!projectsGateway || mutationPending) return;
      setMutationPending(true);
      try {
        const created = await projectsGateway.generateInstance(selectedTemplate.id, { anchorDate, name: instanceName.trim() || undefined });
        setInstances((current) => [...current, mapGatewayInstance(created)]);
        appendReceipt(`POST /project-templates/${selectedTemplate.id}/generate {anchorDate,name} → 201`);
        setStartSuccess({ name: created.name ?? resolvedName, anchorDate });
        notify(`${created.name ?? resolvedName} started`);
      } catch (error) { handleGatewayError('POST', `/project-templates/${selectedTemplate.id}/generate`, error); } finally { setMutationPending(false); }
      return;
    }
    appendReceipt(`POST /project-templates/${selectedTemplate.id}/generate {anchorDate,name} → 201`);
    setStartSuccess({ name: resolvedName, anchorDate });
    notify(`${resolvedName} started`);
  };

  // Canonical body: UpdateProjectInstanceStepInput apps/web/src/gateway/projects.ts:15 →
  // PATCH /project-instances/steps/:stepId (apps/api_server/src/routes/project_instances_routes.ts:13).
  const toggleComplete = async (instanceId: string, stepId: string, checked: boolean) => {
    const instance = instances.find((item) => item.id === instanceId);
    const step = instance?.steps.find((item) => item.id === stepId);
    if (!instance || !step || mutationPending) return;
    if (live) {
      if (!projectsGateway) return;
      setMutationPending(true);
      try {
        const updated = await projectsGateway.updateInstanceStep(stepId, { status: checked ? 'done' : 'open' });
        mergeStep(updated);
        appendReceipt(`PATCH /project-instances/steps/${stepId} {status:"${checked ? 'done' : 'open'}"} → 200`);
        notify(checked ? `${step.title} completed` : `${step.title} reopened`);
      } catch (error) { handleGatewayError('PATCH', `/project-instances/steps/${stepId}`, error); } finally { setMutationPending(false); }
      return;
    }
    setInstances((current) => current.map((item) => item.id === instanceId ? { ...item, steps: item.steps.map((candidate) => candidate.id === stepId ? { ...candidate, status: checked ? 'done' : 'open' } : candidate) } : item));
    appendReceipt(`PATCH /project-instances/steps/${stepId} {status:"${checked ? 'done' : 'open'}",assigneeId} → 200`);
    notify(checked ? `${step.title} completed` : `${step.title} reopened`);
  };

  const openInspector = (instance: ProjectInstance, step: ProjectInstanceStep) => {
    setDirectInspector({ instanceId: instance.id, stepId: step.id });
    setInspectorDraft({ title: step.title, notes: step.notes, scheduledDate: step.scheduledDate, dueDate: step.dueDate, assigneeId: step.assigneeId });
  };

  const saveInspector = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!directInspector || !inspectorDraft || !inspectorDraft.title.trim() || mutationPending) return;
    if (live) {
      if (!projectsGateway) return;
      setMutationPending(true);
      try {
        const title = inspectorDraft.title.trim();
        const updated = await projectsGateway.updateInstanceStep(directInspector.stepId, {
          title,
          notes: inspectorDraft.notes || null,
          dueDate: inspectorDraft.dueDate,
          scheduledDate: inspectorDraft.scheduledDate || null,
          assigneeId: inspectorDraft.assigneeId ? Number(inspectorDraft.assigneeId) : null,
        });
        mergeStep(updated);
        setInspectorDraft((current) => current ? { ...current, title } : current);
        appendReceipt(`PATCH /project-instances/steps/${directInspector.stepId} {title,notes,dueDate,scheduledDate,assigneeId} → 200`);
        notify('Project step updated');
      } catch (error) { handleGatewayError('PATCH', `/project-instances/steps/${directInspector.stepId}`, error); } finally { setMutationPending(false); }
      return;
    }
    const title = inspectorDraft.title.trim();
    setInstances((current) => current.map((instance) => instance.id === directInspector.instanceId ? { ...instance, steps: instance.steps.map((step) => step.id === directInspector.stepId ? { ...step, ...inspectorDraft, title } : step) } : instance));
    setInspectorDraft((current) => current ? { ...current, title } : current);
    appendReceipt(`PATCH /project-instances/steps/${directInspector.stepId} {title,notes,dueDate,scheduledDate,assigneeId} → 200`);
    notify('Project step updated');
  };

  const addCollaborator = async (instanceId: string, personId: string) => {
    const person = memberOptions.find((candidate) => candidate.id === personId);
    if (!person || mutationPending) return;
    if (live) {
      if (!projectsGateway) return;
      setMutationPending(true);
      try {
        // apps/api_server/src/routes/project_instances_routes.ts:20 POST /project-instances/:id/collaborators
        const collaborators = await projectsGateway.addCollaborator(instanceId, Number(personId));
        setInstances((current) => current.map((instance) => instance.id === instanceId ? { ...instance, collaborators: collaborators.map((c) => ({ id: String(c.userId), name: c.name, initials: c.name.slice(0, 2).toUpperCase() })) } : instance));
        appendReceipt(`POST /project-instances/${instanceId}/collaborators {userId} → 201`);
        setCollaboratorOpenFor(null);
        notify(`${person.name} added`);
      } catch (error) { handleGatewayError('POST', `/project-instances/${instanceId}/collaborators`, error); } finally { setMutationPending(false); }
      return;
    }
    setInstances((current) => current.map((instance) => instance.id === instanceId ? { ...instance, collaborators: [...instance.collaborators, person] } : instance));
    appendReceipt(`POST /project-instances/${instanceId}/collaborators {userId} → 201`);
    appendReceipt('GET /project-instances → 200');
    setCollaboratorOpenFor(null);
    notify(`${person.name} added`);
  };

  const removeCollaborator = async (instanceId: string, personId: string) => {
    if (mutationPending) return;
    if (live) {
      if (!projectsGateway) return;
      setMutationPending(true);
      try {
        await projectsGateway.removeCollaborator(instanceId, Number(personId));
        setInstances((current) => current.map((instance) => instance.id === instanceId ? { ...instance, collaborators: instance.collaborators.filter((person) => person.id !== personId) } : instance));
        appendReceipt(`DELETE /project-instances/${instanceId}/collaborators/${personId} → 204`);
        notify('Collaborator removed');
      } catch (error) { handleGatewayError('DELETE', `/project-instances/${instanceId}/collaborators/${personId}`, error); } finally { setMutationPending(false); }
      return;
    }
    setInstances((current) => current.map((instance) => instance.id === instanceId ? { ...instance, collaborators: instance.collaborators.filter((person) => person.id !== personId) } : instance));
    appendReceipt(`DELETE /project-instances/${instanceId}/collaborators/${personId} → 204`);
    appendReceipt('GET /project-instances → 200');
    notify('Collaborator removed');
  };

  // Canonical body: CreateProjectMilestoneDto apps/api_server/src/models/project_instance.ts:26-31.
  const addMilestone = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!milestoneOpenFor || mutationPending) return;
    const title = String(new FormData(event.currentTarget).get('title') ?? '').trim();
    if (!title) { milestoneTitleRef.current?.focus(); return; }
    const instance = instances.find((item) => item.id === milestoneOpenFor);
    if (!instance) return;
    if (live) {
      if (!projectsGateway) return;
      setMutationPending(true);
      try {
        const created = await projectsGateway.createMilestone(instance.id, { title });
        setInstances((current) => current.map((item) => item.id === instance.id ? { ...item, milestones: [...item.milestones, { id: created.id, title: created.title, sortOrder: created.sortOrder }] } : item));
        appendReceipt(`POST /project-instances/${instance.id}/milestones {title,sortOrder} → 201`);
        setMilestoneOpenFor(null);
        notify(`${title} added`);
      } catch (error) { handleGatewayError('POST', `/project-instances/${instance.id}/milestones`, error); } finally { setMutationPending(false); }
      return;
    }
    const milestone: ProjectMilestone = { id: `milestone-${slugify(title)}`, title, sortOrder: instance.milestones.length };
    setInstances((current) => current.map((item) => item.id === instance.id ? { ...item, milestones: [...item.milestones, milestone] } : item));
    appendReceipt(`POST /project-instances/${instance.id}/milestones {title,sortOrder} → 201`);
    setMilestoneOpenFor(null);
    notify(`${title} added`);
  };

  const assignMilestone = async (instanceId: string, stepId: string, milestoneId: string) => {
    if (mutationPending) return;
    if (live) {
      if (!projectsGateway) return;
      setMutationPending(true);
      try {
        const updated = await projectsGateway.updateInstanceStep(stepId, { milestoneId: milestoneId || null });
        mergeStep(updated);
        appendReceipt(`PATCH /project-instances/steps/${stepId} {milestoneId} → 200`);
        notify(milestoneId ? 'Step assigned to milestone' : 'Step moved to Ungrouped');
      } catch (error) { handleGatewayError('PATCH', `/project-instances/steps/${stepId}`, error); } finally { setMutationPending(false); }
      return;
    }
    setInstances((current) => current.map((instance) => instance.id === instanceId ? { ...instance, steps: instance.steps.map((step) => step.id === stepId ? { ...step, milestoneId: milestoneId || null } : step) } : instance));
    appendReceipt(`PATCH /project-instances/steps/${stepId} {milestoneId} → 200`);
    notify(milestoneId ? 'Step assigned to milestone' : 'Step moved to Ungrouped');
  };

  const confirmMilestoneDelete = async () => {
    if (!milestoneDelete) return;
    const { instanceId, milestone } = milestoneDelete;
    if (live) {
      if (!projectsGateway || mutationPending) return;
      setMutationPending(true);
      try {
        await projectsGateway.deleteMilestone(instanceId, milestone.id);
        appendReceipt(`DELETE /project-instances/${instanceId}/milestones/${milestone.id} → 204`);
        setMilestoneDelete(null);
        notify(`${milestone.title} deleted; its steps moved to Ungrouped`);
        await loadAll();
      } catch (error) { handleGatewayError('DELETE', `/project-instances/${instanceId}/milestones/${milestone.id}`, error); } finally { setMutationPending(false); }
      return;
    }
    setInstances((current) => current.map((instance) => instance.id === instanceId ? { ...instance, milestones: instance.milestones.filter((item) => item.id !== milestone.id), steps: instance.steps.map((step) => step.milestoneId === milestone.id ? { ...step, milestoneId: null } : step) } : instance));
    appendReceipt(`DELETE /project-instances/${instanceId}/milestones/${milestone.id} → 204`);
    setMilestoneDelete(null);
    notify(`${milestone.title} deleted; its steps moved to Ungrouped`);
  };

  const confirmInstanceDelete = async () => {
    if (!instanceDelete) return;
    const target = instanceDelete;
    if (live) {
      if (!projectsGateway || mutationPending) return;
      setMutationPending(true);
      try {
        await projectsGateway.deleteInstance(target.id);
        setInstances((current) => current.filter((instance) => instance.id !== target.id));
        appendReceipt(`DELETE /project-instances/${target.id} → 204`);
        setInstanceDelete(null);
        notify(`${target.name} deleted`);
      } catch (error) { handleGatewayError('DELETE', `/project-instances/${target.id}`, error); } finally { setMutationPending(false); }
      return;
    }
    setInstances((current) => current.filter((instance) => instance.id !== target.id));
    appendReceipt(`DELETE /project-instances/${target.id} → 204`);
    setInstanceDelete(null);
    notify(`${target.name} deleted`);
  };

  const renderStepRow = (instance: ProjectInstance, step: ProjectInstanceStep) => (
    <article
      className="instance-step"
      key={step.id}
      data-status={step.status}
      data-testid={`project-instance-step-${step.id}`}
      data-source-type="project_step"
      data-source-id={step.id}
      onClick={(event) => {
        if (mutationDisabled || (event.target as HTMLElement).closest('input,select,button')) return;
        void toggleComplete(instance.id, step.id, step.status !== 'done');
      }}
    >
      <label className="step-check" title={mutationDisabled ? 'Project owner access is required to change completion' : undefined}>
        <span className="sr-only">{step.status === 'done' ? 'Reopen' : 'Complete'} {step.title}</span>
        <input type="checkbox" checked={step.status === 'done'} disabled={mutationDisabled} onChange={(event) => toggleComplete(instance.id, step.id, event.target.checked)} data-testid={`project-step-complete-${step.id}`} />
        <span aria-hidden="true" />
      </label>
      <div className="step-copy"><strong>{step.title}</strong><span>{step.scheduledDate} · {memberOptions.find((person) => person.id === step.assigneeId)?.name ?? 'Unassigned'}</span></div>
      <label className="milestone-select"><span className="sr-only">Milestone for {step.title}</span><select value={step.milestoneId ?? ''} disabled={mutationDisabled} onChange={(event) => assignMilestone(instance.id, step.id, event.target.value)} data-testid={`project-step-milestone-${step.id}`}><option value="">Ungrouped</option>{instance.milestones.map((milestone) => <option value={milestone.id} key={milestone.id}>{milestone.title}</option>)}</select></label>
      <button className="icon-button" type="button" aria-label={`Inspect ${step.title}`} onClick={() => openInspector(instance, step)} data-testid={`project-step-inspect-${step.id}`}>↗</button>
    </article>
  );

  const renderProjectInspector = (instance: ProjectInstance) => {
    const owner = instance.owner.id === (live ? String(liveUserId) : currentProjectUserId);
    const groupedSteps = instance.milestones.map((milestone) => ({ milestone, steps: instance.steps.filter((step) => step.milestoneId === milestone.id && (showCompleted || step.status !== 'done')) }));
    const ungrouped = instance.steps.filter((step) => !step.milestoneId && (showCompleted || step.status !== 'done'));
    const editingThisProject = directInspector?.instanceId === instance.id && selectedInspectorStep && inspectorDraft;
    return <div className="project-inspector" data-testid="project-inspector" data-od-id="project-inspector">
      <header className="project-inspector-header">
        <div><span className="eyebrow">Active project</span><p>{instance.anchorDate} · <strong data-testid={`project-instance-status-${instance.id}`}>{derivedStatus(instance)}</strong></p></div>
        <button className="danger-button compact" type="button" disabled={mutationDisabled || !owner} aria-describedby={mutationDisabled ? 'projects-owner-reason' : undefined} onClick={() => setInstanceDelete(instance)} data-testid={`project-instance-delete-${instance.id}`}>Delete</button>
      </header>
      <div className="instance-detail">
        <section className="people-strip" aria-labelledby={`people-${instance.id}`}><div><span className="eyebrow">People</span><h3 id={`people-${instance.id}`}>Project owner</h3><p>{instance.owner.name}</p></div><div className="people-list"><span className="eyebrow">Collaborators</span>{instance.collaborators.map((person) => <span className="person-chip" key={person.id} data-testid={`project-collaborator-${person.id}`}><i aria-hidden="true">{person.initials}</i><strong>{person.name}</strong><button className="icon-button" type="button" disabled={mutationDisabled || !owner} aria-label={`Remove ${person.name}`} onClick={() => removeCollaborator(instance.id, person.id)} data-testid={`project-collaborator-remove-${person.id}`}>×</button></span>)}<button className="secondary-button" type="button" disabled={mutationDisabled || !owner} aria-describedby={!owner || mutationDisabled ? 'projects-owner-reason' : undefined} onClick={() => setCollaboratorOpenFor(instance.id)} data-testid="project-collaborator-add">Add person</button></div></section>
        <div className="timeline-toolbar"><div><span className="eyebrow">Project timeline</span><h3>Milestones and steps</h3></div><button className="secondary-button" type="button" disabled={mutationDisabled} onClick={() => setMilestoneOpenFor(instance.id)} data-testid="project-milestone-add">Add milestone</button></div>
        <div className="milestone-list">
          {groupedSteps.map(({ milestone, steps }) => <section className="milestone-group" key={milestone.id} data-testid={`project-milestone-${milestone.id}`}><header><div><span>{String(milestone.sortOrder + 1).padStart(2, '0')}</span><h4>{milestone.title}</h4></div><button className="text-button danger-text" type="button" disabled={mutationDisabled} onClick={() => setMilestoneDelete({ instanceId: instance.id, milestone })} data-testid={`project-milestone-delete-${milestone.id}`}>Delete milestone</button></header>{steps.length ? steps.map((step) => renderStepRow(instance, step)) : <p className="milestone-empty">No visible steps in this milestone.</p>}</section>)}
          <section className="milestone-group ungrouped" data-testid="project-milestone-ungrouped"><header><div><span>-</span><h4>Ungrouped</h4></div></header>{ungrouped.length ? ungrouped.map((step) => renderStepRow(instance, step)) : <p className="milestone-empty">Every visible step belongs to a milestone.</p>}</section>
        </div>
      </div>
      {editingThisProject && <form className="project-dialog-form inspector-form" onSubmit={saveInspector} data-testid="project-step-direct-editor">
        <section className="inspector-context"><div><span>Project</span><strong>{instance.name}</strong></div><div><span>Project owner</span><strong>{instance.owner.name}</strong></div><div data-testid="project-step-collaborators"><span>Collaborators</span><strong>{instance.collaborators.map((person) => person.name).join(', ') || 'None'}</strong></div></section>
        <fieldset disabled={mutationDisabled} aria-describedby={mutationDisabled ? 'projects-readonly-reason' : undefined}><legend className="sr-only">Project step fields</legend><Field label="Title"><input value={inspectorDraft.title} onChange={(event) => setInspectorDraft({ ...inspectorDraft, title: event.target.value })} data-testid="project-step-title" /></Field><Field label="Notes"><textarea rows={4} value={inspectorDraft.notes} onChange={(event) => setInspectorDraft({ ...inspectorDraft, notes: event.target.value })} data-testid="project-step-notes" /></Field><div className="dialog-grid"><Field label="Scheduled date"><input type="date" value={inspectorDraft.scheduledDate} onChange={(event) => setInspectorDraft({ ...inspectorDraft, scheduledDate: event.target.value })} data-testid="project-step-scheduled-date" /></Field><Field label="Due date"><input type="date" value={inspectorDraft.dueDate} onChange={(event) => setInspectorDraft({ ...inspectorDraft, dueDate: event.target.value })} data-testid="project-step-due-date" /></Field></div><Field label="Assignee"><select value={inspectorDraft.assigneeId} disabled={memberStatus !== 'ready'} onChange={(event) => setInspectorDraft({ ...inspectorDraft, assigneeId: event.target.value })} data-testid="project-step-assignee">{memberOptions.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => { setDirectInspector(null); setInspectorDraft(null); }} data-testid="project-step-edit-cancel">Cancel</button><button className="primary-button" type="submit" data-testid="project-step-save">Save details</button></div></fieldset>
        {inspectorDraft.scheduledDate > inspectorDraft.dueDate && <p className="schedule-warning" role="status" data-testid="project-step-schedule-warning">This step is scheduled after its deadline.</p>}
      </form>}
    </div>;
  };

  const renderTemplateInspector = (template: ProjectTemplate) => {
    const linkedInstances = instances.filter((instance) => instance.templateId === template.id && (showCompleted || derivedStatus(instance) !== 'Done'));
    return <div className="template-detail" data-testid="project-template-inspector">
      <header className="template-detail-header"><div><span className="eyebrow">{template.anchorType}</span><p>{template.description || 'No description provided.'}</p></div><div className="row-actions"><button className="secondary-button" type="button" disabled={mutationDisabled} onClick={() => setTemplateDialog({ mode: 'edit', template })} data-testid={`project-template-edit-${template.id}`}><Icon name="rename" size={14} />Edit</button><button className="danger-button" type="button" disabled={mutationDisabled} onClick={() => setTemplateDelete(template)} data-testid={`project-template-delete-${template.id}`}><Icon name="delete" size={14} />Delete</button><button className="primary-button" type="button" disabled={mutationDisabled} onClick={() => { setAnchorDate(''); setInstanceName(''); setStartSuccess(null); setStartOpen(true); }} data-testid="project-start">Start Project</button></div></header>
      <nav className="template-tabs" aria-label={`${template.name} sections`}><button type="button" aria-pressed={!scopedInstances} onClick={() => navigate(`/projects/templates/${template.id}`)} data-testid="project-template-tab-steps">Template Steps</button><button type="button" aria-pressed={scopedInstances} onClick={() => navigate(`/projects/templates/${template.id}/instances`)} data-testid="project-template-tab-instances">Active Projects</button></nav>
      {scopedInstances ? <section className="template-instances-panel" data-testid="project-template-instances-panel"><div className="section-heading"><div><span className="eyebrow">Generated work</span><h3>Active Projects</h3></div><button className="secondary-button" type="button" onClick={refresh} data-testid="project-template-instances-refresh">Refresh</button></div>{linkedInstances.length ? <ul className="template-instance-summaries">{linkedInstances.map((instance) => <li key={instance.id}><strong>{instance.name}</strong><span>{instance.anchorDate} · {instance.owner.name} · {derivedStatus(instance)}</span></li>)}</ul> : <p className="inline-empty">No active projects from this template.</p>}</section> : <section className="template-steps-panel" data-testid="project-template-steps-panel"><div className="section-heading"><div><span className="eyebrow">Chronological offsets</span><h3>Template Steps</h3><p>Stored sort order is shown for API context; display order follows offset days.</p></div><button className="secondary-button" type="button" disabled={mutationDisabled} onClick={() => setStepDialog({ mode: 'create', templateId: template.id })} data-testid="project-step-add">Add Step</button></div>{template.steps.length ? <div className="template-step-list">{[...template.steps].sort((left, right) => left.offsetDays - right.offsetDays).map((step) => <article className="template-step" key={step.id} data-testid={`project-template-step-${step.id}`}><div className="offset-marker"><strong data-testid="project-step-offset-value">{step.offsetDays}</strong><span>days</span></div><div className="template-step-copy"><h4>{step.title}</h4><p>{step.offsetDescription || 'Relative to anchor'} · {projectMembers.find((person) => person.id === step.assigneeId)?.name}</p><span>Stored sortOrder <b data-testid="project-step-sort-order">{step.sortOrder}</b> · server-owned, not reorderable</span></div><div className="template-step-actions"><button className="icon-button" type="button" disabled={mutationDisabled} aria-label={`Edit ${step.title}`} onClick={() => setStepDialog({ mode: 'edit', templateId: template.id, step })} data-testid={`project-step-edit-${step.id}`}>✎</button><button className="icon-button danger-text" type="button" disabled={mutationDisabled} aria-label={`Delete ${step.title}`} onClick={() => setStepDelete({ templateId: template.id, step })} data-testid={`project-step-delete-${step.id}`}>×</button></div></article>)}</div> : <div className="inline-empty" data-testid="projects-no-template-steps"><h3>No steps yet</h3><p>Add the first offset from this template’s anchor date.</p><button className="primary-button" type="button" disabled={mutationDisabled} onClick={() => setStepDialog({ mode: 'create', templateId: template.id })} data-testid="projects-empty-add-step">Add Step</button></div>}</section>}
    </div>;
  };

  return <section className="page-shell pg-projects" data-testid="page-projects" aria-labelledby="projects-title">
    <header className="projects-header">
      <div className="projects-heading"><h1 id="projects-title" data-od-id="projects-title">Projects</h1><p>Build repeatable templates and manage active project work.</p></div>
      <div className="projects-header-controls">
        <label className="projects-state-picker"><span>View state</span><select value={surfaceState} onChange={(event) => writeState(event.target.value as ProjectsState)} data-testid="projects-state-select">{supportedStates.map((state) => <option key={state} value={state}>{state}</option>)}</select></label>
      </div>
    </header>
    <div className="projects-scroll" aria-busy={surfaceState === 'loading'}>
      {surfaceState === 'forbidden' && <div className="projects-prerequisite" role="status" data-testid="page-state-forbidden"><strong>Project owner access required</strong><span id="projects-owner-reason">You may inspect project context, but only the project owner can change people, steps, milestones, or delete the project.</span></div>}
      {surfaceState === 'readonly' && <div className="projects-prerequisite" role="status" data-testid="page-state-readonly"><strong>Projects are read-only</strong><span id="projects-readonly-reason">Inspection is available; return to the owning source or ask the project owner to make changes.</span></div>}
      <ListInspector
        className="projects-list-inspector"
        label="Projects"
        groups={[{ id: 'templates', label: 'Templates' }, { id: 'active-projects', label: 'Active projects' }]}
        items={projectItems}
        selectedId={effectiveSelectedRowId}
        onSelect={selectProjectItem}
        loading={surfaceState === 'loading'}
        error={surfaceState === 'server-error'
          ? <div className="projects-list-state" role="alert" data-testid="page-state-server-error"><strong>Could not load projects</strong><p>The project service returned an error without discarding the current context.</p><button className="primary-button" type="button" onClick={retry} data-testid="page-retry">Retry</button></div>
          : surfaceState === 'unavailable'
            ? <div className="projects-list-state" data-testid="page-state-unavailable"><strong>Projects are unavailable</strong><p>Reconnect the project service and authenticated desktop session before trying again.</p><button className="secondary-button" type="button" onClick={retry} data-testid="projects-check-again">Check again</button></div>
            : undefined}
        emptyState={<div className="projects-list-state" data-testid="page-state-empty"><strong data-testid={templateMode ? undefined : 'projects-no-active'}>{templateMode ? 'No templates yet' : 'No active projects yet'}</strong><p>{templateMode ? 'Create a reusable sequence for your next project.' : 'Choose a template to start a project from a tested sequence.'}</p>{templateMode ? <button className="primary-button" type="button" onClick={() => setTemplateDialog({ mode: 'create' })} data-testid="projects-empty-create-template">Create template</button> : <button className="primary-button" type="button" onClick={() => navigate('/projects/templates')} data-testid="projects-empty-open-templates">Open templates</button>}</div>}
        toolbar={<>
          <fieldset className="projects-mutation-gate" disabled={isReadonly || ['loading', 'server-error', 'unavailable'].includes(surfaceState)} aria-disabled={isReadonly ? 'true' : undefined} aria-describedby={isReadonly ? 'projects-readonly-reason' : undefined} data-testid="projects-mutations"><legend className="sr-only">Project mutation controls</legend><button className="primary-button" type="button" disabled={isForbidden} onClick={() => setTemplateDialog({ mode: 'create' })} data-testid="project-template-new">New template</button></fieldset>
          <button className="secondary-button" type="button" disabled={['loading', 'server-error', 'unavailable'].includes(surfaceState)} onClick={refresh} data-testid="projects-refresh">Refresh</button>
          <button className="secondary-button" type="button" disabled={['loading', 'server-error', 'unavailable', 'empty'].includes(surfaceState)} aria-pressed={showCompleted} onClick={() => setShowCompleted((value) => !value)} data-testid="projects-show-completed" data-od-id="projects-completed-filter">{showCompleted ? 'Hide completed' : 'Show completed'}</button>
        </>}
        listFooter={<span className="projects-list-count"><b>{templates.length}</b> templates · <b data-testid="projects-instance-count">{visibleInstances.length}</b> active projects</span>}
        inspector={(item) => {
          if (!item) return <div className="template-prompt"><h3>Select a template or active project</h3><p>Its ownership, steps, milestones, and actions will appear here.</p></div>;
          if (item.id.startsWith(templateRowPrefix)) {
            const template = templates.find((candidate) => templateRowId(candidate.id) === item.id);
            return template ? renderTemplateInspector(template) : null;
          }
          const instance = instances.find((candidate) => instanceRowId(candidate.id) === item.id);
          return instance ? renderProjectInspector(instance) : null;
        }}
      />
    </div>
    <output className="page-trace" aria-live="polite" data-testid="page-trace"><span>API receipt ledger</span><ol>{receipts.map((receipt, index) => <li key={`${receipt}-${index}`}>{receipt}</li>)}</ol></output>
    <span className="sr-only" data-testid="projects-fixture-snapshot">{fixtureSnapshot}</span>

    <FocusDialog open={Boolean(templateDialog)} onClose={() => setTemplateDialog(null)} title={templateDialog?.mode === 'edit' ? 'Edit template' : 'New template'} description="Templates keep supported identity fields intentionally focused." testId="project-template-dialog"><form className="project-dialog-form" onSubmit={saveTemplate}><Field label="Name"><input ref={templateNameRef} name="name" defaultValue={templateDialog?.mode === 'edit' ? templateDialog.template.name : ''} autoComplete="off" data-testid="project-template-name" /></Field><Field label="Description (optional)"><textarea name="description" rows={4} defaultValue={templateDialog?.mode === 'edit' ? templateDialog.template.description : ''} data-testid="project-template-description" /></Field><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setTemplateDialog(null)} data-testid="project-template-cancel">Cancel</button><button className="primary-button" type="submit" data-testid="project-template-submit">{templateDialog?.mode === 'edit' ? 'Save changes' : 'Create template'}</button></div></form></FocusDialog>
    <FocusDialog open={Boolean(templateDelete)} onClose={() => setTemplateDelete(null)} title={templateDelete ? `Delete “${templateDelete.name}”?` : 'Delete template?'} description="The template and every generated project associated with it will be removed." testId="project-template-delete-dialog"><p className="delete-copy">This action names its target and cannot be undone.</p><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setTemplateDelete(null)} data-testid="project-template-delete-cancel">Cancel</button><button className="danger-button" type="button" onClick={confirmTemplateDelete} data-testid="project-template-delete-confirm">Delete template</button></div></FocusDialog>
    <FocusDialog open={Boolean(stepDialog)} onClose={() => setStepDialog(null)} title={stepDialog?.mode === 'edit' ? 'Edit template step' : 'Add template step'} description="Offsets resolve chronologically from the project anchor." testId="project-template-step-dialog"><form className="project-dialog-form" onSubmit={saveTemplateStep}><Field label="Step title"><input ref={stepTitleRef} name="title" defaultValue={stepDialog?.mode === 'edit' ? stepDialog.step.title : ''} autoComplete="off" data-testid="project-step-title" /></Field><div className="dialog-grid"><Field label="Offset days"><input name="offsetDays" type="number" defaultValue={stepDialog?.mode === 'edit' ? stepDialog.step.offsetDays : 0} data-testid="project-step-offset-days" /></Field><Field label="Assignee"><select name="assigneeId" disabled={memberStatus !== 'ready'} defaultValue={stepDialog?.mode === 'edit' ? stepDialog.step.assigneeId : currentProjectUserId} data-testid="project-step-assignee">{memberOptions.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field></div><Field label="Offset description (optional)"><input name="offsetDescription" defaultValue={stepDialog?.mode === 'edit' ? stepDialog.step.offsetDescription : ''} data-testid="project-step-description" /></Field><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setStepDialog(null)} data-testid="project-step-cancel">Cancel</button><button className="primary-button" type="submit" data-testid="project-step-submit">Save step</button></div></form></FocusDialog>
    <FocusDialog open={Boolean(stepDelete)} onClose={() => setStepDelete(null)} title={stepDelete ? `Delete “${stepDelete.step.title}”?` : 'Delete step?'} description="The template step will no longer be generated." testId="project-step-delete-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setStepDelete(null)} data-testid="project-step-delete-cancel">Cancel</button><button className="danger-button" type="button" onClick={confirmStepDelete} data-testid="project-step-delete-confirm">Delete step</button></div></FocusDialog>
    <FocusDialog open={startOpen} onClose={() => setStartOpen(false)} title="Start Project" description={selectedTemplate ? `Generate from ${selectedTemplate.name}.` : undefined} testId="project-start-dialog" wide>{startSuccess ? <section className="start-success" role="status" data-testid="project-start-success"><span aria-hidden="true">✓</span><h3>Project started successfully</h3><p><strong>{startSuccess.name}</strong></p><p>Anchor {startSuccess.anchorDate} · {selectedTemplate?.steps.length ?? 0} generated steps</p><button className="primary-button" type="button" onClick={() => setStartOpen(false)} data-testid="project-start-done">Done</button></section> : <form className="project-dialog-form" onSubmit={startProject}><Field label="Project name (optional)"><input value={instanceName} onChange={(event) => setInstanceName(event.target.value)} data-testid="project-instance-name" /></Field><Field label="Anchor date"><input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} data-testid="project-anchor-date" /></Field>{anchorDate && selectedTemplate && <section className="date-preview" aria-live="polite" data-testid="project-date-preview"><span className="eyebrow">Resolved dates</span><ol>{[...selectedTemplate.steps].sort((left, right) => left.offsetDays - right.offsetDays).map((step) => <li key={step.id}><time data-testid={`project-preview-date-${step.id}`}>{addDays(anchorDate, step.offsetDays)}</time><span>{step.title}</span></li>)}</ol></section>}<div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setStartOpen(false)} data-testid="project-start-cancel">Cancel</button><button className="primary-button" type="submit" disabled={!anchorDate} data-testid="project-start-submit">Start Project</button></div></form>}</FocusDialog>
    <FocusDialog open={Boolean(milestoneOpenFor)} onClose={() => setMilestoneOpenFor(null)} title="Add milestone" description="Milestones group steps inside this project only." testId="project-milestone-dialog"><form className="project-dialog-form" onSubmit={addMilestone}><Field label="Milestone title"><input ref={milestoneTitleRef} name="title" autoComplete="off" data-testid="project-milestone-title" /></Field><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setMilestoneOpenFor(null)} data-testid="project-milestone-cancel">Cancel</button><button className="primary-button" type="submit" data-testid="project-milestone-submit">Add milestone</button></div></form></FocusDialog>
    <FocusDialog open={Boolean(milestoneDelete)} onClose={() => setMilestoneDelete(null)} title={milestoneDelete ? `Delete “${milestoneDelete.milestone.title}”?` : 'Delete milestone?'} description="Its steps will move to Ungrouped." testId="project-milestone-delete-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setMilestoneDelete(null)} data-testid="project-milestone-delete-cancel">Cancel</button><button className="danger-button" type="button" onClick={confirmMilestoneDelete} data-testid="project-milestone-delete-confirm">Delete milestone</button></div></FocusDialog>
    <FocusDialog open={Boolean(collaboratorOpenFor)} onClose={() => setCollaboratorOpenFor(null)} title="Add project collaborator" description="The owner and existing collaborators are excluded." testId="project-collaborator-picker"><div className="collaborator-options" role="listbox" aria-label="Workspace members">{memberStatus === 'error' ? <p role="alert">Workspace members could not be loaded.</p> : collaboratorOpenFor && memberOptions.filter((person) => { const instance = instances.find((item) => item.id === collaboratorOpenFor); return person.id !== instance?.owner.id && !instance?.collaborators.some((collaborator) => collaborator.id === person.id); }).map((person) => <button className="secondary-button" role="option" aria-selected="false" type="button" key={person.id} onClick={() => addCollaborator(collaboratorOpenFor, person.id)} data-testid={`project-collaborator-option-${person.id}`}><span aria-hidden="true">{person.initials}</span><strong>{person.name}</strong></button>)}</div></FocusDialog>
    <FocusDialog open={Boolean(instanceDelete)} onClose={() => setInstanceDelete(null)} title={instanceDelete ? `Delete “${instanceDelete.name}”?` : 'Delete active project?'} description="Only this generated project instance will be removed." testId="project-instance-delete-dialog"><p className="delete-copy">The template and neighboring project instances are preserved.</p><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setInstanceDelete(null)} data-testid="project-instance-delete-cancel">Cancel</button><button className="danger-button" type="button" onClick={confirmInstanceDelete} data-testid="project-instance-delete-confirm">Delete project</button></div></FocusDialog>
  </section>;
}
