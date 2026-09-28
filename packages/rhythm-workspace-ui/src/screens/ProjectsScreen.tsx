// Ported from apps/web/src/pages/projects/index.tsx (723 lines) + fixtures.ts. Carried over: the
// template rail + "Start Project" flow, the active-project list/inspector split with a
// milestone-grouped (+ Ungrouped) step timeline, step completion, step-to-milestone
// reassignment, the step inspector (title/notes/scheduled+due date/assignee, with a
// scheduled-after-due warning), adding a milestone, and collaborator add/remove. Deliberately
// dropped at the host-neutral boundary: the hash-based mode/route (templates vs active,
// per-template scoping), the API-receipt ledger, the fixture-only page-state debug picker, and
// template/template-step authoring, active-project inspection, and the API-receipt ledger.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRhythmDomainGateway, useRhythmHost } from '../context';
import { ScreenRoot } from './ScreenRoot';
import { FocusDialog } from '../components/FocusDialog';
import { ListInspector, type ListInspectorItem } from '../components/ListInspector';
import { RhythmGatewayError, type RhythmProject, type RhythmProjectStep, type RhythmProjectTemplate, type RhythmProjectTemplateStep, type RhythmWorkspaceMember } from '../domain/types';
import type { RhythmWorkspaceOperationConfirmation } from '../host/types';

type ProjectsSurfaceState = 'loading' | 'ready' | 'empty' | 'forbidden' | 'unavailable' | 'server_error';
type InspectorDraft = Pick<RhythmProjectStep, 'title' | 'notes' | 'scheduledDate' | 'dueDate' | 'assigneeId'>;
type ProjectOperation = Extract<RhythmWorkspaceOperationConfirmation['operation'], `projects.${string}`>;
type ProjectOperationTarget = { operation: ProjectOperation; entityId: string; payload: Record<string, string | number | boolean | null>; generation: string; mutate(): Promise<void> };

function derivedStatus(instance: RhythmProject) {
  return instance.steps.length > 0 && instance.steps.every((step) => step.status === 'done') ? 'Done' : 'Active';
}

function StatePanel({ state, onRetry }: { state: Exclude<ProjectsSurfaceState, 'ready'>; onRetry(): void }) {
  if (state === 'loading') return <section className="projects-state loading" role="status" aria-live="polite" data-testid="page-state-loading"><span className="eyebrow">Project ledger</span><h2>Loading projects</h2><p>Gathering templates, people, milestones, and active work.</p><div className="state-lines" aria-hidden="true"><span /><span /><span /></div></section>;
  if (state === 'empty') return <section className="projects-state" role="status" data-testid="page-state-empty"><span className="eyebrow">A clear ledger</span><h2>No projects yet</h2><p>Choose a template below to start the first project from a tested sequence.</p></section>;
  if (state === 'server_error') return <section className="projects-state danger" role="alert" data-testid="page-state-server-error"><span className="eyebrow">Retryable server error</span><h2>Could not load projects</h2><p>The project service returned an error without discarding the current context.</p><button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button></section>;
  if (state === 'forbidden') return <section className="projects-state warning" role="alert" data-testid="page-state-forbidden"><span className="eyebrow">Workspace permission required</span><h2>Projects access is restricted</h2><p>Ask a workspace administrator for project access.</p></section>;
  return <section className="projects-state warning" role="status" data-testid="page-state-unavailable"><span className="eyebrow">Service prerequisite</span><h2>Projects are unavailable</h2><p>Reconnect the project service before loading or changing projects.</p><button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button></section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="project-field"><span>{label}</span>{children}</label>;
}

