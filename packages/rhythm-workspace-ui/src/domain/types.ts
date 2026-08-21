// Narrow, host-neutral Rhythm domain-gateway contracts.
//
// Each interface below is a pure data port: it describes what a screen needs to read and
// write, never how the host authenticates or transports the call. A host adapter (living in
// the consuming app, e.g. an Electron renderer or a Hermes plugin shell) implements these by
// wrapping its own authenticated client. This file must never construct a fetch(), an
// Authorization header, or reference an agent session — see tests/forbidden-imports.test.ts,
// which enforces that as a standing contract, not just a code-review convention.
//
// Each screen's shape here is modeled on that screen's real, richest production view-model —
// apps/web/src/pages/<screen>/fixtures.ts — not the raw wire format of
// apps/web/src/gateway/<screen>.ts. The wire format (numeric ids, bearer-authenticated fetch,
// HTTP status codes) is exactly the host-specific transport detail this package must not own;
// a host adapter's job is translating its backend into the shapes below. See SOURCE_MAP.md
// for the exact production files each screen/port was extracted from, and the deliberate
// simplifications applied at that translation boundary.

/** A gateway rejects with this — never a raw HTTP status or a transport-specific error class —
 * so a screen can drive its loading/empty/error/forbidden/readonly state machine without
 * knowing anything about REST, GraphQL, or IPC. */
export type RhythmGatewayErrorKind = 'forbidden' | 'not_found' | 'unavailable' | 'server_error';

export class RhythmGatewayError extends Error {
  constructor(readonly kind: RhythmGatewayErrorKind, message: string) {
    super(message);
  }
}

export interface RhythmWorkspaceMember {
  id: string;
  name: string;
  initials: string;
}

// ---------------------------------------------------------------------------------------
// Tasks — apps/web/src/pages/tasks/index.tsx, fixtures.ts; apps/web/src/gateway/tasks.ts
// ---------------------------------------------------------------------------------------

export type TaskStatus = 'open' | 'in_progress' | 'waiting_for_reply' | 'done';
export type TaskBucket = 'past-due' | 'today' | 'week' | 'month' | 'no-due' | 'completed';
export type TaskEnergy = '' | '🔥' | '⚡' | '🌱';
export type PreferredAgent = '' | 'claude-code' | 'codex';

export interface RhythmTaskCollaborator {
  id: string;
  name: string;
  initials: string;
}

export interface RhythmTask {
  id: string;
  title: string;
  notes: string;
  status: TaskStatus;
  bucket: TaskBucket;
  priority: 0 | 1 | 2 | 3;
  tags: string[];
  scheduledDate?: string;
  dueDate?: string;
  createdAt: string;
  createdBy: string;
  ownerId: string;
  /** True when this task belongs to someone else and the current user is only a collaborator —
   * gates delete/collaborator-management actions to the owner (task-owner-only permission). */
  isShared: boolean;
  /** A non-manual source (a synchronized rhythm/project/automation/calendar event) is
   * inspect-only here; edits belong in that source of truth. */
  sourceType: 'manual' | 'rhythm' | 'project' | 'automation' | 'calendar_shadow_event' | 'prod_mirror';
  sourceName?: string;
  preferredAgent: PreferredAgent;
  energy: TaskEnergy;
  collaborators: RhythmTaskCollaborator[];
}

export type CreateRhythmTaskInput = Pick<RhythmTask, 'title'> & Partial<Pick<RhythmTask, 'notes' | 'scheduledDate' | 'dueDate' | 'preferredAgent' | 'collaborators'>>;
export type UpdateRhythmTaskInput = Partial<Pick<RhythmTask, 'title' | 'notes' | 'scheduledDate' | 'dueDate' | 'preferredAgent' | 'energy' | 'status'>>;

export interface TasksGateway {
  list(): Promise<RhythmTask[]>;
  members(): Promise<RhythmWorkspaceMember[]>;
  create(input: CreateRhythmTaskInput): Promise<RhythmTask>;
  update(id: string, input: UpdateRhythmTaskInput): Promise<RhythmTask>;
  delete(id: string): Promise<void>;
  addCollaborator(id: string, memberId: string): Promise<RhythmTask>;
  removeCollaborator(id: string, memberId: string): Promise<RhythmTask>;
}

