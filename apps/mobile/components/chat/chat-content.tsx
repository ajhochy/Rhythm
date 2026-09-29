import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text as NativeText,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { ActivityIndicator, Button, Card, IconButton, Text, TouchableRipple } from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { DiffCard, PendingInteractionsCard, SessionDiffCard, TranscriptMessage } from '@/components/chat/chat-cards';
import type { TranscriptEntry } from '@/lib/opencode/format';
import type { FileDiff, Session, SessionStatus, Todo } from '@/lib/opencode/types';
import type { PendingPermissionRequest, PendingQuestionAnswer, PendingQuestionRequest } from '@/lib/opencode/client';
import type { GatewayConnectionStatus } from '@/lib/transport/presence';

import { styles } from '@/components/chat/chat-view-styles';
import { STARTER_PROMPTS } from '@/components/chat/chat-view-utils';

type Palette = typeof Colors.light;
type DiffDetail = Extract<TranscriptEntry['details'][number], { kind: 'patch' }>;

type ChatContentProps = {
  activeSession?: Session;
  activeTab: 'session' | 'changes';
  awaitingUserInput: boolean;
  connection: { status: GatewayConnectionStatus; message: string };
  copiedMessageId?: string;
  currentActivityLabel?: string;
  currentDiffs: FileDiff[];
  currentPendingPermissions: PendingPermissionRequest[];
  currentPendingQuestions: PendingQuestionRequest[];
  currentTodos: Todo[];
  currentSessionId?: string;
  diffCount: number;
  diffDetails: DiffDetail[];
  displayTranscript: TranscriptEntry[];
  expandedDiffId?: string;
  hasOlderMessages: boolean;
  isRefreshingDiffs: boolean;
  isRefreshingMessages: boolean;
  onCopyMessage: (entry: TranscriptEntry) => void;
  onForkMessage: (messageId: string) => void;
  onLoadOlderMessages: () => void;
  onRevertMessage: (messageId: string) => void;
  onUnrevert: () => void;
  onExpandDiff: (id?: string) => void;
  onRefresh: () => void;
  onReplyToPermission: (requestId: string, reply: 'once' | 'always' | 'reject') => void;
  onRejectQuestion: (requestId: string) => void;
  onReplyToQuestion: (requestId: string, answers: PendingQuestionAnswer[]) => void;
  onSendStarterPrompt: (prompt: string) => void;
  onToggleSpeak: (entry: TranscriptEntry) => void;
  palette: Palette;
  pendingInteractions: number;
  running: boolean;
  speakingMessageId?: string;
  status?: SessionStatus;
};

