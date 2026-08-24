import 'package:flutter/material.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/settings_controller.dart';

class AutoPromotionSettingsSection extends StatelessWidget {
  const AutoPromotionSettingsSection({
    super.key,
    required this.controller,
  });

  final SettingsController controller;

  Future<void> _change(BuildContext context, bool enabled) async {
    if (enabled) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Enable auto-promotion?'),
          content: const Text(
            'Verified optimizer changes can be promoted automatically. '
            'Only enable this after reviewing the trust requirements.',
          ),
          actions: [
            TextButton(
              key: const Key('auto-promotion-confirm-cancel'),
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              key: const Key('auto-promotion-confirm-enable'),
              autofocus: true,
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('Enable auto-promotion'),
            ),
          ],
        ),
      );
      if (confirmed != true || !context.mounted) return;
    }

    final messenger = ScaffoldMessenger.of(context);
    try {
      await controller.setAutoPromotionEnabled(enabled);
      if (!context.mounted) return;
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            enabled ? 'Auto-promotion enabled.' : 'Auto-promotion disabled.',
          ),
        ),
      );
    } catch (error) {
      if (!context.mounted) return;
      messenger.showSnackBar(
        SnackBar(content: Text('Failed to update auto-promotion: $error')),
      );
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: controller,
        builder: (context, _) => _buildContent(context),
      );

  Widget _buildContent(BuildContext context) {
    final state = controller.autoPromotionState;
    final isLoading =
        controller.autoPromotionStatus == AutoPromotionSettingsStatus.loading;
    final canEnable = state != null &&
        state.availability &&
        state.autoPromotionEligible &&
        state.totalRegressions == 0;
    final canInteract = !isLoading &&
        !controller.isSavingAutoPromotion &&
        state != null &&
        (state.autoPromotionEnabled || canEnable);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'OPTIMIZER',
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: context.rhythm.textSecondary,
            letterSpacing: 0.8,
          ),
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: context.rhythm.surfaceRaised,
            borderRadius: BorderRadius.circular(RhythmRadius.xl),
            border: Border.all(color: context.rhythm.borderSubtle),
            boxShadow: RhythmElevation.panel,
          ),
          child: Material(
            type: MaterialType.transparency,
            child: Semantics(
              container: true,
              label: 'Auto-promotion settings',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (isLoading)
                    const Center(
                      child: Padding(
                        padding: EdgeInsets.all(12),
                        child: CircularProgressIndicator(
                          key: Key('auto-promotion-loading'),
                        ),
                      ),
                    )
                  else if (controller.autoPromotionStatus ==
                      AutoPromotionSettingsStatus.error) ...[
                    Text(
                      controller.autoPromotionErrorMessage ??
                          'Could not load auto-promotion settings.',
                      key: const Key('auto-promotion-error'),
                      style: TextStyle(color: context.rhythm.danger),
                    ),
                    const SizedBox(height: 12),
                    OutlinedButton(
                      key: const Key('auto-promotion-retry'),
                      onPressed: controller.refreshAutoPromotionState,
                      child: const Text('Retry'),
                    ),
                  ] else if (state != null) ...[
                    Semantics(
                      label: 'Auto-promote verified changes',
                      toggled: state.autoPromotionEnabled,
                      child: SwitchListTile(
                        key: const Key('auto-promotion-toggle'),
                        contentPadding: EdgeInsets.zero,
                        title: Text(
                          'Auto-promote verified changes',
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            color: context.rhythm.textPrimary,
                          ),
                        ),
                        subtitle: Text(
                          state.autoPromotionEnabled
                              ? 'Enabled since ${state.enabledAt ?? 'now'}. Disable immediately if you need to stop it.'
                              : 'Requires server availability, current eligibility, and zero regressions.',
                          style: TextStyle(
                            fontSize: 13,
                            color: context.rhythm.textSecondary,
                          ),
                        ),
                        value: state.autoPromotionEnabled,
                        onChanged: canInteract
                            ? (value) => _change(context, value)
                            : null,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      state.availability
                          ? 'Availability: enabled by this server.'
                          : 'Availability: disabled by this server. An existing opt-in can still be disabled in an emergency.',
                      key: const Key('auto-promotion-availability'),
                      style: TextStyle(
                          fontSize: 13, color: context.rhythm.textSecondary),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      state.autoPromotionEligible && state.totalRegressions == 0
                          ? 'Eligibility: verified (${state.totalVerified}/${state.trustThreshold}) with zero regressions.'
                          : 'Eligibility: unavailable until ${state.trustThreshold} verified changes and zero regressions. Current regressions: ${state.totalRegressions}.',
                      key: const Key('auto-promotion-eligibility'),
                      style: TextStyle(
                        fontSize: 13,
                        color: state.autoPromotionEligible &&
                                state.totalRegressions == 0
                            ? context.rhythm.textSecondary
                            : context.rhythm.danger,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}
