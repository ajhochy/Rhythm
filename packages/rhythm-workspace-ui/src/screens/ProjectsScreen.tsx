// Ported from apps/web/src/pages/projects/index.tsx (723 lines) + fixtures.ts. Carried over: the
// template rail + "Start Project" flow, the active-project list/inspector split with a
// milestone-grouped (+ Ungrouped) step timeline, step completion, step-to-milestone
// reassignment, the step inspector (title/notes/scheduled+due date/assignee, with a
// scheduled-after-due warning), adding a milestone, and collaborator add/remove. Deliberately
// dropped at the host-neutral boundary: the hash-based mode/route (templates vs active,
// per-template scoping), the API-receipt ledger, the fixture-only page-state debug picker, and
// template/template-step authoring (create/edit/delete a template or its steps) — ProjectsGateway
// only exposes read-only `templates()` plus `generate()`; a template *builder* is a materially
// larger feature this narrower contract doesn't carry, tracked as a residual for a future gate.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRhythmDomainGateway } from '../context';
import { ScreenRoot } from './ScreenRoot';
import { FocusDialog } from '../components/FocusDialog';
import { RhythmGatewayError, type RhythmProject, type RhythmProjectStep, type RhythmProjectTemplate, type RhythmWorkspaceMember } from '../domain/types';

