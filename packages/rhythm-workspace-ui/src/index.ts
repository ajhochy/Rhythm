export { RhythmWorkspaceProvider, useRhythmDomainGateway, useRhythmHost } from './context';
export type { RhythmWorkspaceProviderProps } from './context';

export { defaultRhythmTokens, mapHostTokens, RHYTHM_ROOT_CLASS } from './host/theme';
export type { RhythmHostAdapter, RhythmHostTokens, RhythmThemeMode, RhythmViewport, RhythmCurrentUser, RhythmScreenId, RhythmTaskOperationConfirmation, RhythmWorkspaceOperationConfirmation } from './host/types';

export { RhythmGatewayError } from './domain/types';
export type {
  RhythmGatewayErrorKind,
  RhythmWorkspaceMember,
  // Tasks
  TaskStatus,
  TaskBucket,
  TaskEnergy,
  PreferredAgent,
  RhythmTaskCollaborator,
  RhythmTask,
  CreateRhythmTaskInput,
  UpdateRhythmTaskInput,
  TasksGateway,
  // Dashboard
  RhythmDashboardTask,
  RhythmDashboardProjectStep,
  RhythmDashboardProject,
  RhythmDashboardThreadPreview,
  RhythmDashboardSummary,
  CreateDashboardTaskInput,
  UpdateDashboardTaskInput,
  DashboardGateway,
  // Planner
  RhythmPlannerTask,
  RhythmPlannerEvent,
  RhythmPlannerDay,
  RhythmPlannerWeek,
  PlannerGateway,
  // Projects
  ProjectInstanceStatus,
  RhythmProjectStep,
  RhythmProjectMilestone,
  RhythmProjectTemplateStep,
  RhythmProjectTemplate,
  RhythmProject,
  ProjectsGateway,
  // Rhythms
  RhythmCadence,
  RhythmStep,
  RhythmRhythm,
  CreateRhythmRhythmInput,
  RhythmsGateway,
  // Messages
  MessageThreadType,
  RhythmMessage,
  RhythmMessageThread,
  MessagesGateway,
  // Facilities
  RhythmFacility,
  RhythmReservation,
  CreateReservationInput,
  CreateFacilityInput,
  UpdateFacilityInput,
  FacilitiesGateway,
  // Integrations
  IntegrationProviderId,
  IntegrationAccountStatus,
  RhythmIntegrationAccount,
  RhythmCalendarSource,
  RhythmGmailSignal,
  IntegrationsGateway,
  // Automations
  AutomationSource,
  AutomationActionType,
  AutomationCondition,
  RhythmAutomation,
  CreateAutomationInput,
  AutomationsGateway,
  // Composed
  RhythmDomainGateway,
} from './domain/types';

export { ArtifactsScreen } from './artifacts/ArtifactsScreen';
export type { ArtifactsScreenProps } from './artifacts/ArtifactsScreen';
export type { ArtifactHostCapability, ArtifactHostCapabilityMessage, ArtifactHostCapabilityResult, ArtifactHostDocument, ArtifactHostPort, ArtifactsGateway, RhythmArtifact, RhythmArtifactKind } from './artifacts/types';

export { AutomationsScreen } from './screens/AutomationsScreen';
export { DashboardScreen } from './screens/DashboardScreen';
export { FacilitiesScreen } from './screens/FacilitiesScreen';
export { IntegrationsScreen } from './screens/IntegrationsScreen';
export { MessagesScreen } from './screens/MessagesScreen';
export { PlannerScreen } from './screens/PlannerScreen';
export { ProjectsScreen } from './screens/ProjectsScreen';
export { RhythmsScreen } from './screens/RhythmsScreen';
export { TasksScreen } from './screens/TasksScreen';

export { Icon } from './components/Icon';
export type { IconName } from './components/Icon';
export { FocusDialog } from './components/FocusDialog';
export { HeaderTaskAction } from './components/HeaderTaskAction';
export { TaskCreateForm } from './components/TaskCreateForm';
export type { TaskCreateMember } from './components/TaskCreateForm';
export { quickActionPresets } from './components/quickActions';
export type { QuickActionPresetId, QuickActionPreset } from './components/quickActions';
export { ListInspector } from './components/ListInspector';
export type { ListInspectorItem, ListInspectorProps } from './components/ListInspector';
export { Splitter } from './components/Splitter';
export type { SplitterOrientation, SplitterProps, SplitterResizeEdge } from './components/Splitter';
