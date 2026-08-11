import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Dialog,
  Divider,
  List,
  Portal,
  RadioButton,
  Searchbar,
  SegmentedButtons,
  Text,
  TextInput,
} from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { normalizeProfileIcon } from '@/components/ui/profile-icon';
import {
  applyProfileDefaults,
  getNewSessionPreferences,
  modelMatchesSearch,
  profileMatchesSearch,
  type AgentOption,
  type ChatPreferences,
  type ModelOption,
  type PermissionMode,
} from '@/providers/opencode-provider-utils';
import { selectModelPickerGroups } from '@/providers/opencode-provider-selectors';
import type { ProviderOption } from '@/providers/opencode-provider-types';

type Palette = typeof Colors.light;

type SessionConfigurationSheetProps = {
  availableModels: ModelOption[];
  availableProfiles: AgentOption[];
  availableProviders: ProviderOption[];
  children?: ReactNode;
  mode: 'create' | 'edit';
  onCreate?: (
    title: string | undefined,
    preferences: ChatPreferences,
  ) => Promise<void>;
  onDismiss: () => void;
  onPreferencesChange?: (
    preferences: Partial<ChatPreferences>,
  ) => Promise<ChatPreferences>;
  palette: Palette;
  preferences: ChatPreferences;
  visible: boolean;
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
): string {
  return models.find((model) => model.id === modelId)?.label ??
    modelId ??
    'Choose model';
}

export function SessionConfigurationSheet({
  availableModels,
  availableProfiles,
  availableProviders,
  children,
  mode,
  onCreate,
  onDismiss,
  onPreferencesChange,
  palette,
  preferences,
  visible,
}: SessionConfigurationSheetProps) {
  const [page, setPage] = useState<'summary' | 'profiles' | 'models'>(
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
  const selectedProfile = availableProfiles.find(
    (profile) => profile.profileId === draft?.profileId,
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

  const pickerTitle = page === 'profiles' ? 'Choose Profile' : 'Choose Model';
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
        style={styles.dialog}
        visible={visible}>
        <Dialog.Title accessibilityLabel={dialogTitle}>
          {dialogTitle}
        </Dialog.Title>
        <Dialog.ScrollArea style={styles.scrollArea}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled">
            {page !== 'summary' ? (
              <>
                <Searchbar
                  accessibilityLabel={`Search ${page}`}
                  autoFocus
                  onChangeText={setQuery}
                  placeholder={`Search ${page}`}
                  value={query}
                />
                {page === 'profiles'
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
                        title={profile.label}
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
                                  model.id === draft?.modelId
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
                                providerModelSelections: {
                                  ...draft.providerModelSelections,
                                  [model.providerID]: model.id,
                                },
                              });
                              setPage('summary');
                              setQuery('');
                            }}
                            title={model.label}
                          />
                        ))}
                      </List.Section>
                    ))}
                {(page === 'profiles'
                  ? filteredProfiles.length
                  : filteredModelGroups.length) === 0 ? (
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
                    The Secretary profile is unavailable. Refresh the paired
                    Mac profile catalog before creating a chat.
                  </Text>
                ) : (
                  <>
                    <View style={styles.field}>
                      <Text accessibilityLabel="Profile" variant="labelLarge">
                        Profile
                      </Text>
                      <Button
                        accessibilityLabel={`Profile, ${selectedProfile?.label ?? 'Unassigned'}`}
                        contentStyle={styles.fieldButton}
                        disabled={busy || availableProfiles.length === 0}
                        icon="account-outline"
                        mode="outlined"
                        onPress={() => {
                          setQuery('');
                          setPage('profiles');
                        }}>
                        {selectedProfile?.label ?? 'Unassigned'}
                      </Button>
                    </View>
                    <View style={styles.field}>
                      <Text accessibilityLabel="Model" variant="labelLarge">
                        Model
                      </Text>
                      <Button
                        accessibilityLabel={`Model, ${selectedModelLabel(availableModels, draft.modelId)}`}
                        contentStyle={styles.fieldButton}
                        disabled={busy || modelGroups.length === 0}
                        icon="cube-outline"
                        mode="outlined"
                        onPress={() => {
                          setQuery('');
                          setPage('models');
                        }}>
                        {selectedModelLabel(availableModels, draft.modelId)}
                      </Button>
                    </View>
                    <View style={styles.field}>
                      <Text accessibilityLabel="Reasoning" variant="labelLarge">
                        Reasoning
                      </Text>
                      <SegmentedButtons
                        buttons={REASONING_OPTIONS}
                        density="small"
                        onValueChange={(value) => {
                          void commit({
                            ...draft,
                            reasoning: value as ChatPreferences['reasoning'],
                          });
                        }}
                        value={draft.reasoning}
                      />
                    </View>
                    <View style={styles.field}>
                      <Text
                        accessibilityLabel="Approval Policy"
                        variant="labelLarge">
                        Approval Policy
                      </Text>
                      <Text variant="bodySmall" style={{ color: palette.muted }}>
                        Applies only to this chat. It does not change the global
                        OpenCode auto-approval setting.
                      </Text>
                      <RadioButton.Group
                        onValueChange={(value) => {
                          void commit({
                            ...draft,
                            permissionMode: value as PermissionMode,
                            autoApprove: value === 'bypassPermissions',
                          });
                        }}
                        value={draft.permissionMode}>
                        {APPROVAL_OPTIONS.map((option) => (
                          <RadioButton.Item
                            key={option.value}
                            disabled={busy}
                            label={option.label}
                            value={option.value}
                          />
                        ))}
                      </RadioButton.Group>
                      <Text variant="bodySmall" style={{ color: palette.muted }}>
                        {selectedApproval?.description}
                      </Text>
                    </View>
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
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
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
              disabled={busy || !draft}
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
  content: { gap: 16, paddingHorizontal: 24, paddingVertical: 12 },
  dialog: { maxHeight: '90%' },
  field: { gap: 8 },
  fieldButton: { justifyContent: 'flex-start' },
  scrollArea: { paddingHorizontal: 0 },
});
