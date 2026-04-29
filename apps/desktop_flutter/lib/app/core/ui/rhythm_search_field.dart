import 'package:flutter/material.dart';

import 'tokens/rhythm_theme.dart';

class RhythmSearchField extends StatelessWidget {
  const RhythmSearchField({
    super.key,
    required this.controller,
    required this.onChanged,
    this.hintText = 'Search',
    this.onSubmitted,
    this.width,
  });

  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final ValueChanged<String>? onSubmitted;
  final String hintText;
  final double? width;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final field = ValueListenableBuilder<TextEditingValue>(
      valueListenable: controller,
      builder: (context, value, _) {
        return TextField(
          controller: controller,
          onChanged: onChanged,
          onSubmitted: onSubmitted,
          style: TextStyle(color: colors.textPrimary),
          decoration: InputDecoration(
            hintText: hintText,
            hintStyle: TextStyle(color: colors.textMuted),
            prefixIcon: Icon(Icons.search, size: 17, color: colors.textMuted),
            suffixIcon: value.text.isEmpty
                ? null
                : IconButton(
                    tooltip: 'Clear search',
                    icon: const Icon(Icons.close, size: 16),
                    onPressed: () {
                      controller.clear();
                      onChanged('');
                    },
                  ),
            isDense: true,
            filled: true,
            fillColor: colors.surfaceMuted,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: RhythmSpacing.sm,
              vertical: 10,
            ),
            border: _border(colors.borderSubtle),
            enabledBorder: _border(colors.borderSubtle),
            focusedBorder: _border(colors.focusRing, width: 1.5),
          ),
        );
      },
    );

    if (width == null) return field;
    return SizedBox(width: width, child: field);
  }

  OutlineInputBorder _border(Color color, {double width = 1}) {
    return OutlineInputBorder(
      borderRadius: BorderRadius.circular(RhythmRadius.md),
      borderSide: BorderSide(color: color, width: width),
    );
  }
}
