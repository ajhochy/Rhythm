import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Checkbox,
  Divider,
  List,
  Menu,
  Text,
  TextInput,
} from 'react-native-paper';

import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { AgentOption } from '@/providers/opencode-provider-types';
import { useAgentChat } from '@/providers/agent-chat-provider';
import type {
  MobileWorkstream,
  MobileWorkstreamCheckpoint,
  MobileWorkstreamReference,
  MobileWorkstreamStatus,
} from '@/providers/services/workstreams-service';

const ACTIVE_JOB_STATES = new Set(['queued', 'claimed', 'running', 'unknown']);
const TERMINAL_JOB_STATES = new Set(['succeeded', 'failed', 'cancelled']);

function opaqueKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function stateLabel(value: string): string {
  return value.replace(/_/g, ' ');
}

function compactTime(value: string | null): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : 'unavailable';
}

function numberAt(value: Record<string, unknown> | null, key: string): number | null {
  const result = value?.[key];
  return typeof result === 'number' && Number.isFinite(result) ? result : null;
}

function textAt(value: Record<string, unknown> | null, key: string): string | null {
  const result = value?.[key];
  return typeof result === 'string' && result.length ? result : null;
}

function checkpointFor(
  projectId: string,
  criteria: string,
  references: MobileWorkstreamReference[],
): MobileWorkstreamCheckpoint {
  const lines = criteria.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  return {
    version: 1,
    criteria: (lines.length ? lines : ['criterion']).slice(0, 100).map((_, index) => ({
      id: `criterion-${index + 1}`,
      status: 'pending' as const,
    })),
    references,
    nextAction: { kind: 'review', scope: projectId },
  };
}

function parseReferences(value: string, projectId: string): MobileWorkstreamReference[] {
  const lines = value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  if (lines.length > 50) throw new Error('At most 50 metadata references may be attached.');
  return lines.map((line) => {
    const parts = line.split('@');
    if (parts.length !== 2 ||
        !(/^memory:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parts[0]) || /^dayflow:[A-Za-z0-9._:-]{1,118}$/.test(parts[0])) ||
        !/^[A-Za-z0-9._:-]{1,128}$/.test(parts[1])) {
      throw new Error('References use memory:<record-id>@sha256:<hash>. Dayflow metadata is typed but currently unavailable.');
    }
    return { sourceId: parts[0], expectedVersion: parts[1], scope: projectId, provenance: 'user_reference' };
  });
}

