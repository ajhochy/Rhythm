import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Dialog,
  Divider,
  List,
  Portal,
  Searchbar,
  SegmentedButtons,
  Switch,
  Text,
  TextInput,
} from 'react-native-paper';

import { Colors, Radii, Spacing, TypeScale } from '@/constants/theme';
import { normalizeProfileIcon } from '@/components/ui/profile-icon';
import {
  applyProfileDefaults,
  AUTO_MODEL_LABEL,
  getNewSessionPreferences,
  modelMatchesSearch,
  NO_SELECTABLE_PROFILE_MESSAGE,
  profileMatchesSearch,
  type AgentOption,
  type ChatPreferences,
  type ModelOption,
  type PermissionMode,
} from '@/providers/opencode-provider-utils';
import { selectModelPickerGroups } from '@/providers/opencode-provider-selectors';
import type { OpencodeProject, ProviderOption } from '@/providers/opencode-provider-types';

type Palette = typeof Colors.light;

type SessionConfigurationSheetProps = {
  availableModels: ModelOption[];
  availableProfiles: AgentOption[];
  availableProjects?: OpencodeProject[];
  availableProviders: ProviderOption[];
  children?: ReactNode;
  mode: 'create' | 'edit';
  onCreate?: (
    title: string | undefined,
    preferences: ChatPreferences,
  ) => Promise<void>;
  onDismiss: () => void;
  onProjectChange?: (projectPath: string) => void;
  onPreferencesChange?: (
    preferences: Partial<ChatPreferences>,
  ) => Promise<ChatPreferences>;
  palette: Palette;
  preferences: ChatPreferences;
  selectedProjectPath?: string;
  /** Edit-mode gate for the exact visible target (e.g. a persistent Rhythm primary). */
  settingsGate?: SessionSettingsGate;
  visible: boolean;
};

export type SessionSettingsGate = {
  /** Only model, reasoning and Fast are editable; profile/approval stay read-only. */
  modelOnly?: boolean;
  /** Present while settings cannot be edited (loading, or unsupported by this Mac). */
  unavailableReason?: string;
  /** Visible scope note, e.g. that a choice is saved to this chat. */
  scopeNote?: string;
  /** Fast is supported and known for this target. */
  showFast?: boolean;
  /** Canonical values are not ready: show honest placeholders instead of ordinary defaults. */
  valuesUnavailable?: 'loading' | 'unavailable';
};

const REASONING_OPTIONS: {
  value: ChatPreferences['reasoning'];
  label: string;
}[] = [
  { value: 'low', label: 'Low' },
  { value: 'default', label: 'Default' },
  { value: 'high', label: 'High' },
];

const APPROVAL_OPTIONS: {
  value: PermissionMode;
  label: string;
  description: string;
}[] = [
  {
    value: 'default',
    label: 'Ask as needed',
    description: 'Ask before edits, commands, and other protected actions.',
  },
  {
    value: 'acceptEdits',
    label: 'Accept edits',
    description: 'Allow file edits while retaining other approval prompts.',
  },
  {
    value: 'plan',
    label: 'Plan only',
    description: 'Keep the session in a review-first planning posture.',
  },
  {
    value: 'bypassPermissions',
    label: 'Allow all',
    description: 'Run this chat without interactive approval prompts.',
  },
];

function selectedModelLabel(
  models: ModelOption[],
  modelId: string | undefined,
  modelMode?: ChatPreferences['modelMode'],
): string {
  if (modelMode === 'auto') return AUTO_MODEL_LABEL;
  return models.find((model) => model.id === modelId)?.label ??
    modelId ??
    'Choose model';
}

