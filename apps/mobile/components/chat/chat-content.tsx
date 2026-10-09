import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  FlatList,
  Platform,
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
import { AgentTypingBubble } from '@/components/chat/agent-typing-bubble';
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
  coordinatorStatus?: ReactNode;
  copiedMessageId?: string;
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
  completionSyncStatus?: 'syncing' | 'retry';
  onCopyMessage: (entry: TranscriptEntry) => void;
  onForkMessage: (messageId: string) => void;
  onLoadOlderMessages: () => void;
  onRevertMessage: (messageId: string) => void;
  onUnrevert: () => void;
  onExpandDiff: (id?: string) => void;
  onRefresh: () => void;
  onRetryCompletionSync: () => void;
  onReplyToPermission: (requestId: string, reply: 'once' | 'always' | 'reject') => void;
  onRejectQuestion: (requestId: string) => void;
  onReplyToQuestion: (requestId: string, answers: PendingQuestionAnswer[]) => void;
  onSendStarterPrompt: (prompt: string) => void;
  onToggleSpeak: (entry: TranscriptEntry) => void;
  palette: Palette;
  pendingInteractions: number;
  running: boolean;
  /** A server-primary history without an SDK row is readable but not mutable. */
  readOnlyTranscript?: boolean;
  speakingMessageId?: string;
  status?: SessionStatus;
};

