import { Keyboard, TextInput, View } from 'react-native';
import { Chip, IconButton, Surface, Text } from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { styles } from '@/components/chat/chat-view-styles';
import type { Command } from '@/lib/opencode/types';

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
  onAttach: () => void;
  onDraftChange: (value: string) => void;
  onRemoveAttachment: (index: number) => void;
  onSend: () => void;
  onToggleRecording: () => void;
  palette: Palette;
  showSendAction: boolean;
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
  onAttach,
  onCommandSelect,
  onDraftChange,
  onRemoveAttachment,
  onSend,
  onToggleRecording,
  palette,
  showSendAction,
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

  return (
    <Surface
      style={[styles.composer, { backgroundColor: palette.surface, borderTopColor: palette.border, paddingBottom: Math.max(insetsBottom, 12) }]}
      elevation={4}>
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
               value={draft}
               onChangeText={onDraftChange}
               editable={!isSpeechInputListening}
               multiline
               scrollEnabled
               placeholder="Ask anything..."
               placeholderTextColor={palette.muted}
               style={[
                 styles.input,
                 styles.inputContentCompact,
                 {
                   backgroundColor: 'transparent',
                   color: palette.text,
                   minHeight: MIN_INPUT_HEIGHT,
                   maxHeight: MAX_INPUT_HEIGHT,
                 },
               ]}
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