export function MobileWorkstreamsPanel({
  projectId,
  parentSessionId,
  profiles,
}: {
  projectId?: string;
  parentSessionId?: string;
  profiles: AgentOption[];
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const {
    workstreams,
    workstreamsProjectId,
    isLoadingWorkstreams,
    workstreamsError,
    refreshWorkstreams,
    createWorkstream,
    reviseWorkstream,
    runWorkstream,
    pauseWorkstream,
    resumeWorkstream,
    cancelWorkstream,
    acknowledgeWorkstreamUsage,
    reconcileWorkstreamUnknown,
    waiveWorkstreamCriteria,
    workstreamEvidence,
    inspectWorkstreamEvidence,
    verifyWorkstreamCriteria,
  } = useAgentChat();
  const eligibleProfiles = useMemo(() => profiles.filter((profile) => profile.profileId), [profiles]);
  const [selectedId, setSelectedId] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string>();
  const [goal, setGoal] = useState('');
  const [constraints, setConstraints] = useState('');
  const [criteria, setCriteria] = useState('');
  const [references, setReferences] = useState('');
  const [targetProfileId, setTargetProfileId] = useState('');
  const [profileMenuVisible, setProfileMenuVisible] = useState(false);
  const [maxWallTimeSeconds, setMaxWallTimeSeconds] = useState('300');
  const [maxTokens, setMaxTokens] = useState('20000');
  const [softTokenBudgetAcknowledged, setSoftTokenBudgetAcknowledged] = useState(false);
  const [commandKeys, setCommandKeys] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!projectId) return;
    void refreshWorkstreams(projectId).catch(() => undefined);
  }, [projectId, refreshWorkstreams]);

  useEffect(() => {
    if (!targetProfileId && eligibleProfiles[0]) setTargetProfileId(eligibleProfiles[0].profileId);
    if (targetProfileId && !eligibleProfiles.some((profile) => profile.profileId === targetProfileId)) {
      setTargetProfileId(eligibleProfiles[0]?.profileId ?? '');
    }
  }, [eligibleProfiles, targetProfileId]);

  const items = projectId && workstreamsProjectId === projectId ? workstreams : [];
  useEffect(() => {
    if (!items.length) { setSelectedId(undefined); return; }
    if (!selectedId || !items.some((item) => item.workstream.id === selectedId)) setSelectedId(items[0].workstream.id);
  }, [items, selectedId]);
  const selected = items.find((item) => item.workstream.id === selectedId);
  useEffect(() => {
    setSoftTokenBudgetAcknowledged(false);
  }, [selected?.workstream.id, selected?.workstream.revision]);
  const selectedProfile = eligibleProfiles.find((profile) => profile.profileId === targetProfileId);

  const refresh = () => {
    if (!projectId || busy) return;
    setLocalError(undefined);
    void refreshWorkstreams(projectId).catch((reason) => setLocalError(reason instanceof Error ? reason.message : 'Could not refresh workstreams.'));
  };

  const create = () => {
    if (!projectId || busy) return;
    const normalizedGoal = goal.trim();
    const normalizedConstraints = constraints.trim();
    const normalizedCriteria = criteria.trim();
    if (!normalizedGoal || !normalizedConstraints || !normalizedCriteria) {
      setLocalError('Goal, constraints, and criteria are all required.');
      return;
    }
    let parsedReferences: MobileWorkstreamReference[];
    try { parsedReferences = parseReferences(references, projectId); }
    catch (reason) { setLocalError(reason instanceof Error ? reason.message : 'References are invalid.'); return; }
    setBusy(true);
    setLocalError(undefined);
    void createWorkstream(projectId, {
      projectId,
      goal: normalizedGoal,
      constraints: normalizedConstraints,
      criteria: normalizedCriteria,
      checkpoint: checkpointFor(projectId, normalizedCriteria, parsedReferences),
      createKey: opaqueKey('workstream'),
    }).then(async (row) => {
      setCreateOpen(false);
      setGoal(''); setConstraints(''); setCriteria(''); setReferences('');
      await refreshWorkstreams(projectId);
      setSelectedId(row.id);
    }).catch((reason) => setLocalError(reason instanceof Error ? reason.message : 'Could not create workstream.'))
      .finally(() => setBusy(false));
  };

  const startEdit = (workstream: MobileWorkstream) => {
    setGoal(workstream.goal);
    setConstraints(workstream.constraints);
    setCriteria(workstream.criteria);
    setEditOpen(true);
    setCreateOpen(false);
    setLocalError(undefined);
  };

  const saveEdit = () => {
    if (!projectId || !selected || busy) return;
    const normalizedGoal = goal.trim();
    const normalizedConstraints = constraints.trim();
    const normalizedCriteria = criteria.trim();
    if (!normalizedGoal || !normalizedConstraints || !normalizedCriteria) {
      setLocalError('Goal, constraints, and criteria are all required.');
      return;
    }
    setBusy(true);
    setLocalError(undefined);
    void reviseWorkstream(projectId, selected.workstream.id, {
      expectedRevision: selected.workstream.revision,
      goal: normalizedGoal,
      constraints: normalizedConstraints,
      criteria: normalizedCriteria,
    }).then(async () => {
      setEditOpen(false);
      await refreshWorkstreams(projectId);
    }).catch((reason) => setLocalError(reason instanceof Error ? reason.message : 'Could not save workstream.'))
      .finally(() => setBusy(false));
  };

  const run = () => {
    if (!projectId || !parentSessionId || !selected || !targetProfileId || busy) return;
    const wall = Number(maxWallTimeSeconds);
    const tokens = Number(maxTokens);
    if (!Number.isSafeInteger(wall) || wall < 30 || wall > 3600 || !Number.isSafeInteger(tokens) || tokens < 1 || tokens > 2_000_000) {
      setLocalError('Run limits must be 30–3600 seconds and 1–2,000,000 tokens.');
      return;
    }
    if (!softTokenBudgetAcknowledged) {
      setLocalError('Acknowledge the soft total-token authorization before Run next.');
      return;
    }
    const queuedJob = selected.jobs.find((job) => job.id === selected.workstream.lastJobId);
    const commandKey = queuedJob?.state === 'queued'
      ? queuedJob.commandKey
      : commandKeys[selected.workstream.id] ?? opaqueKey('run');
    setCommandKeys((current) => ({ ...current, [selected.workstream.id]: commandKey }));
    setBusy(true);
    setLocalError(undefined);
    void runWorkstream(projectId, selected.workstream.id, {
      expectedRevision: selected.workstream.revision,
      commandKey,
      targetProfileId,
      parentSessionId,
      softTokenBudgetAcknowledged: true,
      policy: { maxTurns: 1, maxWallTimeSeconds: wall, maxTokens: tokens, queueDeadlineAt: null },
      references: selected.workstream.checkpoint.references,
    }).then((next) => {
      if (next.workstream.state === 'ready' && next.jobs.some((job) => TERMINAL_JOB_STATES.has(job.state))) {
        setCommandKeys((current) => {
          const { [next.workstream.id]: _discarded, ...rest } = current;
          return rest;
        });
      }
    }).catch((reason) => setLocalError(reason instanceof Error ? reason.message : 'Could not run the workstream.'))
      .finally(() => setBusy(false));
  };

  const currentJob = selected?.jobs.find((job) => job.id === selected.workstream.lastJobId);
  const executorAvailable = selected?.readiness.available === true;
  const retryingQueuedIntent = currentJob?.state === 'queued' &&
    (selected?.workstream.state === 'queued' || selected?.workstream.state === 'blocked');
  const usageUnknown = currentJob?.result && textAt(currentJob.result, 'usageStatus') === 'unknown' && !currentJob.usage;
  const actualTokens = numberAt(currentJob?.usage ?? null, 'totalTokens');
  const authorizedTokens = numberAt(currentJob?.usage ?? null, 'authorizedTokens') ?? numberAt(currentJob?.estimate ?? null, 'authorizedTokens');
  const unresolvedCriterionIds = selected?.workstream.checkpoint.criteria
    .filter((criterion) => criterion.status === 'pending' || criterion.status === 'blocked')
    .map((criterion) => criterion.id) ?? [];
  const usageAcknowledgement = currentJob?.estimate?.estimateAcknowledgement;
  const acknowledgement = usageAcknowledgement && typeof usageAcknowledgement === 'object' && !Array.isArray(usageAcknowledgement)
    ? usageAcknowledgement as Record<string, unknown>
    : null;
  const budgetHeld = selected?.budget.holdReason ?? null;
  const waivableJobId = currentJob?.state === 'succeeded' &&
    textAt(currentJob.application, 'status') === 'quarantined' &&
    selected?.workstream.state !== 'paused' && selected?.workstream.state !== 'cancelled'
    ? currentJob.id
    : null;

  if (!projectId) {
    return <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}><Text style={{ color: palette.muted }}>Select a registered project to use workstreams.</Text></View>;
  }

  return <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]} testID="mobile-workstreams-panel">
    <View style={styles.titleRow}><View style={styles.titleCopy}><Text variant="titleLarge" style={{ color: palette.text }}>Workstreams</Text><Text style={{ color: palette.muted }}>Explicit, fresh, read-only workers. No automatic continuation.</Text></View><Button compact mode="outlined" onPress={refresh} disabled={busy || isLoadingWorkstreams}>Refresh</Button></View>
    {isLoadingWorkstreams ? <ActivityIndicator accessibilityLabel="Loading workstreams" color={palette.tint} /> : null}
    {workstreamsError || localError ? <Text accessibilityRole="alert" style={{ color: palette.danger }}>{localError ?? workstreamsError}</Text> : null}
    <Button testID="mobile-workstreams-create" mode="contained" onPress={() => { setCreateOpen((value) => !value); setEditOpen(false); setLocalError(undefined); }} disabled={busy}>{createOpen ? 'Close new workstream' : 'New workstream'}</Button>

    {createOpen ? <View style={styles.form}>
      <TextInput label="Goal" mode="outlined" multiline value={goal} onChangeText={setGoal} />
      <TextInput label="Constraints" mode="outlined" multiline value={constraints} onChangeText={setConstraints} />
      <TextInput label="Criteria (one per line)" mode="outlined" multiline value={criteria} onChangeText={setCriteria} />
      <TextInput label="Evidence selector (memory:&lt;record-id&gt;@sha256:&lt;hash&gt;, optional)" mode="outlined" multiline value={references} onChangeText={setReferences} />
      <View style={styles.actions}><Button onPress={() => setCreateOpen(false)} disabled={busy}>Cancel</Button><Button testID="mobile-workstreams-create-submit" mode="contained" loading={busy} onPress={create}>Create</Button></View>
    </View> : null}

    {!isLoadingWorkstreams && items.length === 0 ? <Text style={{ color: palette.muted }}>No workstreams in this project yet.</Text> : null}
    {items.map((item) => <List.Item key={item.workstream.id} title={item.workstream.goal} description={`${stateLabel(item.workstream.state)}${item.workstream.stateReason ? ` · ${stateLabel(item.workstream.stateReason)}` : ''}`} titleNumberOfLines={2} onPress={() => { setSelectedId(item.workstream.id); setEditOpen(false); }} right={item.workstream.id === selectedId ? () => <List.Icon icon="check" /> : undefined} />)}
    {selected ? <View style={styles.detail}>
      <Divider />
      <View style={styles.titleRow}><View style={styles.titleCopy}><Text variant="titleMedium" style={{ color: palette.text }}>{selected.workstream.goal}</Text><Text style={{ color: palette.muted }}>{stateLabel(selected.workstream.state)}{selected.workstream.stateReason ? ` · ${stateLabel(selected.workstream.stateReason)}` : ''}</Text></View><Button compact onPress={() => startEdit(selected.workstream)} disabled={busy}>Edit</Button></View>
      <Text selectable style={{ color: palette.text }}>Constraints: {selected.workstream.constraints}</Text>
      <Text selectable style={{ color: palette.text }}>Criteria: {selected.workstream.criteria}</Text>
      <Text style={{ color: palette.muted }}>Next action: {selected.workstream.checkpoint.nextAction.kind} · Revision {selected.workstream.revision}</Text>
      <Text style={{ color: palette.muted }}>Executor: {executorAvailable ? 'available' : stateLabel(selected.readiness.reason ?? 'unavailable')}</Text>
      <Text style={{ color: budgetHeld ? palette.warning : palette.muted }}>Authorization: {selected.budget.authorizedTokens === null ? 'not established' : `${selected.budget.committedTokens.toLocaleString()} committed / ${selected.budget.authorizedTokens.toLocaleString()} tokens`}{selected.budget.remainingTokens === null ? '' : ` · ${selected.budget.remainingTokens.toLocaleString()} remaining`}{budgetHeld ? ` · held: ${stateLabel(budgetHeld)}` : ''}</Text>

      {editOpen ? <View style={styles.form}>
        <TextInput label="Goal" mode="outlined" multiline value={goal} onChangeText={setGoal} />
        <TextInput label="Constraints" mode="outlined" multiline value={constraints} onChangeText={setConstraints} />
        <TextInput label="Criteria" mode="outlined" multiline value={criteria} onChangeText={setCriteria} />
        <Text style={{ color: palette.muted }}>Reference and evidence metadata remains unchanged by this edit.</Text>
        <View style={styles.actions}><Button onPress={() => setEditOpen(false)} disabled={busy}>Cancel</Button><Button mode="contained" loading={busy} onPress={saveEdit}>Save controls</Button></View>
      </View> : null}

      <View style={styles.runBox}>
        <Text variant="titleSmall" style={{ color: palette.text }}>Explicit Run next</Text>
        <Menu visible={profileMenuVisible} onDismiss={() => setProfileMenuVisible(false)} anchor={<Button mode="outlined" onPress={() => setProfileMenuVisible(true)} disabled={busy || eligibleProfiles.length === 0}>{selectedProfile?.label ?? 'Select worker profile'}</Button>}>
          {eligibleProfiles.map((profile) => <Menu.Item key={profile.profileId} title={profile.label} onPress={() => { setTargetProfileId(profile.profileId); setProfileMenuVisible(false); }} />)}
        </Menu>
        <TextInput label="Wall time (seconds)" mode="outlined" keyboardType="number-pad" value={maxWallTimeSeconds} onChangeText={setMaxWallTimeSeconds} disabled={busy} />
        <TextInput label="Soft total-token authorization" mode="outlined" keyboardType="number-pad" value={maxTokens} onChangeText={setMaxTokens} disabled={busy} />
        <Checkbox.Item testID="mobile-workstreams-soft-token-acknowledgement" label="I understand this is a soft total-token authorization for input, output, reasoning, and cache. Input overhead is unknown; no output cap is enforced and this turn can overrun." status={softTokenBudgetAcknowledged ? 'checked' : 'unchecked'} onPress={() => setSoftTokenBudgetAcknowledged((value) => !value)} disabled={busy || !executorAvailable || !!budgetHeld} />
        <Button testID="mobile-workstreams-run-next" mode="contained" loading={busy} disabled={busy || !softTokenBudgetAcknowledged || !executorAvailable || !!budgetHeld || !parentSessionId || !targetProfileId || (selected.workstream.state !== 'ready' && !retryingQueuedIntent)} onPress={run}>{retryingQueuedIntent ? 'Try queued worker' : 'Run next'}</Button>
        {!parentSessionId ? <Text style={{ color: palette.warning }}>Open a root chat before starting a worker.</Text> : null}
        {budgetHeld ? <Text style={{ color: palette.warning }}>A new worker is blocked until the durable authorization hold is resolved; Resume cannot clear this hold.</Text> : null}
      </View>

      <View style={styles.actions}>
        {selected.workstream.state !== 'paused' && selected.workstream.state !== 'cancelled' ? <Button mode="outlined" disabled={busy} onPress={() => { setBusy(true); void pauseWorkstream(projectId, selected.workstream.id, selected.workstream.revision).catch((reason) => setLocalError(reason instanceof Error ? reason.message : 'Could not pause workstream.')).finally(() => setBusy(false)); }}>Pause</Button> : null}
        {selected.workstream.state === 'paused' ? <Button mode="outlined" disabled={busy} onPress={() => { setBusy(true); void resumeWorkstream(projectId, selected.workstream.id, selected.workstream.revision).catch((reason) => setLocalError(reason instanceof Error ? reason.message : 'Could not resume workstream.')).finally(() => setBusy(false)); }}>Resume</Button> : null}
        {currentJob && ACTIVE_JOB_STATES.has(currentJob.state) ? <Button mode="outlined" textColor={palette.danger} disabled={busy} onPress={() => { setBusy(true); void cancelWorkstream(projectId, selected.workstream.id, { expectedRevision: selected.workstream.revision, jobId: currentJob.id }).catch((reason) => setLocalError(reason instanceof Error ? reason.message : 'Could not cancel worker.')).finally(() => setBusy(false)); }}>Cancel worker</Button> : null}
      </View>

      <View style={styles.workers}><Text variant="titleSmall" style={{ color: palette.text }}>Workers</Text>{selected.jobs.length === 0 ? <Text style={{ color: palette.muted }}>No worker has been admitted.</Text> : selected.jobs.map((job) => {
        const total = numberAt(job.usage, 'totalTokens');
        const authorized = numberAt(job.usage, 'authorizedTokens') ?? numberAt(job.estimate, 'authorizedTokens');
        const requested = job.requestedProviderId && job.requestedModelId ? `${job.requestedProviderId}/${job.requestedModelId}` : 'not recorded';
        const servedProvider = textAt(job.result, 'servedProviderId');
        const servedModel = textAt(job.result, 'servedModelId');
        return <View key={job.id} style={[styles.worker, { borderColor: palette.border }]}><Text style={{ color: palette.text }}>{stateLabel(job.state)} · {job.targetProfileId ?? 'profile unavailable'}</Text><Text selectable style={{ color: palette.muted }}>{job.id}</Text><Text style={{ color: palette.muted }}>Requested model: {requested}</Text><Text style={{ color: palette.muted }}>Served model: {servedProvider && servedModel ? `${servedProvider}/${servedModel}` : 'not terminal'}</Text><Text style={{ color: palette.muted }}>Progress: {compactTime(job.lastProgressAt)}</Text><Text style={{ color: palette.muted }}>Usage: {total === null ? 'unknown' : `${total.toLocaleString()} tokens`}{authorized !== null ? ` / ${authorized.toLocaleString()} authorized` : ''}</Text>{total !== null && authorized !== null && total > authorized ? <Text style={{ color: palette.warning }}>Overshoot: {(total - authorized).toLocaleString()} tokens.</Text> : null}<Text style={{ color: palette.muted }}>Application: {textAt(job.application, 'status') ?? 'pending'}</Text></View>;
      })}</View>

      {currentJob ? <View style={styles.evidence}>
        <Text variant="titleSmall" style={{ color: palette.text }}>Evidence and result receipt</Text>
        <Text style={{ color: palette.muted }}>Result: {textAt(currentJob.result, 'status') ?? 'not terminal'} · Application: {textAt(currentJob.application, 'reason') ?? 'not recorded'}</Text>
        {selected.workstream.checkpoint.criteria.map((criterion) => <Text key={criterion.id} selectable style={{ color: palette.text }}>{criterion.id}: {criterion.status}{criterion.receiptId ? ` · ${criterion.receiptId}` : ''}</Text>)}
        {selected.workstream.checkpoint.references.length === 0 ? <Text style={{ color: palette.warning }}>No qualified evidence reference is bound to this workstream.</Text> : selected.workstream.checkpoint.references.map((reference) => {
          const evidence = workstreamEvidence[`${selected.workstream.id}:${reference.sourceId}`];
          return <View key={reference.sourceId} style={styles.evidenceSource}>
            <Text selectable style={{ color: palette.text }}>Selector: {reference.sourceId}</Text>
            <Text style={{ color: palette.muted }}>Expected version: {reference.expectedVersion}</Text>
            <Button compact mode="outlined" disabled={busy} onPress={() => { setBusy(true); void inspectWorkstreamEvidence(projectId, selected.workstream.id, reference.sourceId).catch((reason) => setLocalError(reason instanceof Error ? reason.message : 'Could not inspect evidence.')).finally(() => setBusy(false)); }}>Inspect authoritative evidence</Button>
            {evidence ? <><Text selectable style={{ color: evidence.eligible ? palette.muted : palette.warning }}>Evidence: {evidence.eligible ? 'qualified' : stateLabel(evidence.reason ?? 'unavailable')}{evidence.canonicalId ? ` · ${evidence.canonicalId}` : ''}{evidence.observedVersion ? ` · ${evidence.observedVersion}` : ''}</Text>{evidence.eligible && waivableJobId && unresolvedCriterionIds.length > 0 ? <Button compact mode="contained" disabled={busy} onPress={() => { setBusy(true); void verifyWorkstreamCriteria(projectId, selected.workstream.id, { expectedRevision: selected.workstream.revision, jobId: waivableJobId, sourceId: reference.sourceId, criterionIds: unresolvedCriterionIds }).catch((reason) => setLocalError(reason instanceof Error ? reason.message : 'Could not verify criteria from evidence.')).finally(() => setBusy(false)); }}>Verify all unresolved criteria</Button> : null}</> : null}
          </View>;
        })}
        {waivableJobId && unresolvedCriterionIds.length > 0 ? <View style={styles.actions}><Text style={{ color: palette.warning }}>A waiver resolves every remaining criterion in one reviewed receipt; it cannot be applied one line at a time.</Text><Button mode="outlined" disabled={busy} onPress={() => { setBusy(true); void waiveWorkstreamCriteria(projectId, selected.workstream.id, { expectedRevision: selected.workstream.revision, jobId: waivableJobId, criterionIds: unresolvedCriterionIds }).catch((reason) => setLocalError(reason instanceof Error ? reason.message : 'Could not waive unresolved criteria.')).finally(() => setBusy(false)); }}>Waive all unresolved criteria</Button></View> : null}
        {usageUnknown ? <View style={styles.actions}><Text style={{ color: palette.muted }}>Actual usage is unavailable. Recording a charge never raises the authorization cap.</Text><Text style={{ color: palette.muted }}>Proposed charge: {authorizedTokens === null ? 'declared estimate unavailable' : `${authorizedTokens.toLocaleString()} tokens`} · basis: declared worker authorization · uncertainty: actual usage unavailable.</Text><Button mode="outlined" disabled={busy} onPress={() => { setBusy(true); void acknowledgeWorkstreamUsage(projectId, selected.workstream.id, { expectedRevision: selected.workstream.revision, jobId: currentJob.id, accept: true }).catch((reason) => setLocalError(reason instanceof Error ? reason.message : 'Could not record estimate charge.')).finally(() => setBusy(false)); }}>Record estimate charge</Button><Button mode="outlined" disabled={busy} onPress={() => { setBusy(true); void acknowledgeWorkstreamUsage(projectId, selected.workstream.id, { expectedRevision: selected.workstream.revision, jobId: currentJob.id, accept: false }).catch((reason) => setLocalError(reason instanceof Error ? reason.message : 'Could not retain usage hold.')).finally(() => setBusy(false)); }}>Keep usage hold</Button></View> : null}
        {acknowledgement ? <Text style={{ color: palette.muted }}>Recorded estimate charge: {numberAt(acknowledgement, 'chargedEstimateTokens')?.toLocaleString() ?? 'unavailable'} tokens · remaining authorization: {numberAt(acknowledgement, 'remainingAuthorizedTokens')?.toLocaleString() ?? 'unavailable'} · {textAt(acknowledgement, 'basis') ?? 'basis unavailable'} · {textAt(acknowledgement, 'uncertainty') ?? 'uncertainty unavailable'}.</Text> : null}
        {currentJob.state === 'unknown' ? <View style={styles.actions}><Text style={{ color: palette.warning }}>This worker is held as unknown. Check only the server&apos;s exact engine binding; no retry will be sent unless a later explicit Run next is admitted.</Text><Button mode="outlined" disabled={busy} onPress={() => { setBusy(true); void reconcileWorkstreamUnknown(projectId, selected.workstream.id, { expectedRevision: selected.workstream.revision, jobId: currentJob.id }).catch((reason) => setLocalError(reason instanceof Error ? reason.message : 'Could not check worker status.')).finally(() => setBusy(false)); }}>Check authoritative worker status</Button></View> : null}
      </View> : null}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radii.grouped, gap: Spacing.x4, padding: Spacing.x4 },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: Spacing.x2, justifyContent: 'space-between' },
  titleCopy: { flex: 1, gap: 2 },
  form: { gap: Spacing.x2 },
  detail: { gap: Spacing.x2, paddingTop: Spacing.x2 },
  runBox: { borderRadius: Radii.control, gap: Spacing.x2, padding: Spacing.x2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.x2 },
  workers: { gap: Spacing.x2 },
  worker: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radii.control, gap: 3, padding: Spacing.x2 },
  evidence: { gap: Spacing.x1 },
  evidenceSource: { gap: Spacing.x1, paddingVertical: Spacing.x1 },
});