type ProjectsSurfaceState = 'loading' | 'ready' | 'empty' | 'forbidden' | 'unavailable' | 'server_error';
type InspectorDraft = Pick<RhythmProjectStep, 'title' | 'notes' | 'scheduledDate' | 'dueDate' | 'assigneeId'>;

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
  const [collaboratorPickerFor, setCollaboratorPickerFor] = useState<string | null>(null);
  const [instanceDelete, setInstanceDelete] = useState<RhythmProject | null>(null);
  const [inspector, setInspector] = useState<{ instanceId: string; stepId: string } | null>(null);
  const [inspectorDraft, setInspectorDraft] = useState<InspectorDraft | null>(null);
  const [mutationPending, setMutationPending] = useState(false);

  const handleError = (error: unknown) => {
    const kind = error instanceof RhythmGatewayError ? error.kind : 'server_error';
    setSurfaceState(kind === 'forbidden' ? 'forbidden' : kind === 'not_found' ? 'unavailable' : kind === 'unavailable' ? 'unavailable' : 'server_error');
  };

  const load = async () => {
    setSurfaceState('loading');
    try {
      const [loadedTemplates, loadedInstances, loadedMembers] = await Promise.all([gateway.templates(), gateway.list(), gateway.members()]);
      setTemplates(loadedTemplates);
      setInstances(loadedInstances);
      setMembers(loadedMembers);
      setSurfaceState(loadedTemplates.length || loadedInstances.length ? 'ready' : 'empty');
    } catch (error) {
      handleError(error);
    }
  };

  useEffect(() => { void load(); }, [gateway]);

  const showsWorkspace = surfaceState === 'ready';
  const visibleInstances = useMemo(() => instances.filter((instance) => showCompleted || derivedStatus(instance) !== 'Done'), [instances, showCompleted]);
  const selectedInstance = visibleInstances.find((instance) => instance.id === selectedInstanceId) ?? visibleInstances[0] ?? null;
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? templates[0] ?? null;
  const inspectorInstance = inspector ? instances.find((instance) => instance.id === inspector.instanceId) ?? null : null;
  const inspectorStep = inspector && inspectorInstance ? inspectorInstance.steps.find((step) => step.id === inspector.stepId) ?? null : null;

  const applyInstance = (updated: RhythmProject) => setInstances((current) => current.map((instance) => (instance.id === updated.id ? updated : instance)));
  const applyStep = (instanceId: string, step: RhythmProjectStep) =>
    setInstances((current) => current.map((instance) => (instance.id === instanceId ? { ...instance, steps: instance.steps.map((item) => (item.id === step.id ? step : item)) } : instance)));

  const toggleComplete = async (instance: RhythmProject, step: RhythmProjectStep) => {
    if (mutationPending) return;
    setMutationPending(true);
    try {
      const updated = await gateway.updateStep(instance.id, step.id, { status: step.status === 'done' ? 'open' : 'done' });
      applyStep(instance.id, updated);
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const assignMilestone = async (instance: RhythmProject, step: RhythmProjectStep, milestoneId: string) => {
    if (mutationPending) return;
    setMutationPending(true);
    try {
      const updated = await gateway.updateStep(instance.id, step.id, { milestoneId: milestoneId || null });
      applyStep(instance.id, updated);
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const openInspector = (instance: RhythmProject, step: RhythmProjectStep) => {
    setInspector({ instanceId: instance.id, stepId: step.id });
    setInspectorDraft({ title: step.title, notes: step.notes, scheduledDate: step.scheduledDate ?? '', dueDate: step.dueDate ?? '', assigneeId: step.assigneeId ?? '' });
  };
  const closeInspector = () => { setInspector(null); setInspectorDraft(null); };

  const saveInspector = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!inspector || !inspectorDraft || !inspectorDraft.title.trim() || mutationPending) return;
    setMutationPending(true);
    try {
      const updated = await gateway.updateStep(inspector.instanceId, inspector.stepId, { ...inspectorDraft, title: inspectorDraft.title.trim() });
      applyStep(inspector.instanceId, updated);
      closeInspector();
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const addMilestone = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedInstance || mutationPending) return;
    const title = String(new FormData(event.currentTarget).get('title') ?? '').trim();
    if (!title) return;
    setMutationPending(true);
    try {
      const milestone = await gateway.addMilestone(selectedInstance.id, { title });
      applyInstance({ ...selectedInstance, milestones: [...selectedInstance.milestones, milestone] });
      setMilestoneOpen(false);
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const addCollaborator = async (instanceId: string, memberId: string) => {
    try {
      const updated = await gateway.addCollaborator(instanceId, memberId);
      applyInstance(updated);
      setCollaboratorPickerFor(null);
    } catch (error) {
      handleError(error);
    }
  };

  const removeCollaborator = async (instanceId: string, memberId: string) => {
    try {
      const updated = await gateway.removeCollaborator(instanceId, memberId);
      applyInstance(updated);
    } catch (error) {
      handleError(error);
    }
  };

  const confirmDelete = async () => {
    if (!instanceDelete) return;
    setMutationPending(true);
    try {
      await gateway.delete(instanceDelete.id);
      setInstances((current) => current.filter((instance) => instance.id !== instanceDelete.id));
      setInstanceDelete(null);
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const startProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedTemplate || !anchorDate || mutationPending) return;
    setMutationPending(true);
    try {
      const created = await gateway.generate(selectedTemplate.id, { anchorDate, name: instanceName.trim() || undefined });
      setInstances((current) => [...current, created]);
      setSelectedInstanceId(created.id);
      setStartOpen(false);
      setAnchorDate('');
      setInstanceName('');
      if (surfaceState === 'empty') setSurfaceState('ready');
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const renderStepRow = (instance: RhythmProject, step: RhythmProjectStep) => (
    <article className="instance-step" key={step.id} data-status={step.status} data-testid={`project-instance-step-${step.id}`}>
      <label className="step-check">
        <span className="sr-only">{step.status === 'done' ? 'Reopen' : 'Complete'} {step.title}</span>
        <input type="checkbox" checked={step.status === 'done'} disabled={mutationPending} onChange={() => void toggleComplete(instance, step)} data-testid={`project-step-complete-${step.id}`} />
        <span aria-hidden="true" />
      </label>
      <div className="step-copy"><strong>{step.title}</strong><span>{step.scheduledDate ?? 'No date'} · {members.find((person) => person.id === step.assigneeId)?.name ?? 'Unassigned'}</span></div>
      <label className="milestone-select">
        <span className="sr-only">Milestone for {step.title}</span>
        <select value={step.milestoneId ?? ''} disabled={mutationPending} onChange={(event) => void assignMilestone(instance, step, event.target.value)} data-testid={`project-step-milestone-${step.id}`}>
          <option value="">Ungrouped</option>{instance.milestones.map((milestone) => <option value={milestone.id} key={milestone.id}>{milestone.title}</option>)}
        </select>
      </label>
      <button className="icon-button" type="button" aria-label={`Inspect ${step.title}`} onClick={() => openInspector(instance, step)} data-testid={`project-step-inspect-${step.id}`}>↗</button>
    </article>
  );

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
              <section className="templates-rail" aria-labelledby="project-templates-title">
                <header><h2 id="project-templates-title">Templates</h2><span>{templates.length}</span></header>
                <div className="template-list" role="grid" aria-label="Project templates" data-testid="project-templates-list">
                  {templates.map((template) => (
                    <div className="template-row" role="row" aria-selected={template.id === selectedTemplate?.id ? 'true' : 'false'} key={template.id} data-testid={`project-template-${template.id}`}>
                      <div role="gridcell">
                        <button className="template-select" type="button" onClick={() => setSelectedTemplateId(template.id)} data-testid={`project-template-select-${template.id}`}>
                          <strong>{template.name}</strong><span>{template.steps.length} steps · {template.anchorType}</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {selectedTemplate && (
                  <button className="primary-button" type="button" onClick={() => setStartOpen(true)} data-testid="project-start">Start Project</button>
                )}
              </section>

              <section className="active-projects" aria-labelledby="active-projects-title">
                <header className="active-toolbar">
                  <h2 id="active-projects-title">Active projects</h2>
                  <button className="secondary-button" type="button" aria-pressed={showCompleted} onClick={() => setShowCompleted((value) => !value)} data-testid="projects-show-completed">{showCompleted ? 'Hide completed' : 'Show completed'}</button>
                </header>
                <div className="project-board">
                  <section className="project-list-pane" aria-label="Active project list">
                    <div className="instance-list">
                      {visibleInstances.map((instance) => (
                        <article className={`instance-row${selectedInstance?.id === instance.id ? ' selected' : ''}`} key={instance.id} data-testid={`project-instance-${instance.id}`}>
                          <button className="instance-expand" type="button" aria-pressed={selectedInstance?.id === instance.id} onClick={() => setSelectedInstanceId(instance.id)} data-testid={`project-instance-expand-${instance.id}`}>
                            <span className="instance-date">{instance.anchorDate}</span>
                            <span className="instance-row-copy"><strong>{instance.name}</strong><small>{instance.steps.filter((step) => step.status === 'done').length}/{instance.steps.length} steps</small></span>
                            <span className="status-badge" data-testid={`project-instance-status-${instance.id}`}>{derivedStatus(instance)}</span>
                          </button>
                        </article>
                      ))}
                      {visibleInstances.length === 0 && <p className="inline-empty" data-testid="projects-no-active">No active projects yet. Start one from a template above.</p>}
                    </div>
                  </section>

                  {selectedInstance ? (
                    <aside className="project-inspector" aria-label="Selected project" data-testid="project-inspector">
                      <header className="project-inspector-header">
                        <div><h2>{selectedInstance.name}</h2><p>{selectedInstance.anchorDate} · {derivedStatus(selectedInstance)}</p></div>
                        <button className="danger-button" type="button" disabled={mutationPending} onClick={() => setInstanceDelete(selectedInstance)} data-testid={`project-instance-delete-${selectedInstance.id}`}>Delete</button>
                      </header>

                      <section className="people-strip" aria-labelledby={`people-${selectedInstance.id}`}>
                        <h3 id={`people-${selectedInstance.id}`}>Collaborators</h3>
                        <div className="people-list">
                          {selectedInstance.collaborators.map((person) => (
                            <span className="person-chip" key={person.id} data-testid={`project-collaborator-${person.id}`}>
                              <i aria-hidden="true">{person.initials}</i><strong>{person.name}</strong>
                              <button className="icon-button" type="button" aria-label={`Remove ${person.name}`} onClick={() => void removeCollaborator(selectedInstance.id, person.id)} data-testid={`project-collaborator-remove-${person.id}`}>×</button>
                            </span>
                          ))}
                          <button className="secondary-button" type="button" onClick={() => setCollaboratorPickerFor(selectedInstance.id)} data-testid="project-collaborator-add">Add person</button>
                        </div>
                      </section>

                      <div className="timeline-toolbar">
                        <h3>Milestones and steps</h3>
                        <button className="secondary-button" type="button" disabled={mutationPending} onClick={() => setMilestoneOpen(true)} data-testid="project-milestone-add">Add milestone</button>
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
                  ) : (
                    <aside className="project-inspector empty" aria-label="Selected project" data-testid="project-inspector"><h2>Select a project</h2><p>Project details, people, milestones, and steps appear here.</p></aside>
                  )}
                </div>
              </section>
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

        <FocusDialog open={milestoneOpen} onClose={() => setMilestoneOpen(false)} title="Add milestone" description="Milestones group steps inside this project only." testId="project-milestone-dialog">
          <form className="project-dialog-form" onSubmit={addMilestone}>
            <Field label="Milestone title"><input data-autofocus name="title" autoComplete="off" data-testid="project-milestone-title" /></Field>
            <div className="dialog-actions">
              <button className="secondary-button" type="button" onClick={() => setMilestoneOpen(false)} data-testid="project-milestone-cancel">Cancel</button>
              <button className="primary-button" type="submit" data-testid="project-milestone-submit">Add milestone</button>
            </div>
          </form>
        </FocusDialog>

        <FocusDialog open={Boolean(collaboratorPickerFor)} onClose={() => setCollaboratorPickerFor(null)} title="Add project collaborator" description="The owner and existing collaborators are excluded." testId="project-collaborator-picker">
          <div className="collaborator-options" role="listbox" aria-label="Workspace members">
            {collaboratorPickerFor && members.filter((person) => {
              const instance = instances.find((item) => item.id === collaboratorPickerFor);
              return person.id !== instance?.ownerId && !instance?.collaborators.some((collaborator) => collaborator.id === person.id);
            }).map((person) => (
              <button className="secondary-button" role="option" aria-selected="false" type="button" key={person.id} onClick={() => void addCollaborator(collaboratorPickerFor, person.id)} data-testid={`project-collaborator-option-${person.id}`}>
                <span aria-hidden="true">{person.initials}</span><strong>{person.name}</strong>
              </button>
            ))}
          </div>
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
              <fieldset disabled={mutationPending}>
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
      </section>
    </ScreenRoot>
  );
}
