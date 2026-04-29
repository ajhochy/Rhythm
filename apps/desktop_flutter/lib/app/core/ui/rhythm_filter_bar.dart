import 'package:flutter/material.dart';

import 'rhythm_search_field.dart';
import 'rhythm_segmented_control.dart';
import 'tokens/rhythm_theme.dart';

class RhythmFilterBar<T> extends StatelessWidget {
  const RhythmFilterBar({
    super.key,
    this.searchController,
    this.onSearchChanged,
    this.searchHint = 'Search',
    this.segments = const [],
    this.segmentValue,
    this.onSegmentChanged,
    this.filters = const [],
    this.actions = const [],
  });

  final TextEditingController? searchController;
  final ValueChanged<String>? onSearchChanged;
  final String searchHint;
  final List<RhythmSegment<T>> segments;
  final T? segmentValue;
  final ValueChanged<T>? onSegmentChanged;
  final List<Widget> filters;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surface,
        border: Border(bottom: BorderSide(color: colors.borderSubtle)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(RhythmSpacing.sm),
        child: Wrap(
          spacing: RhythmSpacing.sm,
          runSpacing: RhythmSpacing.xs,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            if (searchController != null && onSearchChanged != null)
              RhythmSearchField(
                controller: searchController!,
                onChanged: onSearchChanged!,
                hintText: searchHint,
                width: 240,
              ),
            if (segments.isNotEmpty &&
                segmentValue != null &&
                onSegmentChanged != null)
              RhythmSegmentedControl<T>(
                segments: segments,
                value: segmentValue as T,
                onChanged: onSegmentChanged!,
                compact: true,
              ),
            ...filters,
            ...actions,
          ],
        ),
      ),
    );
  }
}
