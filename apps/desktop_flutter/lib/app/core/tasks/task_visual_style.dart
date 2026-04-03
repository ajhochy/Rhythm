import 'package:flutter/material.dart';

import '../../../features/tasks/models/task.dart';
import '../formatters/date_formatters.dart';
import '../../theme/rhythm_tokens.dart';

class TaskVisualStyle {
  const TaskVisualStyle({
    required this.accent,
    required this.background,
    required this.border,
    required this.badgeBackground,
    required this.text,
    required this.mutedText,
  });

  final Color accent;
  final Color background;
  final Color border;
  final Color badgeBackground;
  final Color text;
  final Color mutedText;
}

class TaskVisualStyles {
  static TaskVisualStyle resolve(Task task, {DateTime? today}) {
    final isDone = task.status == 'done';
    final isPastDue = DateFormatters.isPastDue(
      dueDate: task.dueDate,
      scheduledDate: task.scheduledDate,
      isDone: isDone,
      today: today,
    );
    final isDueToday = DateFormatters.isDueToday(
      dueDate: task.dueDate,
      scheduledDate: task.scheduledDate,
      isDone: isDone,
      today: today,
    );

    if (isDone) {
      return const TaskVisualStyle(
        accent: Color(0xFF94A3B8),
        background: Color(0xFFF7F4EE),
        border: Color(0xFFE8E2D7),
        badgeBackground: Color(0xFFEDE7DC),
        text: RhythmTokens.textMuted,
        mutedText: RhythmTokens.textMuted,
      );
    }

    if (isPastDue) {
      return const TaskVisualStyle(
        accent: Color(0xFFDC5B58),
        background: Color(0xFFFFECEA),
        border: Color(0xFFEDB1AD),
        badgeBackground: Color(0xFFF7D2CE),
        text: RhythmTokens.textPrimary,
        mutedText: Color(0xFFA84A47),
      );
    }

    if (isDueToday) {
      return const TaskVisualStyle(
        accent: Color(0xFFE29A3A),
        background: Color(0xFFFFF4E5),
        border: Color(0xFFEABF78),
        badgeBackground: Color(0xFFF5DDB0),
        text: RhythmTokens.textPrimary,
        mutedText: Color(0xFF9B6B24),
      );
    }

    final variantKey = task.sourceName?.trim().isNotEmpty == true
        ? task.sourceName!.trim()
        : task.sourceId?.trim().isNotEmpty == true
            ? task.sourceId!.trim()
            : task.title;

    return switch (task.sourceType) {
      'calendar_shadow_event' => const TaskVisualStyle(
          accent: Color(0xFFE29A3A),
          background: Color(0xFFFFF2DE),
          border: Color(0xFFE9BC6E),
          badgeBackground: Color(0xFFF6DCAB),
          text: RhythmTokens.textPrimary,
          mutedText: Color(0xFF9B6B24),
        ),
      'recurring_rule' => _variant(
          _rhythmVariants,
          variantKey,
        ),
      'project_step' => _variant(
          _projectVariants,
          variantKey,
        ),
      'automation_rule' => _variant(
          _automationVariants,
          variantKey,
        ),
      'planning_center_signal' => _variant(
          _planningCenterVariants,
          variantKey,
        ),
      _ => const TaskVisualStyle(
          accent: Color(0xFF64748B),
          background: Color(0xFFFFFEFC),
          border: Color(0xFFE5DED1),
          badgeBackground: Color(0xFFF3EEE6),
          text: RhythmTokens.textPrimary,
          mutedText: RhythmTokens.textSecondary,
        ),
    };
  }

  static TaskVisualStyle _variant(
    List<TaskVisualStyle> styles,
    String key,
  ) {
    final index =
        key.runes.fold<int>(0, (sum, rune) => sum + rune) % styles.length;
    return styles[index];
  }
}

const _rhythmVariants = <TaskVisualStyle>[
  TaskVisualStyle(
    accent: Color(0xFF4E5FE0),
    background: Color(0xFFEDF1FF),
    border: Color(0xFFBFC9FA),
    badgeBackground: Color(0xFFD9E0FD),
    text: RhythmTokens.textPrimary,
    mutedText: Color(0xFF4656BF),
  ),
  TaskVisualStyle(
    accent: Color(0xFF6F56CF),
    background: Color(0xFFF3EEFF),
    border: Color(0xFFD3C5F4),
    badgeBackground: Color(0xFFE5DBFA),
    text: RhythmTokens.textPrimary,
    mutedText: Color(0xFF5C46B2),
  ),
  TaskVisualStyle(
    accent: Color(0xFF3D82C8),
    background: Color(0xFFEBF5FE),
    border: Color(0xFFBDD8F0),
    badgeBackground: Color(0xFFD8E9F8),
    text: RhythmTokens.textPrimary,
    mutedText: Color(0xFF346FA8),
  ),
];

const _projectVariants = <TaskVisualStyle>[
  TaskVisualStyle(
    accent: Color(0xFF2E7FC4),
    background: Color(0xFFEAF5FD),
    border: Color(0xFFB8D6ED),
    badgeBackground: Color(0xFFD3E8F7),
    text: RhythmTokens.textPrimary,
    mutedText: Color(0xFF286CA7),
  ),
  TaskVisualStyle(
    accent: Color(0xFF1E9A8C),
    background: Color(0xFFEAF9F6),
    border: Color(0xFFB6E3DB),
    badgeBackground: Color(0xFFCEEEE7),
    text: RhythmTokens.textPrimary,
    mutedText: Color(0xFF1F7B71),
  ),
  TaskVisualStyle(
    accent: Color(0xFF4867C5),
    background: Color(0xFFEEF3FD),
    border: Color(0xFFC7D3F1),
    badgeBackground: Color(0xFFDCE4F9),
    text: RhythmTokens.textPrimary,
    mutedText: Color(0xFF415BA8),
  ),
];

const _automationVariants = <TaskVisualStyle>[
  TaskVisualStyle(
    accent: Color(0xFF0D9B87),
    background: Color(0xFFE8FAF6),
    border: Color(0xFFAFE3D9),
    badgeBackground: Color(0xFFCBEFE8),
    text: RhythmTokens.textPrimary,
    mutedText: Color(0xFF11796C),
  ),
  TaskVisualStyle(
    accent: Color(0xFF149AB4),
    background: Color(0xFFE9F8FC),
    border: Color(0xFFB7E2EC),
    badgeBackground: Color(0xFFD0EDF4),
    text: RhythmTokens.textPrimary,
    mutedText: Color(0xFF167C90),
  ),
];

const _planningCenterVariants = <TaskVisualStyle>[
  TaskVisualStyle(
    accent: Color(0xFFC1602A),
    background: Color(0xFFFBF0E9),
    border: Color(0xFFE1B99F),
    badgeBackground: Color(0xFFEFD4C3),
    text: RhythmTokens.textPrimary,
    mutedText: Color(0xFF9A4E24),
  ),
  TaskVisualStyle(
    accent: Color(0xFFB06F1D),
    background: Color(0xFFFBF3E6),
    border: Color(0xFFE0C79F),
    badgeBackground: Color(0xFFEBDAB8),
    text: RhythmTokens.textPrimary,
    mutedText: Color(0xFF8D5A18),
  ),
];
