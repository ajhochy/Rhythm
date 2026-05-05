import 'package:flutter/material.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';

/// A visual section wrapper for the Settings screen.
///
/// Renders a titled card containing [children] — use this for every
/// section on the Settings screen to keep spacing and styling consistent.
class SettingsSection extends StatelessWidget {
  const SettingsSection({
    super.key,
    required this.title,
    required this.children,
  });

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final textTheme = Theme.of(context).textTheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(
            left: RhythmSpacing.md,
            bottom: RhythmSpacing.xs,
          ),
          child: Text(
            title.toUpperCase(),
            style: textTheme.labelSmall?.copyWith(
              color: colors.textMuted,
              letterSpacing: 0.8,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        Container(
          decoration: BoxDecoration(
            color: colors.surface,
            borderRadius: BorderRadius.circular(RhythmRadius.md),
            border: Border.all(color: colors.border),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: _withDividers(children, colors.border),
          ),
        ),
      ],
    );
  }

  /// Inserts a 1 px divider between each child.
  List<Widget> _withDividers(List<Widget> items, Color dividerColor) {
    if (items.isEmpty) return [];
    final result = <Widget>[items.first];
    for (var i = 1; i < items.length; i++) {
      result.add(Divider(height: 1, thickness: 1, color: dividerColor));
      result.add(items[i]);
    }
    return result;
  }
}
