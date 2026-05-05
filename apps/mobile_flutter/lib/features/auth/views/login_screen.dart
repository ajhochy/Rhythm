import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/auth/auth_session_service.dart';
import '../../../app/core/ui/tokens/rhythm_theme.dart';

/// Login screen shown when [AuthSessionService.status] is `unauthenticated`
/// or `signingIn`. Has a single "Continue with Google" button.
class LoginScreen extends StatelessWidget {
  const LoginScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final authService = context.watch<AuthSessionService>();
    final colors = context.rhythm;
    final isSigningIn = authService.status == AuthStatus.signingIn;

    return Scaffold(
      backgroundColor: colors.canvas,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: RhythmSpacing.xl),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Rhythm',
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                        color: colors.accent,
                        fontWeight: FontWeight.w700,
                        fontSize: 36,
                      ),
                ),
                const SizedBox(height: RhythmSpacing.xs),
                Text(
                  'Church staff productivity',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: colors.textSecondary,
                      ),
                ),
                const SizedBox(height: RhythmSpacing.xxl),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed:
                        isSigningIn ? null : authService.signInWithGoogle,
                    icon: isSigningIn
                        ? SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              color: colors.surfaceRaised,
                              strokeWidth: 2,
                            ),
                          )
                        : const Icon(Icons.login),
                    label: Text(
                      isSigningIn ? 'Signing in…' : 'Continue with Google',
                    ),
                    style: FilledButton.styleFrom(
                      backgroundColor: colors.accent,
                      foregroundColor: colors.surfaceRaised,
                      padding: const EdgeInsets.symmetric(
                        vertical: RhythmSpacing.md,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(RhythmRadius.lg),
                      ),
                    ),
                  ),
                ),
                if (authService.errorMessage != null) ...[
                  const SizedBox(height: RhythmSpacing.md),
                  Text(
                    authService.errorMessage!,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: colors.danger,
                        ),
                    textAlign: TextAlign.center,
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