export function ChatContent({
  activeSession,
  activeTab,
  awaitingUserInput,
  connection,
  copiedMessageId,
  currentActivityLabel,
  currentDiffs,
  currentPendingPermissions,
  currentPendingQuestions,
  currentTodos,
  currentSessionId,
  diffCount,
  diffDetails,
  displayTranscript,
  expandedDiffId,
  hasOlderMessages,
  isRefreshingDiffs,
  isRefreshingMessages,
  onCopyMessage,
  onForkMessage,
  onLoadOlderMessages,
  onRevertMessage,
  onUnrevert,
  onExpandDiff,
  onRefresh,
  onRejectQuestion,
  onReplyToPermission,
  onReplyToQuestion,
  onSendStarterPrompt,
  onToggleSpeak,
  palette,
  pendingInteractions,
  running,
  speakingMessageId,
  status,
}: ChatContentProps) {
  const [todosExpanded, setTodosExpanded] = useState(false);
  const transcriptRef = useRef<FlatList<TranscriptEntry>>(null);
  const transcriptNearBottomRef = useRef(true);
  const shouldPositionInitialTranscriptRef = useRef(activeTab === 'session' && displayTranscript.length > 0);
  const suppressEndScrollForPrependRef = useRef(false);
  const previousTranscriptRef = useRef({
    activeTab,
    firstId: displayTranscript[0]?.id,
    lastId: displayTranscript.at(-1)?.id,
    length: displayTranscript.length,
    sessionId: currentSessionId,
  });
  const completedTodoCount = currentTodos.filter((todo) => todo.status === 'completed').length;
  const transcriptExtraData = useMemo(
    () => [copiedMessageId, speakingMessageId],
    [copiedMessageId, speakingMessageId],
  );

  useLayoutEffect(() => {
    const previous = previousTranscriptRef.current;
    const firstId = displayTranscript[0]?.id;
    const lastId = displayTranscript.at(-1)?.id;
    suppressEndScrollForPrependRef.current = activeTab === 'session' &&
      previous.activeTab === 'session' &&
      previous.sessionId === currentSessionId &&
      previous.length > 0 &&
      displayTranscript.length > previous.length &&
      previous.firstId !== firstId &&
      previous.lastId === lastId;
    if (activeTab === 'session' && (
      previous.activeTab !== 'session' ||
      previous.sessionId !== currentSessionId ||
      (previous.length === 0 && displayTranscript.length > 0)
    )) {
      shouldPositionInitialTranscriptRef.current = true;
      transcriptNearBottomRef.current = true;
    }
    previousTranscriptRef.current = { activeTab, firstId, lastId, length: displayTranscript.length, sessionId: currentSessionId };
  }, [activeTab, currentSessionId, displayTranscript]);

  return (
    <View style={styles.chatArea}>
      {activeTab === 'session' ? (
        <FlatList
          key={currentSessionId || 'no-session'}
          ref={transcriptRef}
          testID="chat-transcript"
          data={displayTranscript}
          style={styles.scroll}
          contentContainerStyle={styles.content}
          extraData={transcriptExtraData}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          keyExtractor={(entry) => `${entry.id}-${entry.createdAt}`}
          maintainVisibleContentPosition={{
            minIndexForVisible: 0,
          }}
          onLayout={() => {
            if (transcriptNearBottomRef.current) {
              transcriptRef.current?.scrollToEnd({ animated: false });
            }
          }}
          onContentSizeChange={() => {
            if (suppressEndScrollForPrependRef.current) {
              suppressEndScrollForPrependRef.current = false;
              return;
            }
            if (
              displayTranscript.length === 0 ||
              (!shouldPositionInitialTranscriptRef.current && !transcriptNearBottomRef.current)
            ) {
              return;
            }
            shouldPositionInitialTranscriptRef.current = false;
            transcriptRef.current?.scrollToEnd({ animated: false });
          }}
          onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            transcriptNearBottomRef.current =
              layoutMeasurement.height + contentOffset.y >= contentSize.height - 32;
          }}
          scrollEventThrottle={16}
          refreshControl={<RefreshControl refreshing={isRefreshingMessages} onRefresh={onRefresh} tintColor={palette.tint} />}
          renderItem={({ item: entry }) => (
            <View style={styles.transcriptItem}>
              <TranscriptMessage
                canSpeak={entry.role === 'assistant' && Boolean(entry.text.trim())}
                copied={copiedMessageId === entry.id}
                entry={entry}
                onCopy={() => onCopyMessage(entry)}
                onFork={entry.role === 'user' ? () => onForkMessage(entry.id) : undefined}
                onRevert={entry.role === 'user' ? () => onRevertMessage(entry.id) : undefined}
                onToggleSpeak={() => onToggleSpeak(entry)}
                speaking={speakingMessageId === entry.id}
              />
            </View>
          )}
          ListHeaderComponent={hasOlderMessages || connection.status === 'error' ? (
            <View style={styles.transcriptHeader}>
              {hasOlderMessages ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={isRefreshingMessages}
                  onPress={onLoadOlderMessages}
                  style={({ pressed }) => [styles.paginationRow, pressed && { opacity: 0.7 }]}>
                  {isRefreshingMessages ? <ActivityIndicator color={palette.muted} size="small" /> : null}
                  <NativeText style={[styles.paginationLabel, { color: palette.muted }]}>Load earlier messages</NativeText>
                </Pressable>
              ) : null}
              {connection.status === 'error' ? (
                <Card mode="contained" style={[styles.noticeCard, { backgroundColor: palette.surface }]}>
                  <Card.Content>
                    <Text variant="titleMedium" style={{ color: palette.text }}>Connection issue</Text>
                    <Text variant="bodyMedium" style={{ color: palette.muted }}>{connection.message}</Text>
                  </Card.Content>
                </Card>
              ) : null}
            </View>
          ) : null}
          ListEmptyComponent={(
            <View style={styles.emptyContent}>
                <Text variant="headlineSmall" style={[styles.emptyTitle, { color: palette.text }]}>Start a new task</Text>
                <Text variant="bodyMedium" style={{ color: palette.muted }}>
                  Keep the prompt specific and OpenCode will inspect the workspace, show progress, and stream back file changes.
                </Text>
                <View style={styles.promptStack}>
                  {STARTER_PROMPTS.map((prompt) => (
                    <TouchableRipple
                      key={prompt}
                      style={[styles.promptCard, { borderColor: palette.border, backgroundColor: palette.background }]}
                      onPress={() => onSendStarterPrompt(prompt)}>
                      <View style={styles.promptCardInner}>
                        <MaterialCommunityIcons name="lightning-bolt" size={18} color={palette.tint} />
                        <Text variant="bodyMedium" style={{ color: palette.text }}>{prompt}</Text>
                      </View>
                    </TouchableRipple>
                  ))}
                </View>
            </View>
          )}
          ListFooterComponent={(
            <View style={styles.transcriptFooter}>
              {pendingInteractions > 0 ? (
                <PendingInteractionsCard
                  permissions={currentPendingPermissions}
                  questions={currentPendingQuestions}
                  onPermissionReply={onReplyToPermission}
                  onQuestionReject={onRejectQuestion}
                  onQuestionReply={onReplyToQuestion}
                />
              ) : null}

              {activeSession?.revert ? (
                <Card mode="contained" style={[styles.noticeCard, { backgroundColor: palette.surface }]}>
                  <Card.Content>
                    <Text variant="titleMedium" style={{ color: palette.text }}>Session is reverted</Text>
                    <Button mode="outlined" onPress={onUnrevert}>Restore reverted work</Button>
                  </Card.Content>
                </Card>
              ) : null}

              {running && !awaitingUserInput ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={palette.muted} size="small" />
                  <Text style={{ color: palette.muted }}>
                    {currentActivityLabel ? `OpenCode is ${currentActivityLabel.toLowerCase()}...` : 'OpenCode is working through the current step...'}
                  </Text>
                </View>
              ) : null}

              {pendingInteractions === 0 && currentTodos.length > 0 && (running || completedTodoCount < currentTodos.length) ? (
                <View style={[styles.todoInline, { borderColor: palette.border }]}>
                  <TouchableRipple
                    accessibilityLabel={todosExpanded ? 'Collapse tasks' : 'Expand tasks'}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: todosExpanded }}
                    onPress={() => setTodosExpanded((expanded) => !expanded)}>
                    <View style={styles.todoHeader}>
                      <Text variant="labelLarge" style={[styles.todoSummary, { color: palette.muted }]}>
                        {`${completedTodoCount} of ${currentTodos.length} tasks completed`}
                      </Text>
                      <MaterialCommunityIcons name={todosExpanded ? 'chevron-up' : 'chevron-down'} size={20} color={palette.muted} />
                    </View>
                  </TouchableRipple>
                  {todosExpanded ? (
                    <View style={styles.todoList}>
                      {currentTodos.map((todo, index) => (
                        <View key={`${todo.content}-${index}`} style={styles.todoItemRow}>
                          <IconButton icon={todo.status === 'completed' ? 'check-circle' : todo.status === 'in_progress' ? 'progress-clock' : 'circle-outline'} size={20} disabled style={styles.todoStatusIcon} />
                          <View style={styles.todoTextWrap}>
                            <Text variant="bodyMedium" style={{ color: palette.text }}>{todo.content || 'Untitled task'}</Text>
                            {todo.priority ? <Text variant="bodySmall" style={{ color: palette.muted }}>{todo.priority}</Text> : null}
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          )}
        />
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={isRefreshingDiffs} onRefresh={onRefresh} tintColor={palette.tint} />}>
          {connection.status === 'error' ? (
            <Card mode="contained" style={[styles.noticeCard, { backgroundColor: palette.surface }]}>
              <Card.Content>
                <Text variant="titleMedium" style={{ color: palette.text }}>Connection issue</Text>
                <Text variant="bodyMedium" style={{ color: palette.muted }}>{connection.message}</Text>
              </Card.Content>
            </Card>
          ) : null}

          <View style={[styles.diffGroup, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.sectionHeaderCard}>
              <View>
                <Text variant="titleMedium" style={{ color: palette.text }}>Latest turn diff</Text>
                <Text variant="bodyMedium" style={{ color: palette.muted }}>
                  {currentDiffs.length > 0
                    ? `${diffCount} files changed, +${currentDiffs.reduce((total, diff) => total + diff.additions, 0)} / -${currentDiffs.reduce((total, diff) => total + diff.deletions, 0)}`
                    : `${diffCount} files changed`}
                </Text>
              </View>
              <Text variant="labelMedium" style={{ color: palette.tint }}>{isRefreshingDiffs ? 'Syncing' : status?.type || 'idle'}</Text>
            </View>
            <Text variant="bodySmall" style={{ color: palette.muted }}>Review scope: changes from the latest turn.</Text>

          {currentDiffs.length === 0 && diffDetails.length === 0 ? (
            <Text variant="bodyMedium" style={{ color: palette.muted }}>No file changes yet.</Text>
          ) : null}

          {currentDiffs.length > 0 || diffDetails.length > 0 ? (
            <View style={styles.diffListCardContent}>
                {currentDiffs.map((diff) => {
                  const accordionId = `diff:${diff.file}`;
                  return <SessionDiffCard key={accordionId} diff={diff} expanded={expandedDiffId === accordionId} onPress={() => onExpandDiff(expandedDiffId === accordionId ? undefined : accordionId)} />;
                })}
                {currentDiffs.length === 0
                  ? diffDetails.map((detail) => {
                      const accordionId = `detail:${detail.id}`;
                      return <DiffCard key={detail.id} detail={detail} expanded={expandedDiffId === accordionId} onPress={() => onExpandDiff(expandedDiffId === accordionId ? undefined : accordionId)} />;
                    })
                  : null}
            </View>
          ) : null}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
