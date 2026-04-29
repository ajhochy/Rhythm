import 'package:flutter/material.dart';

import '../../app/core/formatters/date_formatters.dart';

class RhythmDateButton extends StatelessWidget {
  const RhythmDateButton({
    super.key,
    required this.date,
    required this.onTap,
    this.onClear,
    this.placeholder = 'Set date',
  });

  final String? date;
  final VoidCallback onTap;
  final VoidCallback? onClear;
  final String placeholder;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        OutlinedButton.icon(
          onPressed: onTap,
          icon: const Icon(Icons.calendar_today, size: 16),
          label: Text(
            DateFormatters.fullDate(date, fallback: date ?? placeholder),
          ),
        ),
        if (onClear != null && date != null) ...[
          const SizedBox(width: 8),
          TextButton(
            onPressed: onClear,
            child: const Text('Clear'),
          ),
        ],
      ],
    );
  }
}
