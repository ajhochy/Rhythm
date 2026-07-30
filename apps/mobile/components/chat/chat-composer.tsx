import { Keyboard, Platform, View } from 'react-native';
import { Chip, IconButton, Surface, Text, TextInput } from 'react-native-paper';
import { useEffect, useState } from 'react';

import { SelectControl } from '@/components/chat/chat-controls';
import { Colors } from '@/constants/theme';
import { styles } from '@/components/chat/chat-view-styles';
import { getModelLabel } from '@/components/chat/chat-view-utils';
import { renderProviderIcon } from '@/components/ui/provider-icon';
import type { Command } from '@/lib/opencode/types';
import type { ModelOption } from '@/providers/opencode-provider';
import type { ModelPickerGroup } from '@/providers/opencode-provider-selectors';

type Palette = typeof Colors.light;

type Attachment = { uri: string; mime?: string; filename?: string };

const MIN_INPUT_HEIGHT = 24;
// Six 22-point lines; taller drafts scroll inside the native text view.
const MAX_INPUT_HEIGHT = 132;

type ChatComposerProps = {
  attachments: Attachment[];
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'error';
  conversation: { active: boolean; isListening: boolean; phase: string; statusLabel?: string };
  draft: string;
  insetsBottom: number;
  isCreatingSession: boolean;
  isSpeechInputAvailable: boolean;
  isSpeechInputListening: boolean;
  isStoppingSession: boolean;
  modelPickerGroups?: ModelPickerGroup[];
  onAttach: () => void;
  onDraftChange: (value: string) => void;
  onModelChange?: (model: ModelOption) => void;
  onRemoveAttachment: (index: number) => void;
  onSend: () => void;
  onToggleRecording: () => void;
  palette: Palette;
  selectedModelId?: string;
  showSendAction: boolean;
  visibleModels?: ModelOption[];
  currentSessionId?: string;
  commands: Command[];
  onCommandSelect: (command: string) => void;
};

