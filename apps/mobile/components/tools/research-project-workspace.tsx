import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, Portal, Surface, Text, TextInput } from 'react-native-paper';

import { ResearchMarkdown } from '@/components/tools/research-markdown';
import { ToolDialog } from '@/components/tools/tool-dialog';
import { NativeSelect, type NativeSelectOption } from '@/components/ui/native-select';
import type { Colors } from '@/constants/theme';
import type { ModelOption } from '@/providers/opencode-provider-utils';
import type {
  ResearchSettingsEdit,
  ResearchWorkspace,
} from '@/providers/rhythm-tools-provider';
import {
  canCancelResearchRun,
  canFinishResearchRun,
  canResumeResearchRun,
  DEFAULT_RESEARCH_BUDGET,
  researchBudgetExhausted,
  researchHasEvidence,
  researchHasSynthesis,
  researchPolicyRef,
  researchReportReady,
  researchRunActive,
  researchStages,
  type ResearchBudget,
  type ResearchModelRef,
  type ResearchProject,
  type ResearchProjectRun,
} from '@/providers/services/rhythm-tools-service';

type Palette = typeof Colors.light;

/** A blank field is NaN (never 0): the provider rejects it with a clear message instead of saving a zero limit. */
const parseNumber = (text: string) => (text.trim() === '' ? Number.NaN : Number(text));

const BUDGET_FIELDS: {
  key: keyof ResearchBudget;
  label: string;
  hint: string;
  /** Display unit conversion only; untouched values are never sent, so nothing is rounded implicitly. */
  toDisplay: (value: number) => string;
  fromDisplay: (text: string) => number;
}[] = [
  {
    key: 'maxPasses',
    label: 'Researchers (passes)',
    hint: 'Whole number from 0 to 10.',
    toDisplay: (value) => String(value),
    fromDisplay: parseNumber,
  },
  {
    key: 'maxTokens',
    label: 'Token limit',
    hint: 'Whole tokens, 50,000 to 100,000,000. A pass is typically 1–2M.',
    toDisplay: (value) => String(value),
    fromDisplay: parseNumber,
  },
  {
    key: 'maxCostUsd',
    label: 'Spending limit (USD)',
    hint: 'Estimated provider cost, up to $1,000.',
    toDisplay: (value) => String(value),
    fromDisplay: parseNumber,
  },
  {
    key: 'maxWallClockMs',
    label: 'Time limit (minutes)',
    hint: '1 to 360 minutes, counted from the start of a run.',
    toDisplay: (value) => String(value / 60_000),
    fromDisplay: (text) => {
      const minutes = parseNumber(text);
      return Number.isFinite(minutes) ? Math.round(minutes * 60_000) : Number.NaN;
    },
  },
];

const tokenCount = (tokens: number) =>
  tokens < 100_000
    ? `${(tokens / 1_000).toLocaleString('en-US', { maximumFractionDigits: 1 })}K`
    : `${(tokens / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 2 })}M`;

