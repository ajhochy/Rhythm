import { useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Divider, Text, TextInput } from 'react-native-paper';

import { styles } from '@/components/chat/chat-view-styles';
import { Colors } from '@/constants/theme';
import type { MobileCoordinatorPlanConsent, MobileCoordinatorViewState } from '@/providers/coordinator-conversation-controller';
import type {
  MobileCoordinatorAvailability,
  MobileCoordinatorPlanAdmission,
  MobileCoordinatorReceipt,
  MobileCoordinatorTask,
} from '@/providers/services/coordinator-conversations-service';

type Palette = typeof Colors.light;

function sourceLabel(name: string, source: MobileCoordinatorAvailability): string {
  if (source.state === 'available') return name + ': available';
  if (source.state === 'not_configured') return name + ': not configured';
  return name + ': unavailable';
}

function taskLabel(task: MobileCoordinatorTask): string {
  return task.title + (task.status === 'waiting_for_reply' ? ' · waiting for reply' : '');
}

function holdLines(receipts: MobileCoordinatorReceipt[]): string[] {
  const seen = new Set<string>();
  return receipts.flatMap((receipt) => {
    if (seen.has(receipt.id)) return [];
    seen.add(receipt.id);
    if (receipt.actualUsage?.state === 'unknown') return ['Unknown usage — hold needs review'];
    if (receipt.actualUsage?.state === 'overshoot') return ['Usage overshoot — hold needs review'];
    return [];
  });
}

function contextLines(state: MobileCoordinatorViewState): string[] {
  const context = state.context;
  if (!context) return [];
  const lines = [
    sourceLabel('Tasks', context.availability.tasks),
    sourceLabel('Schedules', context.availability.schedules),
    sourceLabel('Workstreams', context.availability.workstreams),
    sourceLabel('Receipts', context.availability.receipts),
    sourceLabel('Dayflow activity', context.availability.manualActivity),
  ];
  if (context.todayTasks.length) lines.push('Today (' + context.today + '): ' + context.todayTasks.map(taskLabel).join(' · '));
  else if (context.availability.tasks.state === 'available') lines.push('Today (' + context.today + '): no reported tasks');
  if (context.waitingForReply.length) lines.push('Waiting for reply: ' + context.waitingForReply.map(taskLabel).join(' · '));
  if (context.scheduledPriorities.length) {
    lines.push('Scheduled priorities: ' + context.scheduledPriorities.map((schedule) => schedule.name + (schedule.enabled ? '' : ' · paused')).join(' · '));
  }
  if (context.verifiedYesterday.length) {
    lines.push('Verified yesterday (' + context.yesterday + '): ' + context.verifiedYesterday.length + ' verified receipt' + (context.verifiedYesterday.length === 1 ? '' : 's'));
  } else if (context.availability.receipts.state === 'available') {
    lines.push('Yesterday (' + context.yesterday + '): no verified completion reported');
  }
  if (context.doneWithUnknownCompletionDate.length) lines.push('Completion date unknown: ' + context.doneWithUnknownCompletionDate.map(taskLabel).join(' · '));
  if (context.activeWorkstreams.length) lines.push('Rhythm work: ' + context.activeWorkstreams.length + ' active workstream' + (context.activeWorkstreams.length === 1 ? '' : 's'));
  else if (context.availability.workstreams.state === 'available') lines.push('Rhythm work: no active workstreams reported');
  if (context.executionSucceededGoalUnverified.length) {
    lines.push('Execution succeeded — verification pending for ' + context.executionSucceededGoalUnverified.length + ' workstream' + (context.executionSucceededGoalUnverified.length === 1 ? '' : 's'));
  }
  if (context.staleExecutions.length) lines.push('Earlier execution needs review for ' + context.staleExecutions.length + ' workstream' + (context.staleExecutions.length === 1 ? '' : 's'));
  return lines;
}

function statusMessage(state: MobileCoordinatorViewState): string | undefined {
  if (state.phase === 'opening') return 'Opening coordination';
  if (state.phase === 'refreshing') return 'Refreshing coordination';
  if (state.phase === 'sending') {
    return state.pendingPlan
      ? 'Submitting managed planning request'
      : 'Sending coordinator message';
  }
  return state.notice?.message;
}

