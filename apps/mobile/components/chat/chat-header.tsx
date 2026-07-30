import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, ScrollView, Text as NativeText, View } from 'react-native';
import { useState } from 'react';
import { Appbar, Button, Portal, ProgressBar, Text } from 'react-native-paper';

import { SessionConfigurationSheet } from '@/components/chat/session-configuration-sheet';
import { Colors } from '@/constants/theme';
import { getSessionSubtitle } from '@/lib/opencode/format';
import type { Session } from '@/lib/opencode/types';
import { formatEstimatedCost, formatTokenCount, type SessionUsage } from '@/lib/opencode/usage';

import { ConversationOverlay } from '@/components/chat/chat-overlay';
import { styles } from '@/components/chat/chat-view-styles';
import type {
  AgentOption,
  ChatPreferences,
  ConversationPhase,
  ModelOption,
  ProviderOption,
} from '@/providers/opencode-provider';

type Palette = typeof Colors.light;

type ChatHeaderProps = {
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'error';
  availableModels: ModelOption[];
  availableProfiles: AgentOption[];
  availableProviders: ProviderOption[];
  chatPreferences: ChatPreferences;
  conversation: {
    active: boolean;
    latestHeardText?: string;
    phase: ConversationPhase;
  };
  insetsTop: number;
  isCreatingSession: boolean;
  diffCount: number;
  running: boolean;
  showingChanges: boolean;
  onBack: () => void;
  onCloseMenu: () => void;
  onConfirmStopConversation: () => void;
  onCreateSession: () => void;
  onOpenSession: (sessionId: string) => void;
  onOpenSessionMenu: () => void;
  onManage: () => void;
  onOpenSettings: () => void;
  onShowChanges: () => void;
  onToggleConversationMode: () => void;
  onUpdateSessionPreferences: (
    preferences: Partial<ChatPreferences>,
  ) => Promise<ChatPreferences>;
  palette: Palette;
  selectedSession?: Session;
  sessionMenuVisible: boolean;
  sessions: Session[];
  currentSessionId?: string;
  contextLimit?: number;
  contextTokens?: number;
  isUsageLoading: boolean;
  usage: SessionUsage;
};