export function ProjectsScreen() {
  const { projects: gateway } = useRhythmDomainGateway();
  const host = useRhythmHost();
  const capabilities = host.currentUser.capabilities ?? [];
  const can = (operation: ProjectOperation) => capabilities.includes('projects.write') || capabilities.includes(operation);
  const isOwner = (ownerId: string) => Boolean(host.currentUser.id && host.currentUser.id === ownerId);
  const identityKey = host.currentUser.id ?? host.currentUser.displayName;
  const [surfaceState, setSurfaceState] = useState<ProjectsSurfaceState>('loading');
  const [templates, setTemplates] = useState<RhythmProjectTemplate[]>([]);
  const [instances, setInstances] = useState<RhythmProject[]>([]);
  const [members, setMembers] = useState<RhythmWorkspaceMember[]>([]);
  const [showCompleted, setShowCompleted] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [anchorDate, setAnchorDate] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [milestoneOpen, setMilestoneOpen] = useState(false);
  const [instanceDelete, setInstanceDelete] = useState<RhythmProject | null>(null);
  const [inspector, setInspector] = useState<{ instanceId: string; stepId: string } | null>(null);
  const [inspectorDraft, setInspectorDraft] = useState<InspectorDraft | null>(null);
  const [mutationPending, setMutationPending] = useState(false);
  const [templateEditor, setTemplateEditor] = useState<RhythmProjectTemplate | 'new' | null>(null);
  const [templateStepEditor, setTemplateStepEditor] = useState<{ templateId: string; step?: RhythmProjectTemplateStep } | null>(null);
  const [operationTarget, setOperationTarget] = useState<ProjectOperationTarget | null>(null);
  const [operationError, setOperationError] = useState<'conflict' | 'uncertain' | null>(null);
  const loadGeneration = useRef(0);
  const operationGeneration = useRef(0);
  const operationEpoch = useRef(0);
  const mounted = useRef(true);

  const handleError = (error: unknown) => {
    const kind = error instanceof RhythmGatewayError ? error.kind : 'server_error';
    setSurfaceState(kind === 'forbidden' ? 'forbidden' : kind === 'not_found' ? 'unavailable' : kind === 'unavailable' ? 'unavailable' : 'server_error');
  };

  const load = async () => {
    const generation = ++loadGeneration.current;
    setSurfaceState('loading');
    try {
      const [loadedTemplates, loadedInstances, loadedMembers] = await Promise.all([gateway.templates(), gateway.list(), gateway.members()]);
      if (generation !== loadGeneration.current) return;
      setTemplates(loadedTemplates);
      setInstances(loadedInstances);
      setMembers(loadedMembers);
      setSurfaceState(loadedTemplates.length || loadedInstances.length ? 'ready' : 'empty');
    } catch (error) {
      if (generation === loadGeneration.current) handleError(error);
    }
  };

  useEffect(() => {
    setSelectedTemplateId(null);
    setSelectedInstanceId(null);
    setInspector(null);
    setInspectorDraft(null);
    setStartOpen(false);
    setMilestoneOpen(false);
    setInstanceDelete(null);
    setTemplateEditor(null);
    setTemplateStepEditor(null);
    closeOperation();
    void load();
    return () => { loadGeneration.current += 1; };
  }, [gateway, identityKey]);
  useEffect(() => () => { mounted.current = false; operationEpoch.current += 1; }, []);

  const showsWorkspace = surfaceState === 'ready';
  const visibleInstances = useMemo(() => instances.filter((instance) => showCompleted || derivedStatus(instance) !== 'Done'), [instances, showCompleted]);
  const selectedInstance = visibleInstances.find((instance) => instance.id === selectedInstanceId) ?? null;
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? templates[0] ?? null;
  const inspectorInstance = inspector ? instances.find((instance) => instance.id === inspector.instanceId) ?? null : null;
  const inspectorStep = inspector && inspectorInstance ? inspectorInstance.steps.find((step) => step.id === inspector.stepId) ?? null : null;

  const applyInstance = (updated: RhythmProject) => setInstances((current) => current.map((instance) => (instance.id === updated.id ? updated : instance)));
  const applyStep = (instanceId: string, step: RhythmProjectStep) =>
    setInstances((current) => current.map((instance) => (instance.id === instanceId ? { ...instance, steps: instance.steps.map((item) => (item.id === step.id ? step : item)) } : instance)));

  const closeOperation = () => { operationEpoch.current += 1; setOperationError(null); setOperationTarget(null); };
  const requestOperation = (operation: ProjectOperation, entityId: string, payload: ProjectOperationTarget['payload'], mutate: ProjectOperationTarget['mutate']) => {
    if (!can(operation) || mutationPending) return;
    operationGeneration.current += 1;
    operationEpoch.current += 1;
    setOperationError(null);
    setOperationTarget({ operation, entityId, payload, mutate, generation: `${entityId}:${operation}:${operationGeneration.current}:${Date.now()}` });
  };
  const retryOperation = () => {
    if (!operationTarget || mutationPending) return;
    operationGeneration.current += 1;
    operationEpoch.current += 1;
    setOperationError(null);
    setOperationTarget((target) => target && ({ ...target, generation: `${target.entityId}:${target.operation}:${operationGeneration.current}:${Date.now()}` }));
  };
  const confirmOperation = async () => {
    if (!operationTarget || mutationPending) return;
    const target = operationTarget;
    const epoch = operationEpoch.current;
    setMutationPending(true);
    try {
      const confirmation: RhythmWorkspaceOperationConfirmation = { operation: target.operation, entityId: target.entityId, payload: target.payload, generation: target.generation };
      if (host.confirmWorkspaceOperation && !(await host.confirmWorkspaceOperation(confirmation))) return;
      if (!mounted.current || operationEpoch.current !== epoch || operationTarget !== target) return;
      await target.mutate();
      if (!mounted.current || operationEpoch.current !== epoch || operationTarget !== target) return;
      setOperationTarget(null);
    } catch (error) {
      const kind = (error as { kind?: unknown } | null)?.kind;
      if (kind === 'conflict' || kind === 'uncertain') setOperationError(kind);
      else handleError(error);
    } finally { if (mounted.current) setMutationPending(false); }
  };

  const toggleComplete = async (instance: RhythmProject, step: RhythmProjectStep) => {
    requestOperation('projects.update-step', step.id, { instanceId: instance.id, status: step.status === 'done' ? 'open' : 'done' }, async () => {
      const updated = await gateway.updateStep(instance.id, step.id, { instanceId: instance.id, status: step.status === 'done' ? 'open' : 'done' });
      applyStep(instance.id, updated);
    });
  };

  const assignMilestone = async (instance: RhythmProject, step: RhythmProjectStep, milestoneId: string) => {
    requestOperation('projects.update-step', step.id, { instanceId: instance.id, milestoneId: milestoneId || null }, async () => {
      const updated = await gateway.updateStep(instance.id, step.id, { instanceId: instance.id, milestoneId: milestoneId || null });
      applyStep(instance.id, updated);
    });
  };

  const openInspector = (instance: RhythmProject, step: RhythmProjectStep) => {
    setInspector({ instanceId: instance.id, stepId: step.id });
    setInspectorDraft({ title: step.title, notes: step.notes, scheduledDate: step.scheduledDate ?? '', dueDate: step.dueDate ?? '', assigneeId: step.assigneeId ?? '' });
  };
  const closeInspector = () => { setInspector(null); setInspectorDraft(null); };

  const saveInspector = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!inspector || !inspectorDraft || !inspectorDraft.title.trim()) return;
    const input = { ...inspectorDraft, title: inspectorDraft.title.trim() };
    requestOperation('projects.update-step', inspector.stepId, { instanceId: inspector.instanceId, title: input.title.slice(0, 200), notes: input.notes.slice(0, 2000), scheduledDate: input.scheduledDate || null, dueDate: input.dueDate || null, assigneeId: input.assigneeId || null }, async () => {
      const updated = await gateway.updateStep(inspector.instanceId, inspector.stepId, { ...input, instanceId: inspector.instanceId });
      applyStep(inspector.instanceId, updated);
      closeInspector();
    });
  };

  const addMilestone = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedInstance || !isOwner(selectedInstance.ownerId)) return;
    const title = String(new FormData(event.currentTarget).get('title') ?? '').trim();
    if (!title) return;
    requestOperation('projects.create-milestone', selectedInstance.id, { title: title.slice(0, 200) }, async () => {
      const milestone = await gateway.addMilestone(selectedInstance.id, { title });
      applyInstance({ ...selectedInstance, milestones: [...selectedInstance.milestones, milestone] });
      setMilestoneOpen(false);
    });
  };

  const confirmDelete = async () => {
    if (!instanceDelete || !isOwner(instanceDelete.ownerId)) return;
    const instance = instanceDelete;
    setInstanceDelete(null);
    requestOperation('projects.delete-instance', instance.id, {}, async () => {
      await gateway.delete(instance.id);
      setInstances((current) => current.filter((item) => item.id !== instance.id));
    });
  };

  const startProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedTemplate || !anchorDate) return;
    const normalizedName = instanceName.trim().slice(0, 200);
    const input: { anchorDate: string; name?: string } = { anchorDate };
    if (normalizedName) input.name = normalizedName;
    requestOperation('projects.create-instance', selectedTemplate.id, input, async () => {
      const created = await gateway.generate(selectedTemplate.id, input);
      setInstances((current) => [...current, created]);
      setSelectedInstanceId(created.id);
      setStartOpen(false);
      setAnchorDate('');
      setInstanceName('');
      if (surfaceState === 'empty') setSurfaceState('ready');
    });
  };

  const saveTemplate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!templateEditor) return;
    const data = new FormData(event.currentTarget);
    const input = { name: String(data.get('name') ?? '').trim(), description: String(data.get('description') ?? '').trim(), anchorType: String(data.get('anchorType') ?? '').trim() };
    if (!input.name || !input.anchorType) return;
    const editor = templateEditor;
    requestOperation(editor === 'new' ? 'projects.create-template' : 'projects.update-template', editor === 'new' ? 'new-template' : editor.id, { name: input.name.slice(0, 200), description: input.description.slice(0, 2000), anchorType: input.anchorType.slice(0, 200) }, async () => {
      const saved = editor === 'new' ? await gateway.createTemplate(input) : await gateway.updateTemplate(editor.id, input);
      setTemplates((current) => templateEditor === 'new' ? (current.some((template) => template.id === saved.id) ? current : [...current, saved]) : current.map((template) => template.id === saved.id ? saved : template));
      setSelectedTemplateId(saved.id); setTemplateEditor(null);
    });
  };

  const deleteTemplate = async (template: RhythmProjectTemplate) => {
    requestOperation('projects.delete-template', template.id, {}, async () => { await gateway.deleteTemplate(template.id); setTemplates((current) => current.filter((item) => item.id !== template.id)); setSelectedTemplateId(null); });
  };

  const saveTemplateStep = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!templateStepEditor) return;
    const data = new FormData(event.currentTarget);
    const input = {
      title: String(data.get('title') ?? '').trim(),
      offsetDays: Number(data.get('offsetDays') ?? 0),
      offsetDescription: String(data.get('offsetDescription') ?? '').trim(),
      assigneeId: String(data.get('assigneeId') ?? '') || undefined,
    };
    if (!input.title || !Number.isFinite(input.offsetDays) || !input.offsetDescription) return;
    const editor = templateStepEditor;
    requestOperation(editor.step ? 'projects.update-template-step' : 'projects.create-step', editor.step?.id ?? editor.templateId, { templateId: editor.templateId, title: input.title.slice(0, 200), offsetDays: input.offsetDays, offsetDescription: input.offsetDescription.slice(0, 200), assigneeId: input.assigneeId ?? null }, async () => {
      const saved = editor.step
        ? await gateway.updateTemplateStep(editor.templateId, editor.step.id, { ...input, templateId: editor.templateId })
        : await gateway.addTemplateStep(editor.templateId, { ...input, templateId: editor.templateId });
      setTemplates((current) => current.map((template) => template.id !== templateStepEditor.templateId ? template : {
        ...template,
        steps: templateStepEditor.step
          ? template.steps.map((step) => step.id === saved.id ? saved : step)
          : (template.steps.some((step) => step.id === saved.id) ? template.steps : [...template.steps, saved]),
      }));
      setTemplateEditor((current) => current === 'new' || !current || current.id !== templateStepEditor.templateId ? current : {
        ...current,
        steps: templateStepEditor.step ? current.steps.map((step) => step.id === saved.id ? saved : step) : (current.steps.some((step) => step.id === saved.id) ? current.steps : [...current.steps, saved]),
      });
      setTemplateStepEditor(null);
    });
  };

  const deleteTemplateStep = async (templateId: string, stepId: string) => {
    requestOperation('projects.delete-step', stepId, { templateId }, async () => {
      await gateway.deleteTemplateStep(templateId, stepId);
      const remove = (template: RhythmProjectTemplate) => ({ ...template, steps: template.steps.filter((step) => step.id !== stepId) });
      setTemplates((current) => current.map((template) => template.id === templateId ? remove(template) : template));
      setTemplateEditor((current) => current === 'new' || !current || current.id !== templateId ? current : remove(current));
    });
  };

  const renderStepRow = (instance: RhythmProject, step: RhythmProjectStep) => (
    <article className="instance-step" key={step.id} data-status={step.status} data-testid={`project-instance-step-${step.id}`}>
      <label className="step-check">
        <span className="sr-only">{step.status === 'done' ? 'Reopen' : 'Complete'} {step.title}</span>
        <input type="checkbox" checked={step.status === 'done'} disabled={mutationPending || !can('projects.update-step')} title={!can('projects.update-step') ? 'This host grants inspection only.' : undefined} onChange={() => void toggleComplete(instance, step)} data-testid={`project-step-complete-${step.id}`} />
        <span aria-hidden="true" />
      </label>
      <div className="step-copy"><strong>{step.title}</strong><span>{step.scheduledDate ?? 'No date'} · {members.find((person) => person.id === step.assigneeId)?.name ?? 'Unassigned'}</span></div>
      <label className="milestone-select">
        <span className="sr-only">Milestone for {step.title}</span>
        <select value={step.milestoneId ?? ''} disabled={mutationPending || !can('projects.update-step')} title={!can('projects.update-step') ? 'This host grants inspection only.' : undefined} onChange={(event) => void assignMilestone(instance, step, event.target.value)} data-testid={`project-step-milestone-${step.id}`}>
          <option value="">Ungrouped</option>{instance.milestones.map((milestone) => <option value={milestone.id} key={milestone.id}>{milestone.title}</option>)}
        </select>
      </label>
      <button className="icon-button" type="button" aria-label={`Inspect ${step.title}`} onClick={() => openInspector(instance, step)} data-testid={`project-step-inspect-${step.id}`}>↗</button>
    </article>
  );

  const templateRowId = (id: string) => `template:${id}`;
  const instanceRowId = (id: string) => `instance:${id}`;
  const projectItems: ListInspectorItem[] = [
    ...templates.map((template) => ({ id: templateRowId(template.id), title: template.name, subtitle: `${template.steps.length} steps · ${template.anchorType}`, group: 'templates', testId: `project-template-${template.id}`, testAliases: [`project-template-select-${template.id}`] })),
    ...visibleInstances.map((instance) => ({ id: instanceRowId(instance.id), title: instance.name, subtitle: `${instance.steps.filter((step) => step.status === 'done').length}/${instance.steps.length} steps`, meta: instance.anchorDate, badge: derivedStatus(instance), badgeTestId: `project-instance-status-${instance.id}`, group: 'active-projects', testId: `project-instance-${instance.id}`, testAliases: [`project-instance-expand-${instance.id}`] })),
  ];
  const selectedProjectRowId = selectedInstanceId ? instanceRowId(selectedInstanceId) : selectedTemplateId ? templateRowId(selectedTemplateId) : null;
  const selectProjectRow = (id: string) => {
    closeOperation();
    if (id.startsWith('template:')) { setSelectedTemplateId(id.slice('template:'.length)); setSelectedInstanceId(null); }
    else { setSelectedInstanceId(id.slice('instance:'.length)); setSelectedTemplateId(null); }
  };

  return (
    <ScreenRoot screenName="Projects" testId="rhythm-projects-screen">
      <section className="page-shell pg-projects" aria-busy={surfaceState === 'loading'}>
        <header className="projects-header">
          <div className="projects-heading"><span className="eyebrow">Ministry work</span><h1>Projects</h1><p>Start repeatable work from a template and manage active project steps.</p></div>
          <span data-testid="projects-visible-count">{visibleInstances.length} {visibleInstances.length === 1 ? 'project' : 'projects'}</span>
        </header>

        <div className="projects-scroll">
          {!showsWorkspace && <StatePanel state={surfaceState} onRetry={() => void load()} />}
          {showsWorkspace && (
            <>
              <span className="sr-only" data-testid="project-templates-list">{templates.length} templates</span>
              <ListInspector
                label="Projects"
                groups={[{ id: 'templates', label: 'Templates' }, { id: 'active-projects', label: 'Active projects' }]}
                items={projectItems}
                selectedId={selectedProjectRowId}
                onSelect={selectProjectRow}
                identityKey={identityKey}
                toolbar={<>
                  <button className="secondary-button" type="button" disabled={!can('projects.create-template')} title={!can('projects.create-template') ? 'This host grants inspection only.' : undefined} onClick={() => setTemplateEditor('new')} data-testid="project-template-new">New template</button>
                  <button className="primary-button" type="button" disabled={!selectedTemplate || !can('projects.create-instance')} title={!can('projects.create-instance') ? 'This host grants inspection only.' : undefined} onClick={() => setStartOpen(true)} data-testid="project-start">Start Project</button>
                  <button className="secondary-button" type="button" aria-pressed={showCompleted} onClick={() => setShowCompleted((value) => !value)} data-testid="projects-show-completed">{showCompleted ? 'Hide completed' : 'Show completed'}</button>
                </>}
                listFooter={visibleInstances.length === 0 ? <p className="inline-empty" data-testid="projects-no-active">No active projects yet. Start one from a template above.</p> : undefined}
                emptySelection={<aside className="project-inspector empty" aria-label="Selected project" data-testid="project-inspector"><h3>Select a template or project</h3><p>Project details, people, milestones, and steps appear here.</p></aside>}
                inspector={() => selectedInstance ? (
                    <aside className="project-inspector" aria-label="Selected project" data-testid="project-inspector">
                      <header className="project-inspector-header">
                        <div><h2>{selectedInstance.name}</h2><p>{selectedInstance.anchorDate} · {derivedStatus(selectedInstance)}</p></div>
                        <button className="danger-button" type="button" disabled={mutationPending || !can('projects.delete-instance') || !isOwner(selectedInstance.ownerId)} title={!isOwner(selectedInstance.ownerId) ? 'Only the project owner can delete or manage collaborators.' : !can('projects.delete-instance') ? 'This host grants inspection only.' : undefined} onClick={() => setInstanceDelete(selectedInstance)} data-testid={`project-instance-delete-${selectedInstance.id}`}>Delete</button>
                      </header>

                      <section className="people-strip" aria-labelledby={`people-${selectedInstance.id}`}>
                        <h3 id={`people-${selectedInstance.id}`}>Collaborators</h3>
                        <div className="people-list">
                          {selectedInstance.collaborators.map((person) => (
                            <span className="person-chip" key={person.id} data-testid={`project-collaborator-${person.id}`}>
                              <i aria-hidden="true">{person.initials}</i><strong>{person.name}</strong>
                              <button className="icon-button" type="button" disabled aria-label={`Remove ${person.name}`} title="Collaborator management is not available in this workspace." data-testid={`project-collaborator-remove-${person.id}`}>×</button>
                            </span>
                          ))}
                          <button className="secondary-button" type="button" disabled title="Collaborator management is not available in this workspace." data-testid="project-collaborator-add">Add person</button>
                        </div>
                      </section>

                      <div className="timeline-toolbar">
                        <h3>Milestones and steps</h3>
                        <button className="secondary-button" type="button" disabled={mutationPending || !can('projects.create-milestone') || !isOwner(selectedInstance.ownerId)} onClick={() => setMilestoneOpen(true)} data-testid="project-milestone-add">Add milestone</button>
                      </div>
                      <div className="milestone-list">
                        {selectedInstance.milestones.map((milestone) => (
                          <section className="milestone-group" key={milestone.id} data-testid={`project-milestone-${milestone.id}`}>
                            <header><h4>{milestone.title}</h4></header>
                            {selectedInstance.steps.filter((step) => step.milestoneId === milestone.id).map((step) => renderStepRow(selectedInstance, step))}
                          </section>
                        ))}
                        <section className="milestone-group ungrouped" data-testid="project-milestone-ungrouped">
                          <header><h4>Ungrouped</h4></header>
                          {selectedInstance.steps.filter((step) => !step.milestoneId).map((step) => renderStepRow(selectedInstance, step))}
                        </section>
                      </div>
                    </aside>
                  ) : selectedTemplate ? (
                    <section className="template-detail" data-testid="project-template-inspector">
                      <header><div><h3>{selectedTemplate.name}</h3><p>{selectedTemplate.description}</p><span>{selectedTemplate.steps.length} steps · {selectedTemplate.anchorType}</span></div><div className="row-actions">
                        <button className="text-button" type="button" disabled={!(can('projects.update-template') || can('projects.create-step') || can('projects.update-step') || can('projects.delete-step'))} onClick={() => setTemplateEditor(selectedTemplate)} data-testid={`project-template-edit-${selectedTemplate.id}`}>Edit</button>
                        <button className="text-danger-button" type="button" disabled={!can('projects.delete-template')} onClick={() => void deleteTemplate(selectedTemplate)} data-testid={`project-template-delete-${selectedTemplate.id}`}>Delete</button>
                      </div></header>
                    </section>
                  ) : null}
              />
            </>
          )}
        </div>

        <FocusDialog open={startOpen} onClose={() => setStartOpen(false)} title="Start Project" description={selectedTemplate ? `Generate from ${selectedTemplate.name}.` : undefined} testId="project-start-dialog" wide>
          <form className="project-dialog-form" onSubmit={startProject}>
            <Field label="Project name (optional)"><input data-autofocus value={instanceName} onChange={(event) => setInstanceName(event.target.value)} data-testid="project-instance-name" /></Field>
            <Field label="Anchor date"><input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} data-testid="project-anchor-date" /></Field>
            <div className="dialog-actions">
              <button className="secondary-button" type="button" onClick={() => setStartOpen(false)} data-testid="project-start-cancel">Cancel</button>
              <button className="primary-button" type="submit" disabled={!anchorDate || mutationPending} data-testid="project-start-submit">Start Project</button>
            </div>
          </form>
        </FocusDialog>

        <FocusDialog open={Boolean(templateEditor)} onClose={() => setTemplateEditor(null)} title={templateEditor === 'new' ? 'New template' : 'Edit template'} description="Templates stay reusable; project instances are unchanged." testId="project-template-dialog">
          {templateEditor && <form className="project-dialog-form" onSubmit={saveTemplate}>
            <Field label="Template name"><input name="name" data-autofocus defaultValue={templateEditor === 'new' ? '' : templateEditor.name} data-testid="project-template-name" /></Field>
            <Field label="Description"><textarea name="description" defaultValue={templateEditor === 'new' ? '' : templateEditor.description} data-testid="project-template-description" /></Field>
            <Field label="Anchor type"><input name="anchorType" defaultValue={templateEditor === 'new' ? 'Service date' : templateEditor.anchorType} data-testid="project-template-anchor-type" /></Field>
            <div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setTemplateEditor(null)}>Cancel</button><button className="primary-button" type="submit" disabled={mutationPending || !can(templateEditor === 'new' ? 'projects.create-template' : 'projects.update-template')} data-testid="project-template-save">Save template</button></div>
          </form>}
          {templateEditor !== 'new' && templateEditor && <section className="template-step-editor" aria-labelledby="project-template-steps-title">
            <header><h3 id="project-template-steps-title">Template steps</h3><button className="secondary-button" type="button" disabled={!can('projects.create-step')} title={!can('projects.create-step') ? 'This host grants inspection only.' : undefined} onClick={() => setTemplateStepEditor({ templateId: templateEditor.id })} data-testid="project-template-step-add">Add step</button></header>
            {templateEditor.steps.map((step) => <div key={step.id} data-testid={`project-template-step-${step.id}`}><strong>{step.title}</strong><span>{step.offsetDescription} · {members.find((person) => person.id === step.assigneeId)?.name ?? 'Unassigned'}</span><button className="text-button" type="button" disabled={!can('projects.update-template-step')} onClick={() => setTemplateStepEditor({ templateId: templateEditor.id, step })} data-testid={`project-template-step-edit-${step.id}`}>Edit</button><button className="text-danger-button" type="button" disabled={!can('projects.delete-step')} onClick={() => void deleteTemplateStep(templateEditor.id, step.id)} data-testid={`project-template-step-delete-${step.id}`}>Delete</button></div>)}
          </section>}
        </FocusDialog>

        <FocusDialog open={Boolean(templateStepEditor)} onClose={() => setTemplateStepEditor(null)} title={templateStepEditor?.step ? 'Edit template step' : 'Add template step'} description="Offsets are relative to the project anchor date." testId="project-template-step-dialog">
          {templateStepEditor && <form className="project-dialog-form" onSubmit={saveTemplateStep}>
            <Field label="Step title"><input name="title" data-autofocus defaultValue={templateStepEditor.step?.title ?? ''} data-testid="project-template-step-title" /></Field>
            <Field label="Offset days"><input name="offsetDays" type="number" defaultValue={templateStepEditor.step?.offsetDays ?? 0} data-testid="project-template-step-offset-days" /></Field>
            <Field label="Offset description"><input name="offsetDescription" defaultValue={templateStepEditor.step?.offsetDescription ?? 'On anchor date'} data-testid="project-template-step-offset-description" /></Field>
            <Field label="Assignee"><select name="assigneeId" defaultValue={templateStepEditor.step?.assigneeId ?? ''} data-testid="project-template-step-assignee"><option value="">Unassigned</option>{members.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>
            <div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setTemplateStepEditor(null)}>Cancel</button><button className="primary-button" type="submit" disabled={mutationPending || !can(templateStepEditor.step ? 'projects.update-template-step' : 'projects.create-step')} data-testid="project-template-step-save">Save step</button></div>
          </form>}
        </FocusDialog>

        <FocusDialog open={milestoneOpen} onClose={() => setMilestoneOpen(false)} title="Add milestone" description="Milestones group steps inside this project only." testId="project-milestone-dialog">
          <form className="project-dialog-form" onSubmit={addMilestone}>
            <Field label="Milestone title"><input data-autofocus name="title" autoComplete="off" data-testid="project-milestone-title" /></Field>
            <div className="dialog-actions">
              <button className="secondary-button" type="button" onClick={() => setMilestoneOpen(false)} data-testid="project-milestone-cancel">Cancel</button>
              <button className="primary-button" type="submit" data-testid="project-milestone-submit">Add milestone</button>
            </div>
          </form>
        </FocusDialog>

        <FocusDialog open={Boolean(instanceDelete)} onClose={() => setInstanceDelete(null)} title={instanceDelete ? `Delete "${instanceDelete.name}"?` : 'Delete project?'} description="Only this generated project instance will be removed." testId="project-instance-delete-dialog">
          <p className="delete-copy">The template and neighboring project instances are preserved.</p>
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={() => setInstanceDelete(null)} data-testid="project-instance-delete-cancel">Cancel</button>
            <button className="danger-button" type="button" disabled={mutationPending} onClick={() => void confirmDelete()} data-testid="project-instance-delete-confirm">Delete project</button>
          </div>
        </FocusDialog>

        <FocusDialog open={Boolean(inspectorStep)} onClose={closeInspector} title={inspectorStep?.title ?? 'Project step'} description="Project context stays visible while supported step fields are edited." testId="project-step-inspector" wide>
          {inspectorStep && inspectorDraft && (
            <form className="project-dialog-form inspector-form" onSubmit={saveInspector}>
              <fieldset disabled={mutationPending || !can('projects.update-step')} title={!can('projects.update-step') ? 'This host grants inspection only.' : undefined}>
                <legend className="sr-only">Project step fields</legend>
                <Field label="Title"><input data-autofocus value={inspectorDraft.title} onChange={(event) => setInspectorDraft({ ...inspectorDraft, title: event.target.value })} data-testid="project-step-title" /></Field>
                <Field label="Notes"><textarea rows={4} value={inspectorDraft.notes} onChange={(event) => setInspectorDraft({ ...inspectorDraft, notes: event.target.value })} data-testid="project-step-notes" /></Field>
                <div className="dialog-grid">
                  <Field label="Scheduled date"><input type="date" value={inspectorDraft.scheduledDate} onChange={(event) => setInspectorDraft({ ...inspectorDraft, scheduledDate: event.target.value })} data-testid="project-step-scheduled-date" /></Field>
                  <Field label="Due date"><input type="date" value={inspectorDraft.dueDate} onChange={(event) => setInspectorDraft({ ...inspectorDraft, dueDate: event.target.value })} data-testid="project-step-due-date" /></Field>
                </div>
                <Field label="Assignee"><select value={inspectorDraft.assigneeId} onChange={(event) => setInspectorDraft({ ...inspectorDraft, assigneeId: event.target.value })} data-testid="project-step-assignee">
                  <option value="">Unassigned</option>{members.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                </select></Field>
                {inspectorDraft.scheduledDate && inspectorDraft.dueDate && inspectorDraft.scheduledDate > inspectorDraft.dueDate && (
                  <p className="schedule-warning" role="status" data-testid="project-step-schedule-warning">This step is scheduled after its deadline.</p>
                )}
                <div className="dialog-actions"><button className="primary-button" type="submit" disabled={mutationPending} data-testid="project-step-save">Save details</button></div>
              </fieldset>
            </form>
          )}
        </FocusDialog>

        <FocusDialog open={Boolean(operationTarget)} onClose={closeOperation} title="Confirm project operation" description="Confirm this exact project change before it is sent to the workspace." testId="project-operation-confirmation">
          {operationTarget && (
            <>
              {operationError && <p className="operation-outcome" role="alert" data-testid="project-operation-outcome">This project changed elsewhere or its result is uncertain. Reload current data or retry with a fresh confirmation.</p>}
              <div className="dialog-actions">
                {operationError && <button className="secondary-button" type="button" disabled={mutationPending} onClick={() => { closeOperation(); void load(); }} data-testid="project-operation-reload">Reload</button>}
                {operationError && <button className="secondary-button" type="button" disabled={mutationPending} onClick={retryOperation} data-testid="project-operation-retry">Retry</button>}
                <button className="secondary-button" type="button" disabled={mutationPending} onClick={closeOperation} data-testid="project-operation-cancel">Cancel</button>
                <button className="primary-button" type="button" disabled={mutationPending} onClick={() => void confirmOperation()} data-testid="project-operation-confirm">Confirm</button>
              </div>
            </>
          )}
        </FocusDialog>
      </section>
    </ScreenRoot>
  );
}