// ---------------------------------------------------------------------------------------
// Dashboard — apps/web/src/pages/dashboard/index.tsx, fixtures.ts
// ---------------------------------------------------------------------------------------

export interface RhythmDashboardTask {
  id: string;
  title: string;
  notes: string;
  status: 'open' | 'done';
  bucket: 'past-due' | 'today' | 'week' | 'unscheduled';
  scheduledDate?: string;
  dueDate?: string;
  dueLabel: string;
  collaboratorId?: string;
  collaboratorName?: string;
}

export interface RhythmDashboardProjectStep {
  id: string;
  title: string;
  notes: string;
  status: 'open' | 'done';
  dueLabel: string;
}

export interface RhythmDashboardProject {
  id: string;
  title: string;
  owner: string;
  dueLabel: string;
  steps: RhythmDashboardProjectStep[];
}

export interface RhythmDashboardThreadPreview {
  id: string;
  title: string;
  preview: string;
  senderName?: string;
  unreadCount: number;
}

export interface RhythmDashboardSummary {
  openTaskCount: number;
  threadCount: number;
  tasks: RhythmDashboardTask[];
  project: RhythmDashboardProject | null;
  unreadThreads: RhythmDashboardThreadPreview[];
}

export type CreateDashboardTaskInput = Pick<RhythmDashboardTask, 'title'> & Partial<Pick<RhythmDashboardTask, 'notes' | 'scheduledDate' | 'dueDate' | 'collaboratorId'>>;
export type UpdateDashboardTaskInput = Partial<Pick<RhythmDashboardTask, 'title' | 'notes' | 'scheduledDate' | 'dueDate' | 'status'>> & { collaboratorId?: string | null };

export interface DashboardGateway {
  summary(): Promise<RhythmDashboardSummary>;
  members(): Promise<RhythmWorkspaceMember[]>;
  createTask(input: CreateDashboardTaskInput): Promise<RhythmDashboardTask>;
  updateTask(id: string, input: UpdateDashboardTaskInput): Promise<RhythmDashboardTask>;
  updateProjectStep(id: string, input: Partial<Pick<RhythmDashboardProjectStep, 'title' | 'status'>>): Promise<RhythmDashboardProjectStep>;
}

// ---------------------------------------------------------------------------------------
// Planner — apps/web/src/pages/planner/index.tsx, fixtures.ts
// ---------------------------------------------------------------------------------------

export interface RhythmPlannerTask {
  id: string;
  source: 'task' | 'project-step';
  title: string;
  notes: string;
  status: 'open' | 'done';
  scheduledDate?: string;
  dueDate?: string;
  scheduledOrder: number;
  energy?: TaskEnergy;
  projectName?: string;
  collaborators: RhythmTaskCollaborator[];
  /** A project-step-sourced entry is read-only here; changes belong in Projects. */
  readonly: boolean;
}

export interface RhythmPlannerEvent {
  id: string;
  title: string;
  date: string;
  timeLabel: string;
  notes: string;
  allDay: boolean;
}

export interface RhythmPlannerDay {
  date: string;
  label: string;
  tasks: RhythmPlannerTask[];
  events: RhythmPlannerEvent[];
}

export interface RhythmPlannerWeek {
  weekLabel: string;
  weekStart: string;
  days: RhythmPlannerDay[];
  backlog: RhythmPlannerTask[];
}

