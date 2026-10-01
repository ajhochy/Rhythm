import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Divider, IconButton, List, Menu, Surface, Text, TextInput, TouchableRipple } from 'react-native-paper';

import { MarkdownText } from '@/components/chat/chat-markdown';
import { getDiffPalette, buildPatchDiff, buildCollapsedDiffBlocks } from '@/components/chat/chat-diff';
import { Colors, Fonts, MinimumTouchTarget, Radii, Spacing, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { PendingPermissionRequest, PendingQuestionAnswer, PendingQuestionRequest } from '@/lib/opencode/client';
import { formatTimestamp, type TranscriptDetail, type TranscriptEntry } from '@/lib/opencode/format';
import { summarizeTranscriptDetails } from '@/lib/opencode/transcript';
import type { FileDiff } from '@/lib/opencode/types';

function getPermissionTitle(request: PendingPermissionRequest) {
  const permission = request.permission.toLowerCase();
  if (/(^|[._-])(edit|write|patch)([._-]|$)/.test(permission)) {
    return 'Allow OpenCode to edit files?';
  }
  if (/(^|[._-])(bash|shell|command|exec)([._-]|$)/.test(permission)) {
    return 'Allow OpenCode to run this command?';
  }
  return 'Allow this protected action?';
}

export function PendingInteractionsCard({
  onPermissionReply,
  onQuestionReject,
  onQuestionReply,
  permissions,
  questions,
}: {
  onPermissionReply: (requestId: string, reply: 'once' | 'always' | 'reject') => void;
  onQuestionReject: (requestId: string) => void;
  onQuestionReply: (requestId: string, answers: PendingQuestionAnswer[]) => void;
  permissions: PendingPermissionRequest[];
  questions: PendingQuestionRequest[];
}) {
  return (
    <View style={styles.pendingInteractionsContent}>
      {permissions.map((request) => (
        <PermissionRequestCard
          key={request.id}
          request={request}
          onReply={(reply) => onPermissionReply(request.id, reply)}
        />
      ))}
      {questions.map((request) => (
        <QuestionRequestCard
          key={request.id}
          request={request}
          onReject={() => onQuestionReject(request.id)}
          onReply={(answers) => onQuestionReply(request.id, answers)}
        />
      ))}
    </View>
  );
}

function QuestionRequestCard({
  onReject,
  onReply,
  request,
}: {
  onReject: () => void;
  onReply: (answers: PendingQuestionAnswer[]) => void;
  request: PendingQuestionRequest;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [answers, setAnswers] = useState<string[][]>(() => request.questions.map(() => []));
  const [customAnswers, setCustomAnswers] = useState<string[]>(() => request.questions.map(() => ''));
  const resolvedAnswers = request.questions.map((question, index) => {
    const customAnswer = customAnswers[index].trim();
    if (!customAnswer) {
      return answers[index];
    }
    return question.multiple ? [...answers[index], customAnswer] : [customAnswer];
  });
  const canSubmit = resolvedAnswers.every((answer) => answer.length > 0);

  return (
    <Card mode="contained" style={[styles.requestCard, { backgroundColor: palette.background }]}>
      <Card.Content style={styles.requestCardContent}>
        <Text variant="labelLarge" style={{ color: palette.warning }}>Assistant question</Text>
        {request.questions.map((question, questionIndex) => (
          <View key={`${request.id}-${questionIndex}`} style={styles.questionBlock}>
            <Text variant="titleMedium" style={{ color: palette.text }}>{question.header}</Text>
            <Text variant="bodyMedium" style={{ color: palette.text }}>{question.question}</Text>
            <View style={styles.questionOptions}>
              {question.options.map((option) => {
                const selected = answers[questionIndex].includes(option.label);
                return (
                  <Button
                    accessibilityLabel={option.label}
                    accessibilityRole={question.multiple ? 'checkbox' : 'radio'}
                    accessibilityState={{ checked: selected }}
                    key={option.label}
                    mode={selected ? 'contained-tonal' : 'outlined'}
                    onPress={() => {
                      setAnswers((current) => current.map((answer, index) => {
                        if (index !== questionIndex) return answer;
                        if (!question.multiple) return [option.label];
                        return selected ? answer.filter((label) => label !== option.label) : [...answer, option.label];
                      }));
                      if (!question.multiple) {
                        setCustomAnswers((current) => current.map((answer, index) => index === questionIndex ? '' : answer));
                      }
                    }}
                    style={[styles.questionOption, styles.questionOptionButton]}>
                    {option.label}
                  </Button>
                );
              })}
            </View>
            {question.options.find((option) => answers[questionIndex].includes(option.label))?.description ? (
              <Text variant="bodySmall" style={{ color: palette.muted }}>
                {question.options.find((option) => answers[questionIndex].includes(option.label))?.description}
              </Text>
            ) : null}
            {question.custom !== false ? (
              <TextInput
                dense
                mode="outlined"
                label="Custom answer"
                value={customAnswers[questionIndex]}
                onChangeText={(value) => {
                  setCustomAnswers((current) => current.map((answer, index) => index === questionIndex ? value : answer));
                  if (!question.multiple && value) {
                    setAnswers((current) => current.map((answer, index) => index === questionIndex ? [] : answer));
                  }
                }}
              />
            ) : null}
          </View>
        ))}
        <View style={styles.requestActionsRow}>
          <Button style={styles.requestActionButton} mode="contained" disabled={!canSubmit} onPress={() => onReply(resolvedAnswers)}>Submit answer</Button>
          <Button style={styles.requestActionButton} mode="outlined" textColor={palette.danger} onPress={onReject}>Reject</Button>
        </View>
      </Card.Content>
    </Card>
  );
}

export function SessionDiffCard({ diff, expanded, onPress }: { diff: FileDiff; expanded: boolean; onPress: () => void }) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const diffLines = useMemo(() => (expanded ? buildPatchDiff(diff.patch || '') : []), [diff.patch, expanded]);
  const diffBlocks = useMemo(() => (expanded ? buildCollapsedDiffBlocks(diffLines) : []), [diffLines, expanded]);

  return (
    <List.Accordion
      expanded={expanded}
      onPress={onPress}
      title={diff.file || 'Unknown file'}
      description={`+${diff.additions} / -${diff.deletions}`}
      titleStyle={{ color: palette.text }}
      descriptionStyle={{ color: palette.muted }}
      style={[styles.diffAccordion, { borderColor: palette.border }]}
      theme={{ colors: { background: palette.surface } }}>
      <View style={styles.diffAccordionBody}>
        <Divider style={styles.divider} />
        {expanded ? (
            <View style={styles.diffViewer}>
              {diff.patchOmitted ? <Text variant="bodySmall" style={{ color: palette.muted }}>Patch preview omitted to keep this session responsive; change counts are available.</Text> : diffBlocks.length === 0 ? <Text variant="bodySmall" style={{ color: palette.muted }}>No line changes available.</Text> : diffBlocks.map((block, blockIndex) => {
                if (block.type === 'collapsed') {
                  return (
                    <View key={`${diff.file}-collapsed-${blockIndex}`} style={[styles.diffCollapsedRow, { backgroundColor: palette.background, borderColor: palette.border }]}>
                      <Text variant="bodySmall" style={[styles.code, { color: palette.muted }]}>
                        ... {block.hiddenCount} unchanged line{block.hiddenCount === 1 ? '' : 's'}
                        {block.startLine && block.endLine ? ` (${block.startLine}-${block.endLine})` : ''}
                      </Text>
                    </View>
                  );
                }

                return block.lines.map((line, index) => {
                  const tone = getDiffPalette(line.kind, palette);
                  return (
                    <View
                      key={`${diff.file}-${blockIndex}-${index}-${line.leftNumber ?? 'x'}-${line.rightNumber ?? 'x'}`}
                      style={[
                        styles.diffLineRow,
                        {
                          backgroundColor: tone.backgroundColor,
                          borderLeftColor: tone.accentColor,
                        },
                      ]}>
                      <Text variant="labelSmall" style={[styles.diffLineNumber, { color: palette.muted }]}>
                        {line.leftNumber ?? ''}
                      </Text>
                      <Text variant="labelSmall" style={[styles.diffLineNumber, { color: palette.muted }]}>
                        {line.rightNumber ?? ''}
                      </Text>
                      <Text style={[styles.diffMarker, { color: tone.accentColor || palette.muted }]}>
                        {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}
                      </Text>
                      <Text variant="bodySmall" style={[styles.code, styles.diffLineText, { color: palette.text }]}>
                        {line.text || ' '}
                      </Text>
                    </View>
                  );
                });
              })}
            </View>
        ) : (
          <Text variant="bodySmall" style={{ color: palette.muted }}>Expand to load the diff preview.</Text>
        )}
      </View>
    </List.Accordion>
  );
}

export function DiffCard({ detail, expanded, onPress }: { detail: Extract<TranscriptDetail, { kind: 'patch' }>; expanded: boolean; onPress: () => void }) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <List.Accordion
      expanded={expanded}
      onPress={onPress}
      title={detail.label}
      description="Files changed"
      titleStyle={{ color: palette.text }}
      descriptionStyle={{ color: palette.muted }}
      style={[styles.diffAccordion, { borderColor: palette.border }]}
      theme={{ colors: { background: palette.surface } }}>
      <View style={styles.diffAccordionBody}>
        <Divider style={styles.divider} />
        {expanded ? (
          <Text variant="bodySmall" style={[styles.code, { color: palette.muted }]}>{detail.body}</Text>
        ) : (
          <Text variant="bodySmall" style={{ color: palette.muted }}>Expand to load the patch preview.</Text>
        )}
      </View>
    </List.Accordion>
  );
}

