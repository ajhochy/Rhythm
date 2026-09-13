import { Keyboard, TextInput, View } from 'react-native';
import { Chip, IconButton, Surface, Text } from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { styles } from '@/components/chat/chat-view-styles';
import type { Command } from '@/lib/opencode/types';
import type { GatewayConnectionStatus } from '@/lib/transport/presence';

type Palette = typeof Colors.light;

type Attachment = { uri: string; mime?: string; filename?: string };

const MIN_INPUT_HEIGHT = 24;
// Six 22-point lines; taller drafts scroll inside the native text view.
const MAX_INPUT_HEIGHT = 132;

type ChatComposerProps = {
  attachments: Attachment[];
  connectionStatus: GatewayConnectionStatus;
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
  const sendDisabled = !hasComposerContent || connectionStatus !== 'connected' || isCreatingSession || isSpeechInputListening;
  const stopDisabled = connectionStatus !== 'connected' || !currentSessionId || isStoppingSession;
  const dictationDisabled = conversation.active || connectionStatus !== 'connected' || (!isSpeechInputListening && !isSpeechInputAvailable);

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
        <View testID="chat-attachment-button">
          <IconButton
            accessibilityLabel="Add attachment"
            accessibilityRole="button"
            icon="plus"
            size={20}
            style={styles.composerPrimaryButton}
            onPress={onAttach}
          />
        </View>
        <View style={[styles.inputShell, styles.inputShellFlex, { borderColor: palette.border, backgroundColor: palette.background }]}>
          <View style={styles.composerRow}>
            <TextInput
               accessibilityLabel="Message"
               testID="chat-prompt-input"
               value={draft}
               onChangeText={onDraftChange}
               editable={!isSpeechInputListening}
               multiline
               scrollEnabled
               placeholder={
                 connectionStatus === 'desktop-offline'
                   ? 'Desktop offline — you can still read sessions'
                   : 'Ask anything...'
               }
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

            <View testID="chat-dictation-button">
              <IconButton
                accessibilityLabel={isSpeechInputListening ? 'Stop dictation' : 'Start dictation'}
                accessibilityRole="button"
                testID="chat-secondary-button"
                icon={isSpeechInputListening ? 'microphone-off' : 'microphone'}
                size={20}
                selected={isSpeechInputListening}
                style={styles.composerVoiceButton}
                disabled={dictationDisabled}
                onPress={onToggleRecording}
              />
            </View>
          </View>
        </View>

        <View testID={showSendAction ? 'chat-send-button' : 'chat-stop-button'}>
          <IconButton
            accessibilityLabel={showSendAction ? 'Send message' : 'Stop response'}
            accessibilityRole="button"
            accessibilityState={{ busy: !showSendAction && isStoppingSession }}
            testID="chat-primary-button"
            mode="contained"
            icon={showSendAction ? 'send' : 'stop'}
            size={20}
            style={styles.composerPrimaryButton}
            containerColor={palette.tint}
            iconColor={palette.surface}
            loading={!showSendAction && isStoppingSession}
            disabled={showSendAction ? sendDisabled : stopDisabled}
            onPress={onSend}
          />
        </View>
      </View>
    </Surface>
  );
}