export interface PlannerGateway {
  week(weekLabel: string): Promise<RhythmPlannerWeek>;
  members(): Promise<RhythmWorkspaceMember[]>;
  scheduleTask(id: string, input: { scheduledDate?: string }): Promise<RhythmPlannerTask>;
  // M1 collaboration-screens extraction (#4): widened with 'dueDate' — production's create/edit
  // forms (apps/web/src/pages/planner/index.tsx createTask/saveTask) persist a due date distinct
  // from the scheduled date; this narrower contract had no field for it yet.
  create(input: Pick<RhythmPlannerTask, 'title'> & Partial<Pick<RhythmPlannerTask, 'notes' | 'scheduledDate' | 'dueDate' | 'energy'>>): Promise<RhythmPlannerTask>;
  update(id: string, input: Partial<Pick<RhythmPlannerTask, 'title' | 'notes' | 'scheduledDate' | 'dueDate' | 'energy' | 'status'>>): Promise<RhythmPlannerTask>;
  // M1 collaboration-screens extraction (#4): additive — production's task inspector
  // (apps/web/src/pages/planner/index.tsx addCollaborator/removeCollaborator) manages
  // per-task collaborators; this narrower contract had no equivalent calls yet.
  addCollaborator(id: string, memberId: string): Promise<RhythmPlannerTask>;
  removeCollaborator(id: string, memberId: string): Promise<RhythmPlannerTask>;
}

// ---------------------------------------------------------------------------------------
// Projects — apps/web/src/pages/projects/index.tsx, fixtures.ts
// ---------------------------------------------------------------------------------------

export type ProjectInstanceStatus = 'planning' | 'active' | 'on_hold' | 'complete';

export interface RhythmProjectStep {
  id: string;
  title: string;
  notes: string;
  status: 'open' | 'done';
  dueDate?: string;
  scheduledDate?: string;
  assigneeId?: string;
  milestoneId?: string | null;
}

export interface RhythmProjectMilestone {
  id: string;
  title: string;
  sortOrder: number;
}

export interface RhythmProjectTemplateStep {
  id: string;
  title: string;
  offsetDays: number;
  offsetDescription: string;
  assigneeId?: string;
}

export interface RhythmProjectTemplate {
  id: string;
  name: string;
  description: string;
  anchorType: string;
  steps: RhythmProjectTemplateStep[];
}

export interface RhythmProject {
  id: string;
  templateId: string;
  name: string;
  anchorDate: string;
  status: ProjectInstanceStatus;
  ownerId: string;
  collaborators: RhythmWorkspaceMember[];
  milestones: RhythmProjectMilestone[];
  steps: RhythmProjectStep[];
}

export interface ProjectsGateway {
  templates(): Promise<RhythmProjectTemplate[]>;
  list(): Promise<RhythmProject[]>;
  members(): Promise<RhythmWorkspaceMember[]>;
  generate(templateId: string, input: { anchorDate: string; name?: string }): Promise<RhythmProject>;
  delete(id: string): Promise<void>;
  // M1 collaboration-screens extraction (#4): widened with 'milestoneId' so the Projects screen's
  // step row can assign/unassign a step's milestone (apps/web/src/pages/projects/index.tsx
  // assignMilestone → PATCH /project-instances/steps/:stepId {milestoneId}) through this one call.
  updateStep(instanceId: string, stepId: string, input: Partial<Pick<RhythmProjectStep, 'title' | 'notes' | 'status' | 'dueDate' | 'scheduledDate' | 'assigneeId' | 'milestoneId'>>): Promise<RhythmProjectStep>;
  // M1 collaboration-screens extraction (#4): additive — production's "Add milestone" action
  // (POST /project-instances/:id/milestones) has no equivalent port on this narrower contract yet.
  addMilestone(instanceId: string, input: Pick<RhythmProjectMilestone, 'title'>): Promise<RhythmProjectMilestone>;
  addCollaborator(instanceId: string, memberId: string): Promise<RhythmProject>;
  removeCollaborator(instanceId: string, memberId: string): Promise<RhythmProject>;
}

// ---------------------------------------------------------------------------------------
// Rhythms — apps/web/src/pages/rhythms/index.tsx, fixtures.ts
// ---------------------------------------------------------------------------------------

export type RhythmCadence = 'weekly' | 'monthly' | 'annual';

export interface RhythmStep {
  id: string;
  title: string;
  assigneeId?: string;
}

export interface RhythmRhythm {
  id: string;
  title: string;
  frequency: RhythmCadence;
  dayOfWeek: number;
  dayOfMonth: number;
  month: number;
  sequential: boolean;
  enabled: boolean;
  ownerId: string;
  ownerName: string;
  collaborators: RhythmWorkspaceMember[];
  steps: RhythmStep[];
  generatedCount: number;
  completedCount: number;
  remainingCount: number;
  waitingOn: string | null;
  nextDueDate: string | null;
  completionRatio: number;
  createdAt: string;
}

