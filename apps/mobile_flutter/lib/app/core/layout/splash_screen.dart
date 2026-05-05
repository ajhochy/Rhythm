import 'package:flutter/material.dart';

import '../ui/tokens/rhythm_theme.dart';

/// Shown while [AuthSessionService] is in the `checking` state.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return Scaffold(
      backgroundColor: colors.canvas,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Rhythm',
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    color: colors.accent,
                    fontWeight: FontWeight.w700,
                    fontSize: 32,
                  ),
            ),
            const SizedBox(height: 24),
            CircularProgressIndicator(
              color: colors.accent,
              strokeWidth: 2.5,
            ),
          ],
        ),
      ),
    );
  }
}