function plannedBudgetLine(budget: Record<string, unknown>): string {
  const actual = typeof budget.actualTokens === 'number' && Number.isFinite(budget.actualTokens) ? budget.actualTokens : undefined;
  const authorized = typeof budget.authorizedTokens === 'number' && Number.isFinite(budget.authorizedTokens) ? budget.authorizedTokens : undefined;
  if (actual !== undefined && authorized !== undefined) return `Budget: ${actual.toLocaleString()} actual of ${authorized.toLocaleString()} authorized tokens.`;
  if (actual !== undefined) return `Budget: ${actual.toLocaleString()} actual tokens reported by the server.`;
  return budget.holdReason === null ? 'Budget: server reports no current hold.' : 'Budget status reported by the server.';
}

function plannedJobLine(jobs: unknown[]): string {
  const states = jobs.flatMap((job) => {
    if (!job || typeof job !== 'object' || Array.isArray(job)) return [];
    const state = (job as Record<string, unknown>).state;
    return typeof state === 'string' && ['queued', 'claimed', 'running', 'unknown', 'succeeded', 'failed', 'cancelled'].includes(state) ? [state] : [];
  });
  if (!states.length) return jobs.length ? `${jobs.length} server job${jobs.length === 1 ? '' : 's'} reported.` : 'No server job is reported yet.';
  return `Server job status: ${states.join(', ')}.`;
}