export type CreateRhythmRhythmInput = Pick<RhythmRhythm, 'title' | 'frequency'> & Partial<Pick<RhythmRhythm, 'dayOfWeek' | 'dayOfMonth' | 'month' | 'sequential' | 'enabled'>>;

export interface RhythmsGateway {
  list(): Promise<RhythmRhythm[]>;
  members(): Promise<RhythmWorkspaceMember[]>;
  create(input: CreateRhythmRhythmInput): Promise<RhythmRhythm>;
  // M1 collaboration-screens extraction (#4): widened from {title,enabled,sequential} so the
  // Rhythms screen's real edit form (frequency + schedule fields, ported from
  // apps/web/src/pages/rhythms/index.tsx RuleForm) has a single update call to save through,
  // matching production's PATCH /recurring-rules body — see docs/ai/runs for the receipt.
  update(id: string, input: Partial<Pick<RhythmRhythm, 'title' | 'enabled' | 'sequential' | 'frequency' | 'dayOfWeek' | 'dayOfMonth' | 'month'>>): Promise<RhythmRhythm>;
  delete(id: string): Promise<void>;
  addStep(id: string, input: Pick<RhythmStep, 'title'> & Partial<Pick<RhythmStep, 'assigneeId'>>): Promise<RhythmStep>;
  addCollaborator(id: string, memberId: string): Promise<RhythmRhythm>;
  removeCollaborator(id: string, memberId: string): Promise<RhythmRhythm>;
}

// ---------------------------------------------------------------------------------------
// Messages — apps/web/src/pages/messages/index.tsx, fixtures.ts
// ---------------------------------------------------------------------------------------

export type MessageThreadType = 'direct' | 'group';

export interface RhythmMessage {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
}

export interface RhythmMessageThread {
  id: string;
  title: string;
  type: MessageThreadType;
  participants: RhythmWorkspaceMember[];
  messages: RhythmMessage[];
  lastMessage: string;
  updatedAt: string;
  unreadCount: number;
}

export interface MessagesGateway {
  list(): Promise<RhythmMessageThread[]>;
  members(): Promise<RhythmWorkspaceMember[]>;
  createThread(input: { participantIds: string[]; type: MessageThreadType; title?: string }): Promise<RhythmMessageThread>;
  send(threadId: string, body: string): Promise<RhythmMessage>;
  markRead(threadId: string): Promise<void>;
  markUnread(threadId: string): Promise<void>;
  // M1 collaboration-screens extraction (#4): additive — production's thread action menu
  // (apps/web/src/pages/messages/index.tsx ThreadActions) also renames and deletes a thread;
  // this narrower contract had no equivalent calls yet.
  renameThread(threadId: string, title: string): Promise<RhythmMessageThread>;
  deleteThread(threadId: string): Promise<void>;
}

// ---------------------------------------------------------------------------------------
// Facilities — apps/web/src/pages/facilities/index.tsx, fixtures.ts
// ---------------------------------------------------------------------------------------

export interface RhythmFacility {
  id: string;
  name: string;
  building: string | null;
  description: string;
}

export interface RhythmReservation {
  id: string;
  facilityId: string;
  title: string;
  requesterName: string;
  creatorId: string;
  start: string;
  end: string;
  notes: string | null;
  seriesId?: string;
  groupId?: string;
  external?: boolean;
  conflicted?: boolean;
  automation?: boolean;
}

export type CreateReservationInput = Pick<RhythmReservation, 'facilityId' | 'title' | 'start' | 'end'> & Partial<Pick<RhythmReservation, 'notes'>>;