export function SessionConfigurationSheet({
  availableModels,
  availableProfiles,
  availableProjects = [],
  availableProviders,
  children,
  mode,
  onCreate,
  onDismiss,
  onProjectChange,
  onPreferencesChange,
  palette,
  preferences,
  selectedProjectPath,
  settingsGate,
  visible,
}: SessionConfigurationSheetProps) {
  const settingsLocked = mode === 'edit' && Boolean(settingsGate?.unavailableReason);
  const modelOnly = mode === 'edit' && Boolean(settingsGate?.modelOnly);
  const placeholder = mode === 'edit' && settingsGate?.valuesUnavailable
    ? settingsGate.valuesUnavailable === 'loading' ? 'Loading…' : 'Unavailable'
    : undefined;
  const [page, setPage] = useState<'summary' | 'profiles' | 'models' | 'projects' | 'approvals'>(
    'summary',
  );
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [draft, setDraft] = useState<ChatPreferences | undefined>(
    preferences,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const wasVisibleRef = useRef(false);
  const previousProjectPathRef = useRef(selectedProjectPath);

  useEffect(() => {
    const justOpened = visible && !wasVisibleRef.current;
    wasVisibleRef.current = visible;
    if (!justOpened) return;
    setPage('summary');
    setQuery('');
    setTitle('');
    setError(undefined);
    setDraft(
      mode === 'create'
        ? getNewSessionPreferences(availableProfiles, preferences)
        : preferences,
    );
  }, [availableProfiles, mode, preferences, visible]);

  // Canonical settings can arrive or be saved while the edit sheet is open; the
  // draft must follow them so an explicit edit never carries stale fields.
  useEffect(() => {
    if (visible && mode === 'edit' && !busy) setDraft(preferences);
  }, [busy, mode, preferences, visible]);

  useEffect(() => {
    const projectChanged = previousProjectPathRef.current !== selectedProjectPath;
    previousProjectPathRef.current = selectedProjectPath;
    if (!visible || mode !== 'create' || !projectChanged) return;
    setDraft(undefined);
  }, [mode, selectedProjectPath, visible]);

  // ponytail: the sheet can now open before the profile catalog resolves
  // (NC-3). If it arrives while already open with no draft picked yet,
  // pick a default now instead of only at open-time.
  useEffect(() => {
    if (
      !visible ||
      mode !== 'create' ||
      availableProfiles.length === 0 ||
      (draft && availableProfiles.some((profile) => profile.profileId === draft.profileId))
    ) return;
    setDraft(getNewSessionPreferences(availableProfiles, preferences));
  }, [availableProfiles, draft, mode, preferences, visible]);

  const modelGroups = useMemo(() => {
    const enabledModelIds = draft?.modelId &&
        preferences.enabledModelIds.length > 0 &&
        !preferences.enabledModelIds.includes(draft.modelId)
      ? [...preferences.enabledModelIds, draft.modelId]
      : preferences.enabledModelIds;
    return selectModelPickerGroups({
      availableModels,
      availableProviders,
      enabledModelIds,
      recentModelIds: Object.values(
        preferences.providerModelSelections,
      ),
      selectedModelId: draft?.modelId,
    });
  }, [
    availableModels,
    availableProviders,
    draft?.modelId,
    preferences.enabledModelIds,
    preferences.providerModelSelections,
  ]);

  const filteredProfiles = useMemo(
    () => availableProfiles.filter(
      (profile) => profileMatchesSearch(profile, query),
    ),
    [availableProfiles, query],
  );
  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return availableProjects;
    return availableProjects.filter((project) =>
      [project.label, project.path].some((value) =>
        value.toLocaleLowerCase().includes(normalizedQuery),
      ),
    );
  }, [availableProjects, query]);
  const filteredModelGroups = useMemo(
    () => modelGroups
      .map((group) => ({
        ...group,
        models: group.models.filter((model) =>
          modelMatchesSearch(model, query, {
            accountLabel: group.accountLabel,
            providerLabel: group.providerLabel,
          })),
      }))
      .filter((group) => group.models.length > 0),
    [modelGroups, query],
  );
  const showAutoOption = page === 'models' &&
    (!query.trim() || AUTO_MODEL_LABEL.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedProfile = availableProfiles.find(
    (profile) => profile.profileId === draft?.profileId,
  );
  const selectedProject = availableProjects.find(
    (project) => project.path === selectedProjectPath,
  );
  const selectedApproval = APPROVAL_OPTIONS.find(
    (option) => option.value === draft?.permissionMode,
  );

  async function commit(next: ChatPreferences) {
    setDraft(next);
    setError(undefined);
    if (mode !== 'edit' || !onPreferencesChange) return;
    setBusy(true);
    try {
      setDraft(await onPreferencesChange(next));
    } catch (reason) {
      setDraft(preferences);
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not update this chat.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!draft || !onCreate) return;
    setBusy(true);
    setError(undefined);
    try {
      await onCreate(title.trim() || undefined, draft);
      onDismiss();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not create this chat.',
      );
    } finally {
      setBusy(false);
    }
  }

  const pickerTitle = page === 'profiles'
    ? 'Choose Profile'
    : page === 'models'
      ? 'Choose Model'
      : page === 'projects'
        ? 'Choose Project'
        : 'Choose Approval Policy';
  // One source of truth for the title: the announced name must follow the
  // visible heading when the sheet navigates into a picker page, otherwise
  // assistive tech keeps announcing "Session configuration" while the screen
  // reads "Choose Model".
  const dialogTitle =
    page === 'summary'
      ? mode === 'create'
        ? 'New chat'
        : 'Session configuration'
      : pickerTitle;

  // A chat screen mounts this sheet twice by design — `mode="create"` for the
  // new-chat flow and `mode="edit"` for the three-dot session config. Paper's
  // Dialog keeps its subtree mounted when `visible` is false, so the closed
  // sheet would leave a second set of identically-labelled, focusable controls
  // in the tree: ambiguous for assistive tech and for any locator.
  if (!visible) return null;

  return (
    <Portal>
      <Dialog
        dismissable={!busy}
        onDismiss={onDismiss}
        style={[styles.dialog, { backgroundColor: palette.surface }]}
        visible={visible}>
        <Dialog.Title accessibilityLabel={dialogTitle} style={[styles.dialogTitle, { color: palette.text }]}>
          {dialogTitle}
        </Dialog.Title>
        <Dialog.ScrollArea style={styles.scrollArea}>
          <ScrollView
            keyboardShouldPersistTaps="handled">
            <View style={styles.content} testID="session-configuration-content">
            {page !== 'summary' ? (
              <>
                {page !== 'approvals' ? (
                  <Searchbar
                    accessibilityLabel={`Search ${page}`}
                    autoFocus
                    onChangeText={setQuery}
                    placeholder={`Search ${page}`}
                    // Paper keeps an inert transparent clear button mounted when empty, which leaves a blank pale circle.
                    // A defined `right` hides that whole clear wrapper (display:none); undefined restores the stock clear.
                    right={query ? undefined : () => null}
                    value={query}
                  />
                ) : null}
                {showAutoOption ? (
                  <List.Item
                    accessibilityLabel={AUTO_MODEL_LABEL}
                    accessibilityRole="button"
                    description="The router picks a model for you"
                    left={(props) => (
                      <List.Icon
                        {...props}
                        icon={draft?.modelMode === 'auto' ? 'check-circle' : 'auto-fix'}
                      />
                    )}
                    onPress={() => {
                      if (!draft) return;
                      void commit({ ...draft, modelMode: 'auto' });
                      setPage('summary');
                      setQuery('');
                    }}
                    title={AUTO_MODEL_LABEL}
                    titleNumberOfLines={0}
                  />
                ) : null}
                {page === 'approvals'
                  ? APPROVAL_OPTIONS.map((option) => (
                      <List.Item
                        accessibilityLabel={option.label}
                        accessibilityRole="button"
                        description={option.description}
                        descriptionNumberOfLines={0}
                        key={option.value}
                        left={(props) => (
                          <List.Icon
                            {...props}
                            icon={option.value === draft?.permissionMode ? 'check-circle' : 'shield-outline'}
                          />
                        )}
                        onPress={() => {
                          if (!draft) return;
                          void commit({
                            ...draft,
                            permissionMode: option.value,
                            autoApprove: option.value === 'bypassPermissions',
                          });
                          setPage('summary');
                        }}
                        title={option.label}
                        titleNumberOfLines={1}
                      />
                    ))
                  : page === 'projects'
                  ? filteredProjects.map((project) => (
                      <List.Item
                        accessibilityLabel={project.label}
                        accessibilityRole="button"
                        description={project.path}
                        descriptionNumberOfLines={1}
                        key={project.path}
                        left={(props) => (
                          <List.Icon
                            {...props}
                            icon={project.path === selectedProjectPath ? 'check-circle' : 'folder-outline'}
                          />
                        )}
                        onPress={() => {
                          onProjectChange?.(project.path);
                          setPage('summary');
                          setQuery('');
                        }}
                        title={project.label}
                        titleNumberOfLines={1}
                      />
                    ))
                  : page === 'profiles'
                  ? filteredProfiles.map((profile) => (
                      <List.Item
                        key={profile.profileId}
                        description={[
                          profile.profileId,
                          profile.opencodeAgentId,
                          profile.defaults?.providerId,
                          profile.defaults?.modelId,
                        ].filter(Boolean).join(' · ')}
                        left={(props) => (
                          <List.Icon
                            {...props}
                            icon={
                              profile.profileId === draft?.profileId
                                ? 'check-circle'
                                : normalizeProfileIcon(profile.display?.icon)
                            }
                          />
                        )}
                        onPress={() => {
                          if (!draft) return;
                          void commit(applyProfileDefaults(profile, draft));
                          setPage('summary');
                          setQuery('');
                        }}
                        descriptionNumberOfLines={0}
                        title={profile.label}
                        titleNumberOfLines={0}
                      />
                    ))
                  : filteredModelGroups.map((group) => (
                      <List.Section
                        key={`${group.providerId}:${group.accountLabel}`}
                        title={
                          group.accountLabel === group.providerLabel
                            ? group.providerLabel
                            : `${group.providerLabel} — ${group.accountLabel}`
                        }>
                        {group.models.map((model) => (
                          <List.Item
                            key={model.id}
                            description={[
                              group.accountLabel,
                              model.rankLabel,
                              model.supportsReasoning
                                ? 'Reasoning'
                                : undefined,
                            ].filter(Boolean).join(' · ')}
                            left={(props) => (
                              <List.Icon
                                {...props}
                                icon={
                                  model.id === draft?.modelId && draft?.modelMode !== 'auto'
                                    ? 'check-circle'
                                    : 'cube-outline'
                                }
                              />
                            )}
                            onPress={() => {
                              if (!draft) return;
                              void commit({
                                ...draft,
                                providerId: model.providerID,
                                modelId: model.id,
                                modelMode: 'fixed',
                                providerModelSelections: {
                                  ...draft.providerModelSelections,
                                  [model.providerID]: model.id,
                                },
                              });
                              setPage('summary');
                              setQuery('');
                            }}
                            descriptionNumberOfLines={0}
                            title={model.label}
                            titleNumberOfLines={0}
                          />
                        ))}
                      </List.Section>
                    ))}
                {(page === 'approvals'
                  ? APPROVAL_OPTIONS.length
                  : page === 'projects'
                  ? filteredProjects.length
                  : page === 'profiles'
                    ? filteredProfiles.length
                    : filteredModelGroups.length + (showAutoOption ? 1 : 0)) === 0 ? (
                  <Text style={{ color: palette.muted }}>
                    No matching {page}.
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                {mode === 'create' ? (
                  <TextInput
                    accessibilityLabel="Chat title"
                    label="Title (optional)"
                    mode="outlined"
                    onChangeText={setTitle}
                    value={title}
                  />
                ) : null}
                {!draft ? (
                  <Text style={{ color: palette.danger }}>
                    {NO_SELECTABLE_PROFILE_MESSAGE}
                  </Text>
                ) : (
                  <>
                    <View style={[styles.summaryGroup, { backgroundColor: palette.surfaceAlt }]}>
                      <List.Item
                        accessibilityLabel={`Profile, ${placeholder ?? selectedProfile?.label ?? 'Unassigned'}`}
                        accessibilityRole="button"
                        disabled={busy || availableProfiles.length === 0 || modelOnly}
                        description={placeholder ?? selectedProfile?.label ?? 'Unassigned'}
                        descriptionNumberOfLines={1}
                        left={(props) => <List.Icon {...props} icon="account-outline" />}
                        onPress={() => {
                          setQuery('');
                          setPage('profiles');
                        }}
                        right={(props) => <List.Icon {...props} icon="chevron-right" />}
                        style={styles.summaryRow}
                        testID="session-profile-row"
                        title="Profile"
                        titleNumberOfLines={1}
                        titleStyle={styles.rowLabel}
                      />
                      <Divider />
                      <List.Item
                        accessibilityLabel={`Model, ${placeholder ?? selectedModelLabel(availableModels, draft.modelId, draft.modelMode)}`}
                        accessibilityRole="button"
                        disabled={busy || modelGroups.length === 0 || settingsLocked}
                        description={placeholder ?? selectedModelLabel(availableModels, draft.modelId, draft.modelMode)}
                        descriptionNumberOfLines={1}
                        left={(props) => <List.Icon {...props} icon="cube-outline" />}
                        onPress={() => {
                          setQuery('');
                          setPage('models');
                        }}
                        right={(props) => <List.Icon {...props} icon="chevron-right" />}
                        style={styles.summaryRow}
                        testID="session-model-row"
                        title="Model"
                        titleNumberOfLines={1}
                        titleStyle={styles.rowLabel}
                      />
                      {mode === 'create' && availableProjects.length > 0 ? (
                        <>
                          <Divider />
                          <List.Item
                            accessibilityLabel={`Project, ${selectedProject?.label ?? 'Choose project'}`}
                            accessibilityRole="button"
                            description={selectedProject?.label ?? 'Choose project'}
                            descriptionNumberOfLines={1}
                            disabled={busy}
                            left={(props) => <List.Icon {...props} icon="folder-outline" />}
                            onPress={() => {
                              setQuery('');
                              setPage('projects');
                            }}
                            right={(props) => <List.Icon {...props} icon="chevron-right" />}
                            style={styles.summaryRow}
                            testID="session-project-row"
                            title="Project"
                            titleNumberOfLines={1}
                            titleStyle={styles.rowLabel}
                          />
                        </>
                      ) : null}
                      <Divider />
                      <List.Item
                        accessibilityLabel={`Approval Policy, ${placeholder ?? selectedApproval?.label ?? 'Choose policy'}`}
                        accessibilityRole="button"
                        description={placeholder ?? selectedApproval?.label ?? 'Choose policy'}
                        descriptionNumberOfLines={1}
                        disabled={busy || modelOnly}
                        left={(props) => <List.Icon {...props} icon="shield-check-outline" />}
                        onPress={() => {
                          setQuery('');
                          setPage('approvals');
                        }}
                        right={(props) => <List.Icon {...props} icon="chevron-right" />}
                        style={styles.summaryRow}
                        testID="session-approval-row"
                        title="Approval Policy"
                        titleNumberOfLines={1}
                        titleStyle={styles.rowLabel}
                      />
                    </View>
                    <View style={styles.field}>
                      <Text accessibilityLabel="Reasoning" style={styles.fieldLabel}>
                        Reasoning
                      </Text>
                      <SegmentedButtons
                        buttons={REASONING_OPTIONS.map((option) => ({ ...option, disabled: busy || settingsLocked }))}
                        density="small"
                        onValueChange={(value) => {
                          void commit({
                            ...draft,
                            reasoning: value as ChatPreferences['reasoning'],
                          });
                        }}
                        value={placeholder ? '' : draft.reasoning}
                      />
                    </View>
                    {mode === 'edit' && settingsGate?.showFast && draft.fastMode !== undefined ? (
                      <List.Item
                        accessibilityLabel={`Fast, ${draft.fastMode ? 'on' : 'off'}`}
                        description="Priority service tier for this chat. Off unless you turn it on."
                        descriptionNumberOfLines={0}
                        left={(props) => <List.Icon {...props} icon="flash-outline" />}
                        right={() => (
                          <Switch
                            accessibilityLabel="Fast"
                            disabled={busy || settingsLocked}
                            onValueChange={(value) => { void commit({ ...draft, fastMode: value }); }}
                            testID="session-fast-switch"
                            value={draft.fastMode === true}
                          />
                        )}
                        style={styles.summaryRow}
                        testID="session-fast-row"
                        title="Fast"
                        titleNumberOfLines={1}
                        titleStyle={styles.rowLabel}
                      />
                    ) : null}
                    {mode === 'edit' && (settingsGate?.unavailableReason || settingsGate?.scopeNote) ? (
                      <Text
                        accessibilityLabel={settingsGate.unavailableReason ?? settingsGate.scopeNote}
                        style={{ color: palette.muted, fontSize: TypeScale.footnote }}
                        testID="session-settings-note">
                        {settingsGate.unavailableReason ?? settingsGate.scopeNote}
                      </Text>
                    ) : null}
                    {children ? (
                      <>
                        <Divider />
                        <View style={styles.actions}>{children}</View>
                      </>
                    ) : null}
                  </>
                )}
                {error ? (
                  <Text selectable style={{ color: palette.danger }}>
                    {error}
                  </Text>
                ) : null}
              </>
            )}
            </View>
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions style={[styles.dialogActions, { borderTopColor: palette.border }]}>
          {page !== 'summary' ? (
            <Button
              onPress={() => {
                setPage('summary');
                setQuery('');
              }}>
              Back
            </Button>
          ) : null}
          {page === 'summary' ? (
            <Button disabled={busy} onPress={onDismiss}>Close</Button>
          ) : null}
          {page === 'summary' && mode === 'create' ? (
            <Button
              disabled={busy || !draft || (mode === 'create' && (!selectedProfile || (availableProjects.length > 0 && !selectedProject)))}
              loading={busy}
              mode="contained"
              onPress={() => void create()}>
              Create
            </Button>
          ) : null}
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 6 },
  content: { gap: Spacing.x2, paddingHorizontal: Spacing.x4, paddingBottom: Spacing.x2, paddingTop: 0 },
  dialog: { borderRadius: Radii.sheet, marginHorizontal: Spacing.x4, maxHeight: '86%' },
  dialogActions: { borderTopWidth: StyleSheet.hairlineWidth, minHeight: 52, paddingHorizontal: Spacing.x4, paddingVertical: Spacing.x1 },
  dialogTitle: { fontSize: TypeScale.title2, fontWeight: '700', lineHeight: 28, marginBottom: Spacing.x1 },
  field: { gap: Spacing.x1 },
  fieldLabel: { fontSize: TypeScale.footnote, fontWeight: '700' },
  rowLabel: { fontSize: TypeScale.footnote, fontWeight: '600' },
  scrollArea: { paddingHorizontal: 0 },
  summaryGroup: { borderRadius: Radii.grouped, overflow: 'hidden' },
  summaryRow: { minHeight: 56, paddingHorizontal: Spacing.x2, paddingVertical: 0 },
});