function budgetSummary(budget: Record<string, unknown>): string {
  const number = (key: keyof ResearchBudget) =>
    typeof budget[key] === 'number' ? (budget[key] as number) : null;
  const passes = number('maxPasses');
  const tokens = number('maxTokens');
  const cost = number('maxCostUsd');
  const wall = number('maxWallClockMs');
  return [
    passes === null ? 'Passes: server default' : `Up to ${passes} ${passes === 1 ? 'pass' : 'passes'}`,
    tokens === null ? 'tokens: server default' : `${tokenCount(tokens)} tokens`,
    cost === null ? 'cost: server default' : `$${cost.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
    wall === null ? 'time: server default' : `${wall / 60_000} min`,
  ].join(' · ');
}

const modelKey = (ref: ResearchModelRef | null) => (ref ? `${ref.providerId}/${ref.modelId}` : '');
const refFromKey = (key: string): ResearchModelRef | null => {
  const slash = key.indexOf('/');
  return slash > 0 ? { providerId: key.slice(0, slash), modelId: key.slice(slash + 1) } : null;
};

function formatTime(value: string | null): string {
  if (!value) return 'not started';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 24);
  try {
    return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return value.slice(0, 24);
  }
}

const statusLabel = (status: string) => status.replace(/_/g, ' ');

function stageTitle(stage: Record<string, unknown>): string {
  const role = String(stage.role ?? 'stage');
  if (role === 'plan') return 'Plan';
  if (role === 'critic') return 'Critic';
  if (role === 'synthesis') return 'Final report';
  return typeof stage.ordinal === 'number' ? `Researcher ${stage.ordinal + 1}` : role;
}

export function ResearchProjectWorkspace({
  models,
  palette,
  workspace,
}: {
  models: ModelOption[];
  palette: Palette;
  workspace: ResearchWorkspace;
}) {
  const {
    actionError,
    canMutate,
    error,
    missing,
    offline,
    pending,
    projects,
    report,
    reportError,
    runDetail,
    runs,
    selectedProjectId,
    selectedRunId,
    unavailable,
  } = workspace;
  const selected = projects.find((project) => project.id === selectedProjectId) ?? null;
  const selectedRun = runDetail && runDetail.id === selectedRunId ? runDetail : null;

  // Local form drafts only. They are keyed by scope (+ exact project for settings) so an unpair/account/Mac-project change
  // or a different selection can never save into the wrong place; a same-project refresh keeps explicit unsaved edits.
  const [createOpen, setCreateOpen] = useState(false);
  const [create, setCreate] = useState(newCreateDraft);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsKey = `${workspace.scope}|${selectedProjectId ?? ''}`;
  const [settings, setSettings] = useState<{ key: string; budget: Partial<Record<keyof ResearchBudget, string>>; models: Partial<Record<'lead' | 'researcher', string>> }>({ key: settingsKey, budget: {}, models: {} });
  const [createScope, setCreateScope] = useState(workspace.scope);
  const [localError, setLocalError] = useState<string | null>(null);
  // Completion currency: a save/create captures its scope, exact project and a draft nonce BEFORE awaiting. Only a completion
  // whose intent is still the current one may clear/close its own draft; a provider promise that resolves (even void after a
  // stale cancellation) is never by itself proof that the original UI intent is still current.
  const settingsNonceRef = useRef(0);
  const createNonceRef = useRef(0);
  const settingsKeyRef = useRef(settingsKey);
  settingsKeyRef.current = settingsKey;
  const scopeRef = useRef(workspace.scope);
  scopeRef.current = workspace.scope;
  const createRef = useRef(create);
  createRef.current = create;
  useEffect(() => {
    if (createScope !== workspace.scope) {
      setCreateScope(workspace.scope);
      setCreate(newCreateDraft());
      setCreateOpen(false);
      createNonceRef.current += 1;
    }
  }, [createScope, workspace.scope]);
  useEffect(() => {
    if (settings.key !== settingsKey) {
      setSettings({ key: settingsKey, budget: {}, models: {} });
      setSettingsOpen(false);
      settingsNonceRef.current += 1;
    }
  }, [settings.key, settingsKey]);
  const settingsDraft = settings.key === settingsKey ? settings : { key: settingsKey, budget: {}, models: {} };
  const settingsDraftRef = useRef(settingsDraft);
  settingsDraftRef.current = settingsDraft;

  const modelOptions = useMemo(
    () => models.map((model) => ({
      value: `${model.providerID}/${model.modelID}`,
      label: `${model.label} · ${model.providerLabel}`,
    })),
    [models],
  );
  const optionsFor = (currentKey: string): NativeSelectOption<string>[] => [
    { value: '', label: 'Research profile model' },
    // An existing model absent from the list stays visible as its exact unavailable selection.
    ...(currentKey && !modelOptions.some((option) => option.value === currentKey)
      ? [{ value: currentKey, label: `${currentKey} (unavailable)` }]
      : []),
    ...modelOptions,
  ];
  const labelFor = (key: string) =>
    !key ? 'Research profile model' : modelOptions.find((option) => option.value === key)?.label ?? `${key} (unavailable)`;

  const busy = (key: string) => Boolean(pending[key]);
  const attempt = async (action: () => Promise<void>) => {
    setLocalError(null);
    try {
      await action();
      return true;
    } catch {
      return false; // the provider already recorded the original error in actionError
    }
  };

  const modelSummary = (project: ResearchProject) => {
    const policy = project.modelPolicy;
    if (!('lead' in policy) && !('researcher' in policy)) return 'Models: Research profile model for every stage';
    return `Lead: ${labelFor(modelKey(researchPolicyRef(policy, 'lead')))} · Researchers: ${labelFor(modelKey(researchPolicyRef(policy, 'researcher')))}`;
  };

  const stateLine = () => {
    if (unavailable) {
      return (
        <Surface style={[styles.notice, { backgroundColor: palette.surfaceAlt }]} testID="research-workflow-unavailable">
          <Text variant="titleSmall">Research projects aren’t available on this Mac yet</Text>
          <Text style={{ color: palette.muted }} variant="bodySmall">
            This paired Mac does not offer the project and run workflow. Your legacy research jobs below still work.
          </Text>
        </Surface>
      );
    }
    if (error) {
      const title = error.kind === 'auth'
        ? 'Sign-in or pairing needs attention'
        : error.kind === 'forbidden'
          ? 'Not allowed'
          : error.kind === 'not-found'
            ? 'Not found on this Mac'
            : error.kind === 'network'
              ? 'Can’t reach the paired Mac'
              : 'Research couldn’t be loaded';
      return (
        <Surface style={[styles.notice, { backgroundColor: palette.surfaceAlt }]} testID="research-workspace-error">
          <Text variant="titleSmall">{title}</Text>
          <Text style={{ color: palette.muted }} variant="bodySmall">{error.message}</Text>
        </Surface>
      );
    }
    if (offline) {
      return (
        <Surface style={[styles.notice, { backgroundColor: palette.surfaceAlt }]} testID="research-workspace-offline">
          <Text variant="bodySmall">Mac offline — saved Research data is read-only.</Text>
        </Surface>
      );
    }
    return null;
  };

  const openCreate = () => {
    setLocalError(null);
    createNonceRef.current += 1; // a newly opened dialog is a new draft intent
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    const budget: Partial<ResearchBudget> = {};
    for (const field of BUDGET_FIELDS) budget[field.key] = field.fromDisplay(create.budget[field.key]);
    const lead = refFromKey(create.lead);
    const researcher = refFromKey(create.researcher);
    const intent = { scope: workspace.scope, nonce: createNonceRef.current };
    const sent = JSON.stringify(create);
    const ok = await attempt(() => workspace.createProject({
      name: create.name,
      question: create.question,
      goals: create.goals.split('\n'),
      domain: create.domain,
      budget: budget as ResearchBudget,
      modelPolicy: lead || researcher ? { lead, researcher } : null,
    }));
    if (
      ok &&
      scopeRef.current === intent.scope &&
      createNonceRef.current === intent.nonce &&
      JSON.stringify(createRef.current) === sent
    ) {
      setCreateOpen(false);
      setCreate(newCreateDraft());
    }
  };

  const submitSettings = async () => {
    if (!selected) return;
    const edit: ResearchSettingsEdit = {};
    const dirtyBudget: Partial<ResearchBudget> = {};
    for (const field of BUDGET_FIELDS) {
      const text = settingsDraft.budget[field.key];
      if (text !== undefined) dirtyBudget[field.key] = field.fromDisplay(text);
    }
    if (Object.keys(dirtyBudget).length > 0) edit.budget = dirtyBudget;
    const dirtyModels: NonNullable<ResearchSettingsEdit['modelPolicy']> = {};
    for (const side of ['lead', 'researcher'] as const) {
      const value = settingsDraft.models[side];
      if (value !== undefined) dirtyModels[side] = refFromKey(value);
    }
    if (Object.keys(dirtyModels).length > 0) edit.modelPolicy = dirtyModels;
    if (!edit.budget && !edit.modelPolicy) {
      setSettingsOpen(false);
      return;
    }
    const intent = { key: settingsKey, nonce: settingsNonceRef.current };
    const sent = JSON.stringify({ budget: settingsDraft.budget, models: settingsDraft.models });
    const ok = await attempt(() => workspace.saveSettings(selected.id, edit));
    if (
      ok &&
      settingsKeyRef.current === intent.key &&
      settingsNonceRef.current === intent.nonce &&
      JSON.stringify({ budget: settingsDraftRef.current.budget, models: settingsDraftRef.current.models }) === sent
    ) {
      setSettings({ key: intent.key, budget: {}, models: {} });
      setSettingsOpen(false);
    }
  };

  const runCard = (run: ResearchProjectRun) => (
    <Pressable
      accessibilityLabel={`Run ${statusLabel(run.status)}, ${formatTime(run.startedAt ?? run.createdAt)}`}
      accessibilityRole="button"
      accessibilityState={{ selected: run.id === selectedRunId }}
      key={run.id}
      onPress={() => void attempt(() => workspace.selectRun(run.id))}
      style={[
        styles.runRow,
        { borderColor: run.id === selectedRunId ? palette.tint : palette.border },
      ]}
      testID={`research-run-${run.id}`}>
      <Chip compact>{statusLabel(run.status)}</Chip>
      <Text numberOfLines={1} style={styles.runMeta} variant="bodySmall">
        {formatTime(run.startedAt ?? run.createdAt)} · {tokenCount(run.usage.tokens)} tokens · {run.sources.length}{' '}
        {run.sources.length === 1 ? 'source' : 'sources'}
      </Text>
    </Pressable>
  );

  const runDetailView = () => {
    if (missing === 'run') {
      return (
        <Surface style={[styles.notice, { backgroundColor: palette.surfaceAlt }]} testID="research-run-missing">
          <Text variant="bodySmall">
            The selected run is no longer on this Mac. Choose another run; nothing was substituted.
          </Text>
        </Surface>
      );
    }
    if (!selectedRun) {
      return runs.length === 0
        ? <Text style={{ color: palette.muted }} variant="bodySmall">No runs yet. Start one when you are ready.</Text>
        : null;
    }
    const active = researchRunActive(selectedRun);
    const canFinish = canFinishResearchRun(selectedRun);
    const exhausted = researchBudgetExhausted(selectedRun);
    const hasEvidence = researchHasEvidence(selectedRun);
    const hasSynthesis = researchHasSynthesis(selectedRun);
    const ready = researchReportReady(selectedRun);
    const stages = researchStages(selectedRun);
    const runPending = busy(`run:${selectedRun.id}`);
    const unavailableReason = ready
      ? null
      : active
        ? 'The final report is still being written. View report unlocks when it is ready.'
        : hasSynthesis
          ? 'This run has a final stage but no report text, so there is nothing to show.'
          : hasEvidence
            ? `This run stopped before its final report (${statusLabel(selectedRun.status)}). Finish with current evidence to write it from what was gathered.`
            : 'This run stopped before gathering any evidence, so there is no report. Adjust the budget if needed and start a new run.';
    return (
      <View style={styles.section} testID="research-run-detail">
        <View style={styles.rowWrap}>
          <Chip compact>{statusLabel(selectedRun.status)}</Chip>
          <Text variant="titleSmall">Run details</Text>
        </View>
        <Text style={{ color: palette.muted }} variant="bodySmall">
          {selectedRun.usage.tokens.toLocaleString('en-US')} tokens · ${selectedRun.usage.costUsd.toFixed(2)} ·{' '}
          {selectedRun.sources.length} {selectedRun.sources.length === 1 ? 'source' : 'sources'}
        </Text>
        {stages.length > 0 ? (
          <View style={styles.section} testID="research-stages">
            {stages.map((stage, index) => (
              <View key={typeof stage.id === 'string' ? stage.id : index} style={styles.stageRow}>
                <Text numberOfLines={1} style={styles.stageName} variant="bodyMedium">{stageTitle(stage)}</Text>
                <Text style={{ color: palette.muted }} variant="bodySmall">
                  {String(stage.status)}
                  {typeof stage.tokens === 'number' ? ` · ${stage.tokens.toLocaleString('en-US')} tokens` : ''}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {exhausted ? (
          <Text testID="research-budget-exhausted" variant="bodySmall">
            Budget ran out (
            {Array.isArray(selectedRun.diagnostics.reasons)
              ? selectedRun.diagnostics.reasons.map(String).join(', ').replace(/_/g, ' ')
              : 'limit reached'}
            ).
          </Text>
        ) : null}
        {unavailableReason ? (
          <Text style={{ color: palette.muted }} testID="research-report-unavailable" variant="bodySmall">
            {unavailableReason}
          </Text>
        ) : null}
        {canFinish ? (
          <Text style={{ color: palette.muted }} variant="bodySmall">
            {hasSynthesis
              ? 'Finishing re-freezes the report using the project’s current budget.'
              : 'Finishing writes the final report from the evidence gathered so far, using the project’s current budget, without new passes or a critic review.'}
          </Text>
        ) : null}
        <View style={styles.rowWrap}>
          {canResumeResearchRun(selectedRun) ? (
            <Button
              accessibilityLabel="Resume run"
              disabled={!canMutate || runPending}
              mode="contained"
              onPress={() => void attempt(() => workspace.runAction(selectedRun.projectId, selectedRun.id, 'resume'))}>
              Resume
            </Button>
          ) : null}
          {canCancelResearchRun(selectedRun) ? (
            <Button
              accessibilityLabel="Cancel run"
              disabled={!canMutate || runPending}
              onPress={() => void attempt(() => workspace.runAction(selectedRun.projectId, selectedRun.id, 'cancel'))}>
              Cancel
            </Button>
          ) : null}
          {canFinish ? (
            <Button
              accessibilityLabel="Finish with current evidence"
              disabled={!canMutate || runPending}
              mode="contained"
              onPress={() => void attempt(() => workspace.runAction(selectedRun.projectId, selectedRun.id, 'finish'))}>
              Finish with current evidence
            </Button>
          ) : null}
          <Button
            accessibilityLabel="View report"
            disabled={!ready || !canMutate || busy(`report:${selectedRun.id}`)}
            onPress={() => void attempt(() => workspace.loadReport(selectedRun.projectId, selectedRun.id))}>
            View report
          </Button>
        </View>
        {reportError ? (
          <Text style={{ color: palette.danger }} testID="research-report-error" variant="bodySmall">{reportError}</Text>
        ) : null}
        {report && report.runId === selectedRun.id && report.projectId === selectedRun.projectId ? (
          <Surface style={styles.report} testID="research-report">
            <Text accessibilityRole="header" variant="titleMedium">Research report</Text>
            <View style={styles.rowWrap}>
              <Button onPress={workspace.closeReport}>Close report</Button>
            </View>
            <ResearchMarkdown color={palette.text} mutedColor={palette.muted} text={report.markdown} />
          </Surface>
        ) : null}
      </View>
    );
  };

  const projectDetail = () => {
    if (missing === 'project') {
      return (
        <Surface style={[styles.notice, { backgroundColor: palette.surfaceAlt }]} testID="research-project-missing">
          <Text variant="bodySmall">
            The selected project is no longer on this Mac. Choose another project; nothing was substituted.
          </Text>
        </Surface>
      );
    }
    if (!selected) return null;
    const archived = Boolean(selected.archivedAt);
    const goals = selected.goals.filter((goal): goal is string => typeof goal === 'string' && goal.trim() !== '');
    return (
      <Surface style={styles.detail} testID="research-project-detail">
        <Text accessibilityRole="header" variant="titleMedium">{selected.name || 'Untitled project'}</Text>
        <Text selectable variant="bodyMedium">{selected.question}</Text>
        {goals.length > 0 ? goals.map((goal) => <Text key={goal} variant="bodySmall">• {goal}</Text>) : null}
        <Text style={{ color: palette.muted }} testID="research-budget-summary" variant="bodySmall">
          {budgetSummary(selected.budget)}
        </Text>
        <Text style={{ color: palette.muted }} testID="research-model-summary" variant="bodySmall">
          {modelSummary(selected)}
        </Text>
        <View style={styles.rowWrap}>
          <Button
            accessibilityLabel="Start run"
            disabled={!canMutate || archived || busy(`start:${selected.id}`)}
            mode="contained"
            onPress={() => void attempt(() => workspace.startRun(selected.id))}>
            Start run
          </Button>
          <Button
            accessibilityLabel="Edit research settings"
            disabled={!canMutate || archived}
            onPress={() => {
              setLocalError(null);
              settingsNonceRef.current += 1; // a newly opened dialog is a new draft intent
              setSettingsOpen(true);
            }}>
            Edit settings
          </Button>
        </View>
        {archived ? (
          <Text style={{ color: palette.muted }} variant="bodySmall">Archived projects can’t start new runs.</Text>
        ) : null}
        {runs.length > 0 ? (
          <View style={styles.section} testID="research-run-history">
            <Text variant="titleSmall">Runs</Text>
            {runs.map(runCard)}
          </View>
        ) : null}
        {runDetailView()}
      </Surface>
    );
  };

  const settingsProject = selected;
  const settingsModelKey = (side: 'lead' | 'researcher') =>
    settingsDraft.models[side] ?? (settingsProject ? modelKey(researchPolicyRef(settingsProject.modelPolicy, side)) : '');

  return (
    <View style={styles.root} testID="research-project-workspace">
      <View style={styles.rowWrap}>
        <Text accessibilityRole="header" variant="titleMedium">Research projects</Text>
        <Button
          accessibilityLabel="New research project"
          disabled={!canMutate}
          icon="plus"
          mode="contained"
          onPress={openCreate}>
          New project
        </Button>
      </View>
      {stateLine()}
      {actionError ? (
        <Surface accessibilityLiveRegion="polite" style={[styles.notice, { backgroundColor: palette.surfaceAlt }]} testID="research-action-error">
          <Text variant="bodySmall">{actionError.message}</Text>
        </Surface>
      ) : null}
      {projects.length === 0 && !unavailable && !error ? (
        <Text style={{ color: palette.muted }} variant="bodySmall">
          {workspace.initialised
            ? 'No research projects yet. Create one to keep multi-pass evidence in one place.'
            : 'Loading research projects…'}
        </Text>
      ) : null}
      {projects.map((project) => (
        <Card
          accessibilityLabel={`${project.name || 'Untitled project'}. ${project.archivedAt ? 'Archived' : 'Active'}`}
          accessibilityRole="button"
          accessibilityState={{ selected: project.id === selectedProjectId }}
          key={project.id}
          mode="outlined"
          onPress={() => void attempt(() => workspace.selectProject(project.id))}
          style={[
            styles.card,
            { borderColor: project.id === selectedProjectId ? palette.tint : palette.border },
          ]}
          testID={`research-project-card-${project.id}`}>
          <Card.Content style={styles.cardContent}>
            <View style={styles.rowWrap}>
              <Text numberOfLines={1} style={styles.cardTitle} variant="titleMedium">
                {project.name || 'Untitled project'}
              </Text>
              <Chip compact>{project.archivedAt ? 'archived' : 'active'}</Chip>
            </View>
            <Text numberOfLines={2} style={{ color: palette.muted }} variant="bodyMedium">{project.question}</Text>
            <Text numberOfLines={1} style={{ color: palette.muted }} variant="bodySmall">
              {budgetSummary(project.budget)}
            </Text>
          </Card.Content>
        </Card>
      ))}
      {projectDetail()}
      {localError ? <Text style={{ color: palette.danger }}>{localError}</Text> : null}
      <Portal>
        <ToolDialog
          actions={[
            <Button key="cancel" onPress={() => setCreateOpen(false)}>Cancel</Button>,
            <Button
              accessibilityLabel="Save research project"
              disabled={!canMutate || busy('create')}
              key="save"
              onPress={() => void submitCreate()}>
              Save
            </Button>,
          ]}
          onDismiss={() => setCreateOpen(false)}
          testID="research-create-dialog"
          title="New research project"
          visible={createOpen}>
          <TextInput
            accessibilityLabel="Project name"
            label="Project name"
            onChangeText={(name) => setCreate((draft) => ({ ...draft, name }))}
            value={create.name}
          />
          <TextInput
            accessibilityLabel="Research question"
            label="Research question"
            multiline
            onChangeText={(question) => setCreate((draft) => ({ ...draft, question }))}
            value={create.question}
          />
          <TextInput
            accessibilityLabel="Goals, one per line"
            label="Goals (one per line)"
            multiline
            onChangeText={(goals) => setCreate((draft) => ({ ...draft, goals }))}
            value={create.goals}
          />
          <TextInput
            accessibilityLabel="Domain"
            label="Domain (optional)"
            onChangeText={(domain) => setCreate((draft) => ({ ...draft, domain }))}
            value={create.domain}
          />
          <Text variant="titleSmall">Budget</Text>
          {BUDGET_FIELDS.map((field) => (
            <TextInput
              accessibilityLabel={field.label}
              key={field.key}
              keyboardType="decimal-pad"
              label={field.label}
              onChangeText={(text) => setCreate((draft) => ({ ...draft, budget: { ...draft.budget, [field.key]: text } }))}
              value={create.budget[field.key]}
            />
          ))}
          <Text style={{ color: palette.muted }} variant="bodySmall">
            Creating a project does not start a run. Limits can be changed later and are never raised for you.
          </Text>
          <Text variant="titleSmall">Models</Text>
          {(['lead', 'researcher'] as const).map((side) => (
            <NativeSelect
              key={side}
              onValueChange={(value) => setCreate((draft) => ({ ...draft, [side]: value }))}
              options={optionsFor(create[side])}
              renderTrigger={({ disabled, open }) => (
                <Button
                  accessibilityLabel={`${side === 'lead' ? 'Lead model' : 'Researcher model'}, ${labelFor(create[side])}`}
                  disabled={disabled}
                  mode="outlined"
                  onPress={open}>
                  {side === 'lead' ? 'Lead' : 'Researcher'}: {labelFor(create[side])}
                </Button>
              )}
              selectedValue={create[side]}
              title={side === 'lead' ? 'Lead model' : 'Researcher model'}
            />
          ))}
        </ToolDialog>
        <ToolDialog
          actions={[
            <Button key="cancel" onPress={() => setSettingsOpen(false)}>Cancel</Button>,
            <Button
              accessibilityLabel="Save research settings"
              disabled={!canMutate || !settingsProject || busy(`save:${settingsProject.id}`)}
              key="save"
              onPress={() => void submitSettings()}>
              Save
            </Button>,
          ]}
          onDismiss={() => setSettingsOpen(false)}
          testID="research-settings-dialog"
          title="Research settings"
          visible={settingsOpen && Boolean(settingsProject)}>
          {settingsProject ? (
            <>
              <Text style={{ color: palette.muted }} variant="bodySmall">
                Only fields you change are saved, merged over the project as it is on the Mac right now.
              </Text>
              {BUDGET_FIELDS.map((field) => {
                const canonical = settingsProject.budget[field.key];
                return (
                  <TextInput
                    accessibilityLabel={field.label}
                    key={field.key}
                    keyboardType="decimal-pad"
                    label={field.label}
                    onChangeText={(text) => setSettings({
                      ...settingsDraft,
                      budget: { ...settingsDraft.budget, [field.key]: text },
                    })}
                    value={settingsDraft.budget[field.key] ?? (typeof canonical === 'number' ? field.toDisplay(canonical) : '')}
                  />
                );
              })}
              {(['lead', 'researcher'] as const).map((side) => (
                <NativeSelect
                  key={side}
                  onValueChange={(value) => setSettings({
                    ...settingsDraft,
                    models: { ...settingsDraft.models, [side]: value },
                  })}
                  options={optionsFor(settingsModelKey(side))}
                  renderTrigger={({ disabled, open }) => (
                    <Button
                      accessibilityLabel={`${side === 'lead' ? 'Lead model' : 'Researcher model'}, ${labelFor(settingsModelKey(side))}`}
                      disabled={disabled}
                      mode="outlined"
                      onPress={open}>
                      {side === 'lead' ? 'Lead' : 'Researcher'}: {labelFor(settingsModelKey(side))}
                    </Button>
                  )}
                  selectedValue={settingsModelKey(side)}
                  title={side === 'lead' ? 'Lead model' : 'Researcher model'}
                />
              ))}
              <Text style={{ color: palette.muted }} variant="bodySmall">
                These are Research project settings. They don’t change your chat model, profile, thinking or Fast setting.
              </Text>
            </>
          ) : null}
        </ToolDialog>
      </Portal>
    </View>
  );
}

function newCreateDraft() {
  return {
    name: '',
    question: '',
    goals: '',
    domain: '',
    lead: '',
    researcher: '',
    budget: Object.fromEntries(
      BUDGET_FIELDS.map((field) => [field.key, field.toDisplay(DEFAULT_RESEARCH_BUDGET[field.key])]),
    ) as Record<keyof ResearchBudget, string>,
  };
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  cardContent: { gap: 4 },
  cardTitle: { flex: 1, minWidth: 0 },
  detail: { borderRadius: 12, gap: 8, padding: 12 },
  notice: { borderRadius: 12, gap: 4, padding: 12 },
  report: { borderRadius: 12, gap: 8, padding: 12 },
  root: { gap: 10 },
  rowWrap: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  runMeta: { flex: 1, minWidth: 0 },
  runRow: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 44,
    padding: 8,
  },
  section: { gap: 6 },
  stageName: { flex: 1, minWidth: 0 },
  stageRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
});