export interface FacilitiesGateway {
  facilities(): Promise<RhythmFacility[]>;
  reservations(range: { start: string; end: string }): Promise<RhythmReservation[]>;
  createReservation(input: CreateReservationInput): Promise<RhythmReservation>;
  updateReservation(id: string, input: Partial<Pick<RhythmReservation, 'title' | 'start' | 'end' | 'notes'>>): Promise<RhythmReservation>;
  deleteReservation(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------------------
// Integrations — apps/web/src/pages/integrations/index.tsx, fixtures.ts
// ---------------------------------------------------------------------------------------

export type IntegrationProviderId = 'google-calendar' | 'gmail' | 'planning-center';
export type IntegrationAccountStatus = 'connected' | 'disconnected' | 'needs_reauth' | 'error';

export interface RhythmIntegrationAccount {
  id: IntegrationProviderId;
  name: string;
  monogram: string;
  status: IntegrationAccountStatus;
  identity?: string;
  lastSyncedAt?: string;
  errorMessage?: string;
}

export interface RhythmCalendarSource {
  id: string;
  name: string;
  description: string;
  primary?: boolean;
  selected: boolean;
}

export interface RhythmGmailSignal {
  id: string;
  threadId: string;
  subject?: string;
  sender?: string;
  snippet?: string;
  unread: boolean;
}

export interface IntegrationsGateway {
  accounts(): Promise<RhythmIntegrationAccount[]>;
  calendarSources(): Promise<RhythmCalendarSource[]>;
  saveCalendarSelection(selectedIds: string[]): Promise<RhythmCalendarSource[]>;
  gmailSignals(): Promise<RhythmGmailSignal[]>;
  sync(id: IntegrationProviderId): Promise<RhythmIntegrationAccount>;
  disconnect(id: IntegrationProviderId): Promise<RhythmIntegrationAccount>;
  /** Beginning an OAuth/authorization flow is a host+backend concern (it needs a real
   * redirect URL and a live credential) — this package only asks the host to do it. */
  requestAuthorization(id: IntegrationProviderId): void;
}

// ---------------------------------------------------------------------------------------
// Automations — apps/web/src/pages/automations/index.tsx, fixtures.ts
// ---------------------------------------------------------------------------------------

export type AutomationSource = 'rhythm' | 'planning_center' | 'google_calendar' | 'gmail';
export type AutomationActionType = 'create_task' | 'create_project_from_template' | 'tag_task' | 'send_notification' | 'auto_schedule' | 'create_reservation';

export interface AutomationCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains';
  value: string;
}

export interface RhythmAutomation {
  id: string;
  name: string;
  source: AutomationSource;
  accountLabel: string;
  triggerKey: string;
  triggerLabel: string;
  actionType: AutomationActionType;
  actionLabel: string;
  enabled: boolean;
  createdAt: string;
  lastMatchedAt: string | null;
  matchCountLastRun: number;
  previewSummary: string;
  conditions: AutomationCondition[];
}

export type CreateAutomationInput = Pick<RhythmAutomation, 'name' | 'source' | 'triggerKey' | 'triggerLabel' | 'actionType' | 'actionLabel'> & Partial<Pick<RhythmAutomation, 'conditions' | 'enabled'>>;

export interface AutomationsGateway {
  list(): Promise<RhythmAutomation[]>;
  create(input: CreateAutomationInput): Promise<RhythmAutomation>;
  update(id: string, input: Partial<Pick<RhythmAutomation, 'name' | 'enabled' | 'conditions'>>): Promise<RhythmAutomation>;
  delete(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------------------
// The composed, host-provided gateway. Deliberately has no `sessions`, `approvals`,
// `permissions`, `delegation`, `mcp`, `skills`, `schedules`, `cookbook`, `research`, or
// `liveArtifacts` field — those are agent-session or artifact-security domains and must
// never be reachable from this shared, non-agent surface (liveArtifacts has its own gate,
// see src/artifacts/types.ts).
// ---------------------------------------------------------------------------------------

export interface RhythmDomainGateway {
  dashboard: DashboardGateway;
  tasks: TasksGateway;
  planner: PlannerGateway;
  projects: ProjectsGateway;
  rhythms: RhythmsGateway;
  messages: MessagesGateway;
  facilities: FacilitiesGateway;
  integrations: IntegrationsGateway;
  automations: AutomationsGateway;
}