export function TranscriptMessage({
  canSpeak = false,
  copied = false,
  entry,
  onCopy,
  onFork,
  onRevert,
  onToggleSpeak,
  speaking = false,
}: {
  canSpeak?: boolean;
  copied?: boolean;
  entry: TranscriptEntry;
  onCopy: () => void;
  onFork?: () => void;
  onRevert?: () => void;
  onToggleSpeak: () => void;
  speaking?: boolean;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const isUser = entry.role === 'user';
  const detailSummary = summarizeTranscriptDetails(entry.details);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [actionsVisible, setActionsVisible] = useState(false);
  const bubbleColor = isUser ? palette.surface : 'transparent';
  const contentColor = palette.text;

  return (
    <View style={[styles.messageRow, isUser && styles.messageRowUser]}>
      <TouchableRipple borderless={false} rippleColor={`${palette.tint}22`} style={styles.messageTouchable} onLongPress={onCopy}>
        <Surface
          accessibilityLabel={`${isUser ? 'You' : 'OpenCode'} message, ${formatTimestamp(entry.createdAt)}`}
          style={[
            styles.messageBubble,
            isUser ? styles.messageBubbleUser : styles.messageBubbleAssistant,
            {
              backgroundColor: bubbleColor,
              borderColor: copied ? palette.tint : isUser ? palette.border : 'transparent',
            },
            copied ? styles.messageBubbleCopied : null,
          ]}
          elevation={0}>
          {entry.text ? (
            <MarkdownText
              text={entry.text}
              color={contentColor}
              mutedColor={palette.muted}
            />
          ) : null}
          {entry.error ? <Text variant="bodyMedium" style={{ color: palette.danger }}>{entry.error}</Text> : null}
          {!isUser && detailSummary.length > 0 ? (
            <View style={styles.activityBlock}>
              <Divider />
              <TouchableRipple
                accessibilityLabel={`${detailsExpanded ? 'Collapse' : 'Expand'} activity details`}
                accessibilityRole="button"
                accessibilityState={{ expanded: detailsExpanded }}
                hitSlop={{ bottom: 6, left: 6, right: 6, top: 6 }}
                onPress={() => setDetailsExpanded((expanded) => !expanded)}
                style={styles.detailsDisclosure}>
                <View style={styles.detailsDisclosureRow}>
                  <Text numberOfLines={1} variant="bodySmall" style={[styles.detailsDisclosureText, { color: palette.muted }]}>
                    {`Activity · ${detailSummary.join(' · ')}`}
                  </Text>
                  <MaterialCommunityIcons name={detailsExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={palette.muted} />
                </View>
              </TouchableRipple>
              {detailsExpanded ? (
                <View style={styles.summaryRow}>
                  {detailSummary.map((item) => (
                    <Text key={item} variant="bodySmall" style={{ color: palette.muted }}>
                      {item}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
          <View testID="message-actions" style={styles.messageActions}>
            {copied ? (
              <View style={[styles.copiedPill, { backgroundColor: `${palette.tint}18` }]}>
                <MaterialCommunityIcons name="check" size={12} color={palette.tint} />
                <Text variant="labelSmall" style={{ color: palette.tint }}>Copied</Text>
              </View>
            ) : null}
            <Menu
              visible={actionsVisible}
              onDismiss={() => setActionsVisible(false)}
              anchor={(
                <IconButton
                  accessibilityLabel="Message actions"
                  icon="dots-horizontal"
                  size={18}
                  style={styles.messageActionButton}
                  iconColor={palette.muted}
                  onPress={() => setActionsVisible(true)}
                />
              )}>
              <Menu.Item
                accessibilityLabel="Copy message"
                leadingIcon="content-copy"
                title="Copy message"
                onPress={() => {
                  setActionsVisible(false);
                  onCopy();
                }}
              />
              {!isUser && canSpeak ? (
                <Menu.Item
                  accessibilityLabel={speaking ? 'Stop speaking assistant message' : 'Speak assistant message'}
                  leadingIcon={speaking ? 'stop' : 'volume-high'}
                  title={speaking ? 'Stop speaking assistant message' : 'Speak assistant message'}
                  onPress={() => {
                    setActionsVisible(false);
                    onToggleSpeak();
                  }}
                />
              ) : null}
              {isUser && onFork ? (
                <Menu.Item accessibilityLabel="Fork chat from this message" leadingIcon="source-fork" title="Fork chat from this message" onPress={() => { setActionsVisible(false); onFork(); }} />
              ) : null}
              {isUser && onRevert ? (
                <Menu.Item accessibilityLabel="Revert chat to this message" leadingIcon="undo-variant" title="Revert chat to this message" onPress={() => { setActionsVisible(false); onRevert(); }} />
              ) : null}
            </Menu>
          </View>
        </Surface>
      </TouchableRipple>
    </View>
  );
}

function PermissionRequestCard({
  compact = false,
  onReply,
  request,
}: {
  compact?: boolean;
  onReply: (reply: 'once' | 'always' | 'reject') => void;
  request: PendingPermissionRequest;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <Card mode="contained" style={[styles.requestCard, compact && styles.requestCardCompact, { backgroundColor: palette.background }]}>
      <Card.Content style={styles.requestCardContent}>
        <Text variant="labelLarge" style={{ color: palette.warning }}>Permission request</Text>
        <Text variant="titleMedium" style={{ color: palette.text }}>{getPermissionTitle(request)}</Text>
        <Text variant="bodyMedium" style={{ color: palette.muted }}>OpenCode needs your approval before continuing.</Text>
        {request.patterns.length > 0 ? (
          <View style={[styles.permissionTechnicalBlock, { backgroundColor: palette.surface }]}>
            <Text variant="bodySmall" style={[styles.code, { color: palette.muted }]}>{request.patterns.join('\n')}</Text>
          </View>
        ) : null}
        <View style={styles.requestActionsRow}>
          <Button style={styles.requestActionButton} mode="contained" compact onPress={() => onReply('once')}>Allow once</Button>
          <Button style={styles.requestActionButton} mode="outlined" compact onPress={() => onReply('always')}>Always allow</Button>
          <Button style={styles.requestDenyButton} mode="text" compact textColor={palette.danger} onPress={() => onReply('reject')}>Deny</Button>
        </View>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  sectionCard: { borderRadius: Radii.grouped },
  pendingInteractionsContent: { gap: 12 },
  waitingNoticeHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  diffAccordion: { borderWidth: 1, borderRadius: 18 },
  diffAccordionBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  divider: { marginTop: 4 },
  diffViewer: { width: '100%', gap: 2, paddingVertical: Spacing.x1 },
  diffCollapsedRow: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  diffLineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.x2,
    borderLeftWidth: 3,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  diffLineNumber: { width: 32, textAlign: 'right', fontFamily: Fonts.mono, fontSize: TypeScale.meta },
  diffMarker: { width: 12, textAlign: 'center', fontFamily: Fonts.mono, fontSize: TypeScale.meta },
  diffLineText: { flex: 1, flexShrink: 1, minWidth: 0 },
  code: { fontFamily: Fonts.mono, fontSize: TypeScale.meta, lineHeight: 19, flexShrink: 1 },
  messageRow: { alignItems: 'flex-start' },
  messageRowUser: { alignItems: 'flex-end' },
  messageTouchable: { alignSelf: 'stretch', borderRadius: 16 },
  messageBubble: {
    gap: 8,
    flexShrink: 1,
  },
  messageBubbleUser: { alignSelf: 'flex-end', borderRadius: 16, borderWidth: 1, maxWidth: '80%', paddingHorizontal: 12, paddingVertical: 10 },
  messageBubbleAssistant: { alignSelf: 'stretch', backgroundColor: 'transparent', borderRadius: 0, borderWidth: 0, maxWidth: '100%', overflow: 'visible', paddingHorizontal: 0, paddingVertical: 0 },
  messageBubbleCopied: { shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  messageActions: { alignItems: 'center', alignSelf: 'flex-end', flexDirection: 'row', minHeight: MinimumTouchTarget },
  messageActionButton: { height: MinimumTouchTarget, margin: 0, width: MinimumTouchTarget },
  copiedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  activityBlock: { width: '100%' },
  summaryRow: { gap: 4, paddingHorizontal: 4, paddingBottom: 4 },
  detailsDisclosure: { height: 32, width: '100%' },
  detailsDisclosureRow: { alignItems: 'center', flexDirection: 'row', height: 32, paddingHorizontal: 4 },
  detailsDisclosureText: { flex: 1, minWidth: 0 },
  requestCard: { borderRadius: 18 },
  requestCardCompact: { borderRadius: 14 },
  requestCardContent: { gap: 10 },
  requestActionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  requestActionButton: { flexBasis: '48%', flexGrow: 1, minHeight: MinimumTouchTarget },
  requestDenyButton: { flexBasis: '100%', minHeight: MinimumTouchTarget },
  permissionTechnicalBlock: { borderRadius: Radii.control, padding: Spacing.x2 },
  questionBlock: { gap: 8 },
  questionOption: { minHeight: MinimumTouchTarget },
  questionOptionButton: { flexBasis: '100%', minHeight: MinimumTouchTarget },
  questionOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