export function ChatComposer({
  attachments,
  connectionStatus,
  conversation,
  currentSessionId,
  commands,
  draft,
  insetsBottom,
  isCreatingSession,
  isSpeechInputAvailable,
  isSpeechInputListening,
  isStoppingSession,
  modelPickerGroups = [],
  onAttach,
  onCommandSelect,
  onDraftChange,
  onModelChange,
  onRemoveAttachment,
  onSend,
  onToggleRecording,
  palette,
  selectedModelId,
  showSendAction,
  visibleModels = [],
}: ChatComposerProps) {
  const hasComposerContent = Boolean(draft.trim()) || attachments.length > 0;
  const showOuterAction = showSendAction ? (hasComposerContent ? 'send' : 'attach') : 'stop';
  const outerActionIcon = showOuterAction === 'attach' ? 'plus' : showOuterAction;
  const outerActionDisabled =
    showOuterAction === 'attach'
      ? false
      : showOuterAction === 'send'
        ? ((!draft.trim() && attachments.length === 0) || connectionStatus !== 'connected' || isCreatingSession || isSpeechInputListening)
        : !currentSessionId || isStoppingSession;
  const innerActionIcon = hasComposerContent ? 'paperclip' : (isSpeechInputListening ? 'microphone-off' : 'microphone');
  const innerActionDisabled = hasComposerContent
    ? false
    : conversation.active || connectionStatus !== 'connected' || (!isSpeechInputListening && !isSpeechInputAvailable);
  const handleOuterActionPress = showOuterAction === 'attach' ? onAttach : onSend;
  const handleInnerActionPress = hasComposerContent ? onAttach : onToggleRecording;

  const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT);

  // Keep iOS UIScrollView caret tracking active before a paste crosses the cap;
  // enabling scrolling only after the resize can leave the pasted caret hidden.
  useEffect(() => {
    if (draft.length === 0) {
      setInputHeight(MIN_INPUT_HEIGHT);
    }
  }, [draft]);

  return (
    <Surface
      style={[styles.composer, { backgroundColor: palette.surface, borderTopColor: palette.border, paddingBottom: Math.max(insetsBottom, 12) }]}
      elevation={4}>
      {onModelChange ? (
        <View style={styles.controlsRow}>
          <SelectControl
            disabled={visibleModels.length === 0}
            grow
            icon={(props) =>
              renderProviderIcon(
                visibleModels.find((model) => model.id === selectedModelId)
                  ?.providerID,
                props.size,
                props.color,
              )}
            label={getModelLabel(visibleModels, selectedModelId)}
            onValueChange={(value) => {
              const model = visibleModels.find((item) => item.id === value);
              if (model) {
                onModelChange(model);
              }
            }}
            options={modelPickerGroups.flatMap((group) =>
              group.models.map((model) => ({
                description: [
                  group.accountLabel,
                  model.rankLabel,
                  model.supportsReasoning ? 'Reasoning' : undefined,
                ]
                  .filter(Boolean)
                  .join(' · '),
                label: model.label,
                leadingIcon: (props: {
                  size: number;
                  color: string;
                }) =>
                  renderProviderIcon(
                    model.providerID,
                    props.size,
                    props.color,
                  ),
                sectionLabel:
                  group.accountLabel === group.providerLabel
                    ? group.providerLabel
                    : `${group.providerLabel} — ${group.accountLabel}`,
                value: model.id,
              })),
            )}
            selectedValue={selectedModelId}
            title="Choose model"
          />
        </View>
      ) : null}
      {conversation.active ? (
        <View style={[styles.conversationBanner, { backgroundColor: `${palette.tint}10`, borderColor: `${palette.tint}28` }]}>
          <View style={styles.conversationBannerHeader}>
            <Text variant="labelLarge" style={{ color: palette.text }}>Conversation mode</Text>
            <Chip compact icon={conversation.phase === 'speaking' ? 'volume-high' : 'microphone'}>{conversation.statusLabel || 'Active'}</Chip>
          </View>
          <Text variant="bodySmall" style={{ color: palette.muted }}>
            Keep talking naturally while the app stays open. It listens, sends your turn, reads the reply, and then listens again.
          </Text>
        </View>
      ) : null}

      {attachments.length > 0 ? (
        <View style={styles.attachmentRow}>
          {attachments.map((att, idx) => (
            <View key={`${att.uri}-${idx}`} style={[styles.attachmentChip, { backgroundColor: palette.background }]}>
              <Text numberOfLines={1} variant="labelLarge" style={[styles.attachmentLabel, { color: palette.text }]}>
                {att.filename || att.uri}
              </Text>
              <IconButton
                accessibilityLabel={`Remove ${att.filename || 'attachment'}`}
                icon="close"
                size={18}
                style={styles.attachmentRemoveButton}
                onPress={() => onRemoveAttachment(idx)}
              />
            </View>
          ))}
        </View>
      ) : null}

      {draft.startsWith('/') && !draft.includes(' ') && commands.length > 0 ? (
        <View style={styles.attachmentRow}>
          {commands.filter((command) => command.name.startsWith(draft.slice(1))).slice(0, 6).map((command) => (
            <Chip key={command.name} compact mode="outlined" onPress={() => onCommandSelect(command.name)}>
              /{command.name}
            </Chip>
          ))}
        </View>
      ) : null}

      {isSpeechInputListening || conversation.isListening ? (
        <View style={styles.voiceStatusRow}>
          <Chip compact icon="microphone" style={[styles.voiceStatusChip, { backgroundColor: `${palette.tint}14` }]}>
            {conversation.active ? 'Conversation active' : 'Listening'}
          </Chip>
        </View>
      ) : null}

      <View style={styles.composerDockRow}>
        <View style={[styles.inputShell, styles.inputShellFlex, { borderColor: palette.border, backgroundColor: palette.background }]}>
          <View style={styles.composerRow}>
            <TextInput
               testID="chat-prompt-input"
               mode="flat"
               dense
               value={draft}
               onChangeText={onDraftChange}
               onContentSizeChange={({ nativeEvent }) => {
                 const nextHeight = Math.min(MAX_INPUT_HEIGHT, Math.max(MIN_INPUT_HEIGHT, Math.ceil(nativeEvent.contentSize.height)));
                 setInputHeight((current) => (current === nextHeight ? current : nextHeight));
               }}
               editable={!isSpeechInputListening}
               multiline
               scrollEnabled={Platform.OS === 'ios' || inputHeight >= MAX_INPUT_HEIGHT}
               placeholder="Ask anything..."
               placeholderTextColor={palette.muted}
               style={[styles.input, { height: inputHeight, backgroundColor: 'transparent', color: palette.text }]}
               contentStyle={styles.inputContentCompact}
               underlineColor="transparent"
               activeUnderlineColor="transparent"
               textAlignVertical="top"
             />

            <IconButton
              accessibilityLabel="Dismiss keyboard"
              icon="keyboard-close"
              size={20}
              style={styles.composerDismissButton}
              onPress={Keyboard.dismiss}
            />

            <IconButton
              testID="chat-secondary-button"
              icon={innerActionIcon}
              size={20}
              selected={!hasComposerContent && isSpeechInputListening}
              style={styles.composerVoiceButton}
              disabled={innerActionDisabled}
              onPress={handleInnerActionPress}
            />
          </View>
        </View>

        <IconButton
          testID="chat-primary-button"
          mode="contained"
          icon={outerActionIcon}
          size={20}
          style={styles.composerPrimaryButton}
          containerColor={palette.tint}
          iconColor={palette.surface}
          loading={showOuterAction === 'stop' && isStoppingSession}
          disabled={outerActionDisabled}
          onPress={handleOuterActionPress}
        />
      </View>
    </Surface>
  );
}