export function ChatContent({
  activeSession,
  activeTab,
  awaitingUserInput,
  connection,
  coordinatorStatus,
  copiedMessageId,
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
  completionSyncStatus,
  onCopyMessage,
  onForkMessage,
  onLoadOlderMessages,
  onRevertMessage,
  onUnrevert,
  onExpandDiff,
  onRefresh,
  onRetryCompletionSync,
  onRejectQuestion,
  onReplyToPermission,
  onReplyToQuestion,
  onSendStarterPrompt,
  onToggleSpeak,
  palette,
  pendingInteractions,
  running,
  readOnlyTranscript = false,
  speakingMessageId,
  status,
}: ChatContentProps) {
  const [todosExpanded, setTodosExpanded] = useState(false);
  const [transcriptPositioned, setTranscriptPositioned] = useState(displayTranscript.length === 0);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const transcriptRef = useRef<FlatList<TranscriptEntry>>(null);
  const transcriptHeightRef = useRef(0);
  const transcriptContentHeightRef = useRef(0);
  const transcriptOffsetRef = useRef(0);
  const prependAnchorRef = useRef<{
    height: number;
    offset: number;
    pendingIds: Set<string>;
    measuredHeights: Map<string, number>;
  } | undefined>(undefined);
  const initialRenderCountRef = useRef(Math.max(20, displayTranscript.length));
  const transcriptNearBottomRef = useRef(true);
  const shouldPositionInitialTranscriptRef = useRef(activeTab === 'session' && displayTranscript.length > 0);
  const suppressEndScrollForPrependRef = useRef(false);
  const previousTranscriptRef = useRef({
    activeTab,
    firstId: displayTranscript[0]?.id,
    lastId: displayTranscript.at(-1)?.id,
    lastText: displayTranscript.at(-1)?.text,
    length: displayTranscript.length,
    sessionId: currentSessionId,
  });
  const completedTodoCount = currentTodos.filter((todo) => todo.status === 'completed').length;
  const transcriptExtraData = useMemo(
    () => [copiedMessageId, speakingMessageId, coordinatorStatus],
    [copiedMessageId, coordinatorStatus, speakingMessageId],
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
      transcriptHeightRef.current = 0;
      transcriptContentHeightRef.current = 0;
      prependAnchorRef.current = undefined;
      initialRenderCountRef.current = Math.max(20, displayTranscript.length);
      setTranscriptPositioned(displayTranscript.length === 0);
      setNewMessageCount(0);
    } else if (suppressEndScrollForPrependRef.current) {
      transcriptNearBottomRef.current = false;
      const previousFirstIndex = displayTranscript.findIndex((entry) => entry.id === previous.firstId);
      prependAnchorRef.current = {
        height: transcriptContentHeightRef.current,
        offset: transcriptOffsetRef.current,
        pendingIds: new Set(displayTranscript.slice(0, previousFirstIndex).map((entry) => entry.id)),
        measuredHeights: new Map(),
      };
    } else if (!transcriptNearBottomRef.current && previous.lastId && (
      previous.lastId !== lastId || previous.lastText !== displayTranscript.at(-1)?.text
    )) {
      const previousLastIndex = displayTranscript.findIndex((entry) => entry.id === previous.lastId);
      const appended = previousLastIndex < 0 ? 0 : displayTranscript.length - previousLastIndex - 1;
      setNewMessageCount((count) => appended > 0 ? count + appended : Math.max(1, count));
    }
    if (!suppressEndScrollForPrependRef.current && (
      activeTab !== previous.activeTab || currentSessionId !== previous.sessionId ||
      firstId !== previous.firstId || lastId !== previous.lastId ||
      displayTranscript.at(-1)?.text !== previous.lastText
    )) {
      prependAnchorRef.current = undefined;
    }
    previousTranscriptRef.current = { activeTab, firstId, lastId, lastText: displayTranscript.at(-1)?.text, length: displayTranscript.length, sessionId: currentSessionId };
  }, [activeTab, currentSessionId, displayTranscript]);

  return (
    <View style={styles.chatArea}>
      {activeTab === 'session' ? (
        <FlatList
          key={currentSessionId || 'no-session'}
          ref={transcriptRef}
          testID="chat-transcript"
          data={displayTranscript}
           // ponytail: measure the already-bounded newest page, not the entire history.
           initialNumToRender={initialRenderCountRef.current}
           style={[styles.scroll, { opacity: transcriptPositioned ? 1 : 0 }]}
           accessibilityElementsHidden={!transcriptPositioned}
           importantForAccessibility={transcriptPositioned ? 'auto' : 'no-hide-descendants'}
           pointerEvents={transcriptPositioned ? 'auto' : 'none'}
          contentContainerStyle={styles.content}
          extraData={transcriptExtraData}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          keyExtractor={(entry) => `${entry.id}-${entry.createdAt}`}
          maintainVisibleContentPosition={{
            minIndexForVisible: 0,
          }}
           onLayout={(event) => {
             transcriptHeightRef.current = event.nativeEvent.layout.height;
             if (!transcriptPositioned || transcriptNearBottomRef.current) {
               transcriptRef.current?.scrollToEnd({ animated: false });
               if (transcriptContentHeightRef.current > 0) {
                 transcriptRef.current?.scrollToOffset({ offset: Math.max(0, transcriptContentHeightRef.current - transcriptHeightRef.current), animated: false });
               }
             }
             if (transcriptContentHeightRef.current > 0 && transcriptContentHeightRef.current <= transcriptHeightRef.current) {
               shouldPositionInitialTranscriptRef.current = false;
               setTranscriptPositioned(true);
             }
           }}
           onContentSizeChange={(_, height) => {
             transcriptContentHeightRef.current = height;
             if (prependAnchorRef.current) {
               // Native maintains keyed visible content; RN web needs the measured prepend delta.
               if (Platform.OS === 'web') {
                 transcriptRef.current?.scrollToOffset({ offset: Math.max(0, prependAnchorRef.current.offset + height - prependAnchorRef.current.height), animated: false });
               }
               // Virtualized rows arrive in stages. Keep the original anchor until
               // every inserted row has laid out and the final size is reported.
               const measuredPrependHeight = [...prependAnchorRef.current.measuredHeights.values()]
                 .reduce((sum, rowHeight) => sum + rowHeight, 0);
               if (prependAnchorRef.current.pendingIds.size === 0 &&
                   height - prependAnchorRef.current.height >= measuredPrependHeight - 2) {
                 prependAnchorRef.current = undefined;
                 suppressEndScrollForPrependRef.current = false;
               }
               return;
            }
            if (
              displayTranscript.length === 0 ||
               (transcriptPositioned && !shouldPositionInitialTranscriptRef.current && !transcriptNearBottomRef.current)
            ) {
              return;
            }
             shouldPositionInitialTranscriptRef.current = false;
             transcriptRef.current?.scrollToEnd({ animated: false });
             if (transcriptHeightRef.current > 0) {
               transcriptRef.current?.scrollToOffset({ offset: Math.max(0, height - transcriptHeightRef.current), animated: false });
             }
             if (transcriptHeightRef.current > 0 && height <= transcriptHeightRef.current) {
               setTranscriptPositioned(true);
             }
          }}
          onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
             const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
             transcriptOffsetRef.current = contentOffset.y;
             transcriptNearBottomRef.current =
               layoutMeasurement.height + contentOffset.y >= contentSize.height - 32;
             if (layoutMeasurement.height > 0 && layoutMeasurement.height + contentOffset.y >= contentSize.height - 1) {
               setTranscriptPositioned(true);
             }
             if (transcriptNearBottomRef.current) setNewMessageCount(0);
          }}
          onScrollBeginDrag={() => { prependAnchorRef.current = undefined; }}
          scrollEventThrottle={16}
          refreshControl={<RefreshControl refreshing={isRefreshingMessages} onRefresh={onRefresh} tintColor={palette.tint} />}
          renderItem={({ item: entry }) => (
            <View
              style={styles.transcriptItem}
              onLayout={(event) => {
                const anchor = prependAnchorRef.current;
                if (!anchor?.pendingIds.has(entry.id)) return;
                anchor.pendingIds.delete(entry.id);
                anchor.measuredHeights.set(entry.id, event.nativeEvent.layout.height);
              }}>
              <TranscriptMessage
                canSpeak={entry.role === 'assistant' && Boolean(entry.text.trim())}
                copied={copiedMessageId === entry.id}
                entry={entry}
                onCopy={() => onCopyMessage(entry)}
                onFork={!readOnlyTranscript && entry.role === 'user' ? () => onForkMessage(entry.id) : undefined}
                onRevert={!readOnlyTranscript && entry.role === 'user' ? () => onRevertMessage(entry.id) : undefined}
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
                <Text style={[styles.emptyDescription, { color: palette.muted }]}>
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
                        <Text style={[styles.promptCardText, { color: palette.text }]}>{prompt}</Text>
                      </View>
                    </TouchableRipple>
                  ))}
                </View>
            </View>
          )}
          ListFooterComponent={(
            <View style={styles.transcriptFooter}>
              {coordinatorStatus}
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

              {running && !awaitingUserInput && pendingInteractions === 0 ? (
                <AgentTypingBubble />
              ) : null}

              {completionSyncStatus ? (
                <View style={styles.loadingRow}>
                  {completionSyncStatus === 'syncing' ? <ActivityIndicator color={palette.muted} size="small" /> : null}
                  <Text style={{ color: palette.muted }}>
                    {completionSyncStatus === 'syncing' ? 'Syncing the completed reply…' : 'The completed reply has not synced yet.'}
                  </Text>
                  {completionSyncStatus === 'retry' ? <Button onPress={onRetryCompletionSync}>Retry sync</Button> : null}
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
      {activeTab === 'session' && newMessageCount > 0 ? (
        <Button
          mode="contained"
          accessibilityLabel={`${newMessageCount} new ${newMessageCount === 1 ? 'message' : 'messages'}. Jump to newest`}
          onPress={() => {
            transcriptNearBottomRef.current = true;
            setNewMessageCount(0);
            transcriptRef.current?.scrollToEnd({ animated: false });
            if (transcriptHeightRef.current > 0) {
              transcriptRef.current?.scrollToOffset({ offset: Math.max(0, transcriptContentHeightRef.current - transcriptHeightRef.current), animated: false });
            }
          }}>
          {`${newMessageCount} new ${newMessageCount === 1 ? 'message' : 'messages'} ↓`}
        </Button>
      ) : null}
    </View>
  );
}