export function CoordinatorConversationCard({
  state,
  palette,
  onRefresh,
  onRetry,
  onRetryPlan,
  onPreparePlan,
  onContinuePlan,
  onReviewConflict,
  onBeginNewMessageAfterReview,
  onReturnToNormal,
  onInspectWorkstream,
}: {
  state: MobileCoordinatorViewState;
  palette: Palette;
  onRefresh: () => void;
  onRetry: () => void;
  onRetryPlan?: () => void;
  onPreparePlan?: (goalId: string, consent: MobileCoordinatorPlanConsent) => void;
  onContinuePlan?: (goalId: string, authorizationId: string) => void;
  onReviewConflict: () => void;
  onBeginNewMessageAfterReview: () => void | Promise<unknown>;
  onReturnToNormal: () => void;
  onInspectWorkstream: (workstreamId: string) => void;
}) {
  const busy = state.phase === 'opening' || state.phase === 'refreshing' || state.phase === 'sending';
  const message = statusMessage(state);
  const lines = contextLines(state);
  const holds = state.context ? holdLines([...state.context.usageHolds, ...state.context.receipts]) : [];
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [planningGoalId, setPlanningGoalId] = useState<string>();
  const [totalTokenAuthorization, setTotalTokenAuthorization] = useState('20000');
  const [maxTurns, setMaxTurns] = useState('1');
  const [maxWallTimeSeconds, setMaxWallTimeSeconds] = useState('90');
  const [expiresInSeconds, setExpiresInSeconds] = useState('900');
  const [acknowledgesSoftBudget, setAcknowledgesSoftBudget] = useState(false);
  const [planningPurpose, setPlanningPurpose] = useState<MobileCoordinatorPlanAdmission['purpose']>('decompose');
  const [acknowledgesScopedWorkspaceExecution, setAcknowledgesScopedWorkspaceExecution] = useState(false);
  const canStartNewMessage = Boolean(
    state.pendingCommand &&
    state.pendingProvenance === 'rejected' &&
    state.phase === 'review' &&
    state.conversation &&
    state.reviewedConflictRevision === state.conversation.controlRevision,
  );
  const activePlanGoal = state.conversation?.goals.find((goal) => goal.id === planningGoalId);
  const submitPlan = () => {
    if (!activePlanGoal || !onPreparePlan) return;
    onPreparePlan(activePlanGoal.id, {
      totalTokenAuthorization: Number(totalTokenAuthorization),
      maxTurns: Number(maxTurns) as MobileCoordinatorPlanAdmission['maxTurns'],
      maxWallTimeSeconds: Number(maxWallTimeSeconds),
      expiresInSeconds: Number(expiresInSeconds),
      acknowledgesSoftTotalTokenAuthorization: acknowledgesSoftBudget as true,
      purpose: planningPurpose,
      ...(planningPurpose === 'execute' && acknowledgesScopedWorkspaceExecution
        ? { acknowledgesScopedWorkspaceExecution: true as const }
        : {}),
    });
  };
  return (
    <Card
      accessibilityLabel="Rhythm coordination"
      mode="contained"
      style={[styles.noticeCard, { backgroundColor: palette.surface }]}
      testID="coordinator-conversation-card">
      <Card.Content style={{ gap: 8 }}>
        <View accessibilityLiveRegion="polite" accessible accessibilityRole="text">
          <Text variant="titleMedium" style={{ color: palette.text }}>Coordination</Text>
          {message ? <Text variant="bodySmall" style={{ color: palette.muted }}>{message}</Text> : null}
        </View>
        {state.conversation?.goals.map((goal) => (
          <View key={goal.id} style={{ gap: 3 }}>
            <Text variant="bodyMedium" style={{ color: palette.text }}>{goal.objective}</Text>
            <Text variant="bodySmall" style={{ color: palette.muted }}>
              {goal.state === 'captured' ? 'Captured — not dispatched' : goal.state === 'linked' ? 'Linked workstream' : 'Blocked'}
            </Text>
            {goal.linkedWorkstreamId ? (
              <Button compact mode="text" onPress={() => onInspectWorkstream(goal.linkedWorkstreamId!)}>
                Inspect linked workstream
              </Button>
            ) : null}
            {onPreparePlan && state.conversation?.schemaVersion === 3 && state.conversation.primaryOwnerRoot === true && !goal.linkedWorkstreamId ? (
              <Button compact mode="text" disabled={busy || Boolean(state.pendingPlan)} onPress={() => setPlanningGoalId((current) => current === goal.id ? undefined : goal.id)}>
                {planningGoalId === goal.id ? 'Hide managed planning consent' : 'Plan this goal'}
              </Button>
            ) : null}
            {onContinuePlan && state.conversation?.schemaVersion === 3 && state.conversation.primaryOwnerRoot === true ? state.conversation?.continuations?.filter((continuation) =>
              continuation.goalId === goal.id && continuation.status === 'consumed' && continuation.consumedTurns < continuation.maxTurns,
            ).map((continuation) => (
              <Button compact key={continuation.authorizationId} mode="text" disabled={busy || Boolean(state.pendingPlan)} onPress={() => onContinuePlan(goal.id, continuation.authorizationId)}>
                Continue managed work
              </Button>
            )) : null}
          </View>
        ))}
        {state.phase === 'ready' && !state.conversation?.goals.length ? (
          <Text variant="bodySmall" style={{ color: palette.muted }}>Add a goal in this same composer when you are ready.</Text>
        ) : null}
        {activePlanGoal ? (
          <View accessibilityLabel="Managed work consent" style={{ gap: 8, paddingTop: 4 }}>
            <Text variant="titleSmall" style={{ color: palette.text }}>Managed work consent</Text>
            <Text variant="bodySmall" style={{ color: palette.muted }}>
              Authorize one finite server-managed turn for this goal. The soft total-token authorization includes input, output, reasoning, cache, and any reconciled overrun; it does not verify completion.
            </Text>
            <View accessibilityLabel="Managed work purpose" style={{ alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {([
                ['decompose', 'Decompose'],
                ['continue', 'Continue'],
                ['execute', 'Execute scoped workspace'],
              ] as const).map(([purpose, label]) => <Button compact key={purpose} mode={planningPurpose === purpose ? 'contained-tonal' : 'outlined'} onPress={() => setPlanningPurpose(purpose)} accessibilityState={{ selected: planningPurpose === purpose }}>{label}</Button>)}
            </View>
            <TextInput accessibilityLabel="Total token authorization" keyboardType="number-pad" label="Total token authorization" mode="outlined" value={totalTokenAuthorization} onChangeText={setTotalTokenAuthorization} />
            <TextInput accessibilityLabel="Maximum outer turns" keyboardType="number-pad" label="Maximum outer turns" mode="outlined" value={maxTurns} onChangeText={setMaxTurns} />
            <TextInput accessibilityLabel="Worker wall time in seconds" keyboardType="number-pad" label="Worker wall time (seconds)" mode="outlined" value={maxWallTimeSeconds} onChangeText={setMaxWallTimeSeconds} />
            <TextInput accessibilityLabel="Consent expiry in seconds" keyboardType="number-pad" label="Consent expiry (seconds)" mode="outlined" value={expiresInSeconds} onChangeText={setExpiresInSeconds} />
            <Button compact mode={acknowledgesSoftBudget ? 'contained' : 'outlined'} accessibilityState={{ checked: acknowledgesSoftBudget }} onPress={() => setAcknowledgesSoftBudget((value) => !value)}>
              {acknowledgesSoftBudget ? 'Soft token authorization acknowledged' : 'Acknowledge soft token authorization'}
            </Button>
            {planningPurpose === 'execute' ? <Button compact mode={acknowledgesScopedWorkspaceExecution ? 'contained' : 'outlined'} accessibilityState={{ checked: acknowledgesScopedWorkspaceExecution }} onPress={() => setAcknowledgesScopedWorkspaceExecution((value) => !value)}>
              {acknowledgesScopedWorkspaceExecution ? 'Scoped workspace execution acknowledged' : 'Acknowledge scoped workspace execution'}
            </Button> : null}
            <View style={{ alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <Button compact mode="outlined" disabled={busy || !acknowledgesSoftBudget || planningPurpose === 'execute' && !acknowledgesScopedWorkspaceExecution} onPress={submitPlan} testID="coordinator-prepare-plan">Start managed work</Button>
              <Button compact mode="text" onPress={() => setPlanningGoalId(undefined)}>Cancel</Button>
            </View>
          </View>
        ) : null}
        {state.plannedWorkstream ? (
          <View accessibilityLabel="Latest managed work status" style={{ gap: 3, paddingTop: 4 }}>
            <Text variant="titleSmall" style={{ color: palette.text }}>Latest managed-work response</Text>
            <Text variant="bodySmall" style={{ color: palette.muted }}>
              {state.plannedWorkstream.workstream.state} · {state.plannedWorkstream.readiness.available ? 'server reports ready' : 'server reports a readiness hold'}
            </Text>
            <Text variant="bodySmall" style={{ color: palette.muted }}>
              {plannedJobLine(state.plannedWorkstream.jobs)} {plannedBudgetLine(state.plannedWorkstream.budget)} Execution status is not criterion verification.
            </Text>
          </View>
        ) : null}
        {holds.length ? (
          <View accessibilityRole="alert" style={{ gap: 4 }}>
            {holds.map((line, index) => <Text key={line + index} variant="bodySmall" style={{ color: palette.text }}>{line}</Text>)}
          </View>
        ) : null}
        {lines.length ? (
          <>
            <Divider />
            <View style={{ gap: 4 }}>
              <Button compact mode="text" onPress={() => setDetailsExpanded((expanded) => !expanded)} accessibilityState={{ expanded: detailsExpanded }} testID="coordinator-context-toggle">
                {detailsExpanded ? 'Hide details' : 'Yesterday, today, and Rhythm work'}
              </Button>
              {detailsExpanded ? lines.map((line, index) => <Text key={line + index} variant="bodySmall" style={{ color: palette.muted }}>{line}</Text>) : null}
            </View>
          </>
        ) : null}
        <Text variant="bodySmall" style={{ color: palette.muted }}>
          Dayflow source controls are available from the paired Mac setup. This phone does not change them.
        </Text>
        <View style={{ alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {state.phase !== 'review' || state.pendingProvenance !== 'rejected' ? (
            <Button compact mode="outlined" disabled={busy} onPress={onRefresh} testID="coordinator-refresh">
              Refresh
            </Button>
          ) : null}
          {state.pendingCommand && state.pendingProvenance !== 'rejected' && !busy ? (
            <Button compact mode="outlined" onPress={onRetry} testID="coordinator-retry">Retry same message</Button>
          ) : null}
          {state.pendingPlan && state.notice?.retryable && !busy && onRetryPlan ? (
            <Button compact mode="outlined" onPress={onRetryPlan} testID="coordinator-retry-plan">Retry same managed request</Button>
          ) : null}
          {state.phase === 'review' && state.pendingCommand && state.pendingProvenance === 'rejected' ? (
            <Button compact mode="outlined" onPress={onReviewConflict} testID="coordinator-review-conflict">Refresh and review</Button>
          ) : null}
          {canStartNewMessage ? (
            <Button compact mode="outlined" onPress={onBeginNewMessageAfterReview} testID="coordinator-new-message">Write a new message</Button>
          ) : null}
          <Button compact mode="text" onPress={onReturnToNormal} testID="coordinator-return-normal">Return to normal chat</Button>
        </View>
      </Card.Content>
    </Card>
  );
}

export function CoordinatorConversationUnavailableCard({
  onDismiss,
  palette,
}: {
  onDismiss: () => void;
  palette: Palette;
}) {
  return (
    <Card
      accessibilityLabel="Coordination unavailable"
      mode="contained"
      style={[styles.noticeCard, { backgroundColor: palette.surface }]}
      testID="coordinator-unavailable-card">
      <Card.Content style={{ gap: 8 }}>
        <View accessibilityLiveRegion="polite" accessible accessibilityRole="text">
          <Text variant="titleMedium" style={{ color: palette.text }}>Coordination unavailable</Text>
          <Text variant="bodyMedium" style={{ color: palette.muted }}>
            Coordination is not available from this mobile connection yet. Keep using this chat normally.
          </Text>
        </View>
        <Button mode="outlined" onPress={onDismiss}>Dismiss</Button>
      </Card.Content>
    </Card>
  );
}
