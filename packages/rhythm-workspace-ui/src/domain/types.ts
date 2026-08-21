// Narrow, host-neutral Rhythm domain-gateway contracts.
//
// Each interface below is a pure data port: it describes what a screen needs to read and
// write, never how the host authenticates or transports the call. A host adapter (living in
// the consuming app, e.g. an Electron renderer or a Hermes plugin shell) implements these by
// wrapping its own authenticated client. This file must never construct a fetch(), an
// Authorization header, or reference an agent session — see tests/forbidden-imports.test.ts,
// which enforces that as a standing contract, not just a code-review convention.

export type TaskStatus = 'open' | 'in_progress' | 'waiting_for_reply' | 'done';

export interface RhythmTask {
  id: string;
  title: string;
  notes: string;
  status: TaskStatus;
  dueDate?: string;
  scheduledDate?: string;
  priority: 0 | 1 | 2 | 3;
  tags: string[];
}

export interface TasksGateway {
  list(): Promise<RhythmTask[]>;
  create(input: Pick<RhythmTask, 'title' | 'notes'> & Partial<Pick<RhythmTask, 'dueDate' | 'scheduledDate'>>): Promise<RhythmTask>;
  setStatus(id: string, status: TaskStatus): Promise<RhythmTask>;
}

export interface RhythmDashboardSummary {
  greetingName: string;
  openTaskCount: number;
  todayTaskTitles: string[];
  upcomingRhythmTitles: string[];
}

export interface DashboardGateway {
  summary(): Promise<RhythmDashboardSummary>;
}

export interface RhythmPlannerDay {
  date: string;
  label: string;
  items: { id: string; title: string; kind: 'task' | 'rhythm' }[];
}

export interface PlannerGateway {
  week(): Promise<RhythmPlannerDay[]>;
}

export type ProjectStatus = 'planning' | 'active' | 'on_hold' | 'complete';

export interface RhythmProject {
  id: string;
  name: string;
  status: ProjectStatus;
  progressPercent: number;
}

export interface ProjectsGateway {
  list(): Promise<RhythmProject[]>;
}

export type RhythmCadence = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RhythmRhythm {
  id: string;
  title: string;
  cadence: RhythmCadence;
  nextOccurrence: string;
}

export interface RhythmsGateway {
  list(): Promise<RhythmRhythm[]>;
}

export interface RhythmMessageThread {
  id: string;
  subject: string;
  lastSenderName: string;
  unreadCount: number;
}

export interface MessagesGateway {
  list(): Promise<RhythmMessageThread[]>;
}

export type FacilityRequestStatus = 'requested' | 'approved' | 'declined';

export interface RhythmFacilityRequest {
  id: string;
  roomName: string;
  requestedFor: string;
  status: FacilityRequestStatus;
}

export interface FacilitiesGateway {
  list(): Promise<RhythmFacilityRequest[]>;
}

export interface RhythmIntegration {
  id: string;
  name: string;
  connected: boolean;
}

export interface IntegrationsGateway {
  list(): Promise<RhythmIntegration[]>;
  setConnected(id: string, connected: boolean): Promise<RhythmIntegration>;
}

export interface RhythmAutomation {
  id: string;
  name: string;
  enabled: boolean;
  description: string;
}

export interface AutomationsGateway {
  list(): Promise<RhythmAutomation[]>;
  setEnabled(id: string, enabled: boolean): Promise<RhythmAutomation>;
}

// The composed, host-provided gateway. Deliberately has no `sessions`, `approvals`,
// `permissions`, `delegation`, `mcp`, `skills`, `schedules`, `cookbook`, `research`, or
// `liveArtifacts` field — those are agent-session or artifact-security domains and must
// never be reachable from this shared, non-agent surface (liveArtifacts has its own gate,
// see src/artifacts/types.ts).
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