export function ChatHeader({
  availableModels,
  availableProfiles,
  availableProviders,
  chatPreferences,
  connectionStatus,
  conversation,
  currentSessionId,
  contextLimit,
  contextTokens,
  isUsageLoading,
  insetsTop,
  isCreatingSession,
  diffCount,
  running,
  showingChanges,
  onBack,
  onCloseMenu,
  onConfirmStopConversation,
  onCreateSession,
  onOpenSession,
  onOpenSessionMenu,
  onManage,
  onOpenSettings,
  onShowChanges,
  onToggleConversationMode,
  onUpdateSessionPreferences,
  palette,
  selectedSession,
  sessionMenuVisible,
  sessions,
  usage,
}: ChatHeaderProps) {
  const [usageVisible, setUsageVisible] = useState(false);
  const [actionsVisible, setActionsVisible] = useState(false);
  const connectionLabel = running
    ? 'Running'
    : connectionStatus === 'connected'
      ? 'Connected'
      : connectionStatus === 'connecting'
        ? 'Connecting'
        : connectionStatus === 'error'
          ? 'Connection error'
          : 'Offline';
  const statusLabel = isUsageLoading
    ? `${connectionLabel} · Syncing`
    : connectionLabel;
  const usageLabel = usage.costStatus === 'pricing-unavailable' ? 'Pricing unavailable' : `Estimated API cost ${formatEstimatedCost(usage.cost)}`;
  const contextProgress = contextLimit && contextTokens !== undefined ? Math.min(contextTokens / contextLimit, 1) : undefined;
  const usageIcon = contextProgress === undefined
    ? 'circle-outline'
    : contextProgress <= 0.25
      ? 'circle-slice-1'
      : contextProgress <= 0.5
        ? 'circle-slice-2'
        : contextProgress <= 0.75
          ? 'circle-slice-3'
          : 'circle-slice-4';
  return (
    <>
      <Appbar.Header
        testID="compact-chat-header"
        style={[styles.header, { backgroundColor: palette.surface, paddingTop: insetsTop, height: 64 + insetsTop }]}
        statusBarHeight={0}
        elevated>
        <Appbar.BackAction
          accessibilityLabel="Back to Agents"
          onPress={onBack}
        />
        <View style={styles.headerMain}>
          <Pressable accessibilityLabel="Choose chat" onPress={onOpenSessionMenu} style={({ pressed }) => [styles.headerSessionAnchor, pressed && styles.headerSessionAnchorPressed]}>
            <View style={styles.headerSessionContent}>
              <View style={styles.headerSessionTextWrap}>
                <Text numberOfLines={1} variant="titleMedium" style={[styles.headerTitle, { color: palette.text }]}>
                  {selectedSession?.title || 'Untitled chat'}
                </Text>
                <NativeText accessibilityLabel={`Chat status: ${statusLabel}`} numberOfLines={1} style={[styles.headerUsage, { color: palette.muted }]}>
                  {statusLabel}
                </NativeText>
              </View>
              <MaterialCommunityIcons name="chevron-down" size={20} color={palette.muted} />
            </View>
          </Pressable>
        </View>
        <View style={styles.headerActions}>
          {diffCount > 0 || showingChanges ? (
            <Button
              accessibilityLabel={showingChanges ? 'Session' : `${diffCount} Files Changed`}
              compact
              icon={showingChanges ? 'message-outline' : 'file-document-edit-outline'}
              onPress={onShowChanges}
              style={styles.headerFilesButton}>
              {showingChanges ? 'Session' : `${diffCount} Files Changed`}
            </Button>
          ) : null}
          <Pressable
            accessibilityLabel="Session configuration"
            accessibilityRole="button"
            onPress={() => setActionsVisible(true)}
            style={({ pressed }) => [
              styles.headerAction,
              pressed && styles.headerActionPressed,
            ]}>
            <MaterialCommunityIcons
              name="dots-horizontal"
              size={24}
              color={palette.muted}
            />
          </Pressable>
        </View>
      </Appbar.Header>
      <SessionConfigurationSheet
        availableModels={availableModels}
        availableProfiles={availableProfiles}
        availableProviders={availableProviders}
        mode="edit"
        onDismiss={() => setActionsVisible(false)}
        onPreferencesChange={onUpdateSessionPreferences}
        palette={palette}
        preferences={chatPreferences}
        visible={actionsVisible}>
        <Button
          icon="plus"
          disabled={isCreatingSession || connectionStatus !== 'connected'}
          onPress={() => {
            setActionsVisible(false);
            onCreateSession();
          }}>
          New chat
        </Button>
        <Button
          icon={usageIcon}
          onPress={() => {
            setActionsVisible(false);
            setUsageVisible(true);
          }}>
          Usage
        </Button>
        <Button
          icon={conversation.active ? 'phone-hangup' : 'headset'}
          disabled={connectionStatus !== 'connected' || isCreatingSession}
          onPress={() => {
            setActionsVisible(false);
            onToggleConversationMode();
          }}>
          {conversation.active ? 'Stop conversation' : 'Conversation mode'}
        </Button>
        <Button
          testID="chat-session-tools-toggle"
          icon="wrench-outline"
          onPress={() => {
            setActionsVisible(false);
            onManage();
          }}>
          Manage
        </Button>
        <Button
          icon="cog-outline"
          onPress={() => {
            setActionsVisible(false);
            onOpenSettings();
          }}>
          Settings
        </Button>
      </SessionConfigurationSheet>
      <Portal>
        {sessionMenuVisible ? (
          <View style={styles.sessionPickerOverlay}>
            <Pressable accessibilityLabel="Close chat picker" onPress={onCloseMenu} style={styles.sessionPickerBackdrop}>
              <View style={styles.sessionPickerBackdropFill} />
            </Pressable>
            <View
              style={[
                styles.sessionPickerSheet,
                {
                  top: 64 + insetsTop,
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                },
              ]}
            >
              <View style={[styles.sessionPickerHeader, { borderBottomColor: palette.border }]}>
                <Text variant="titleMedium" style={{ color: palette.text }}>Chats</Text>
                <Pressable accessibilityLabel="Close chat picker" onPress={onCloseMenu} style={({ pressed }) => [styles.sessionPickerCloseButton, pressed && styles.sessionPickerCloseButtonPressed]}>
                  <NativeText style={[styles.sessionPickerCloseLabel, { color: palette.tint }]}>Close</NativeText>
                </Pressable>
              </View>
              <ScrollView contentContainerStyle={styles.sessionPickerList} keyboardShouldPersistTaps="handled">
                {sessions.length === 0 ? <Text variant="bodyMedium" style={{ color: palette.muted }}>No chats yet.</Text> : null}
                {sessions.map((session) => {
                  const isSelected = session.id === currentSessionId;

                  return (
                    <Pressable
                      key={session.id}
                      onPress={() => onOpenSession(session.id)}
                      style={({ pressed }) => [
                        styles.sessionPickerItem,
                        {
                          backgroundColor: isSelected ? palette.background : 'transparent',
                          borderColor: isSelected ? palette.tint : palette.border,
                          opacity: pressed ? 0.82 : 1,
                        },
                      ]}>
                      <View style={styles.sessionPickerItemRow}>
                        <View style={[styles.sessionPickerItemIcon, { backgroundColor: `${(isSelected ? palette.tint : palette.muted)}14` }]}>
                          <MaterialCommunityIcons name={isSelected ? 'check-circle' : 'message-outline'} size={18} color={isSelected ? palette.tint : palette.muted} />
                        </View>
                        <View style={styles.sessionPickerItemTextWrap}>
                          <NativeText style={[styles.sessionPickerItemTitle, { color: palette.text, fontWeight: isSelected ? '700' : '600' }]}>
                            {session.title || 'Untitled chat'}
                          </NativeText>
                          <NativeText style={[styles.sessionPickerItemSubtitle, { color: palette.muted }]}>
                            {getSessionSubtitle(session)}
                          </NativeText>
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        ) : null}
        {conversation.active ? (
          <ConversationOverlay
            connectionStatus={connectionStatus}
            insetsTop={insetsTop}
            latestUserText={conversation.latestHeardText}
            onStop={onConfirmStopConversation}
            phase={conversation.phase}
            sessionTitle={selectedSession?.title || 'Untitled chat'}
          />
        ) : null}
        {usageVisible ? (
          <View style={styles.sessionPickerOverlay}>
            <Pressable accessibilityLabel="Close session usage" onPress={() => setUsageVisible(false)} style={styles.sessionPickerBackdrop}><View style={styles.sessionPickerBackdropFill} /></Pressable>
            <View style={[styles.sessionPickerSheet, { top: 64 + insetsTop, backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={[styles.sessionPickerHeader, { borderBottomColor: palette.border }]}>
                <View>
                  <Text variant="titleMedium" style={{ color: palette.text }}>Session usage</Text>
                  <Text accessibilityLabel={usageLabel} variant="bodySmall" style={{ color: palette.muted }}>{usageLabel}</Text>
                </View>
                <Pressable accessibilityLabel="Close session usage" onPress={() => setUsageVisible(false)} style={styles.sessionPickerCloseButton}><NativeText style={[styles.sessionPickerCloseLabel, { color: palette.tint }]}>Close</NativeText></Pressable>
              </View>
              <ScrollView contentContainerStyle={styles.sessionPickerList}>
                <View style={[styles.usageProvider, { borderColor: palette.border }]}>
                  <View style={styles.usageRow}><Text variant="titleSmall" style={{ color: palette.text }}>Context utilization</Text><Text accessibilityLabel={contextProgress === undefined ? 'Context utilization unavailable' : `${Math.round(contextProgress * 100)} percent context utilization`} variant="titleSmall" style={{ color: palette.text }}>{contextProgress === undefined ? 'Unavailable' : `${Math.round(contextProgress * 100)}%`}</Text></View>
                  {contextProgress === undefined ? <Text variant="bodySmall" style={{ color: palette.muted }}>OpenCode did not provide a context limit for this model.</Text> : <><ProgressBar progress={contextProgress} color={palette.tint} style={styles.contextProgress} /><Text variant="bodySmall" style={{ color: palette.muted }}>{`${formatTokenCount(contextTokens || 0)} of ${formatTokenCount(contextLimit || 0)} input tokens`}</Text></>}
                </View>
                {usage.completedSteps === 0 ? <Text variant="bodyMedium" style={{ color: palette.muted }}>No completed inference steps yet.</Text> : null}
                {usage.providers.map((provider) => (
                  <View key={provider.providerId} style={[styles.usageProvider, { borderColor: palette.border }]}>
                    <View style={styles.usageRow}><Text variant="titleSmall" style={{ color: palette.text }}>{provider.providerId}</Text><Text variant="titleSmall" style={{ color: palette.text }}>{provider.models.some((model) => model.costStatus === 'pricing-unavailable') ? 'Pricing unavailable' : formatEstimatedCost(provider.cost)}</Text></View>
                    {provider.models.map((model) => (
                      <View key={model.modelId} style={styles.usageModel}>
                        <View style={styles.usageRow}><Text variant="bodyMedium" style={{ color: palette.text }}>{model.modelId}</Text><Text accessibilityLabel={`${model.modelId} cost ${model.costStatus === 'pricing-unavailable' ? 'pricing unavailable' : formatEstimatedCost(model.cost)}`} variant="bodyMedium" style={{ color: palette.text }}>{model.costStatus === 'pricing-unavailable' ? 'Included or unpriced' : formatEstimatedCost(model.cost)}</Text></View>
                        <Text accessibilityLabel={`${formatTokenCount(model.inputTokens)} input tokens, ${formatTokenCount(model.outputTokens)} output tokens, ${formatTokenCount(model.reasoningTokens)} reasoning tokens, ${formatTokenCount(model.cacheReadTokens)} cache read tokens, ${formatTokenCount(model.cacheWriteTokens)} cache write tokens, ${model.completedSteps} completed steps`} variant="bodySmall" style={{ color: palette.muted }}>
                          {`${formatTokenCount(model.inputTokens)} in  ${formatTokenCount(model.outputTokens)} out  ${formatTokenCount(model.reasoningTokens)} reasoning  ${formatTokenCount(model.cacheReadTokens)} cache read  ${formatTokenCount(model.cacheWriteTokens)} cache write  ${model.completedSteps} steps`}
                        </Text>
                      </View>
                    ))}
                  </View>
                ))}
              </ScrollView>
            </View>
          </View>
        ) : null}
      </Portal>
    </>
  );
}
