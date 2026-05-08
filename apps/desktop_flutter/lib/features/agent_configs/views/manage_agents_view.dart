import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/agents/agent_server_controller.dart';
import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/agent_configs_controller.dart';
import '../models/agent_config.dart';
import '../widgets/agent_icon.dart';

class ManageAgentsView extends StatefulWidget {
  const ManageAgentsView({super.key});

  @override
  State<ManageAgentsView> createState() => _ManageAgentsViewState();
}

class _ManageAgentsViewState extends State<ManageAgentsView> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AgentConfigsController>().refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
    final configsController = context.watch<AgentConfigsController>();
    final agentServerController = context.watch<AgentServerController>();
    final configs = configsController.configs;

    return Scaffold(
      backgroundColor: context.rhythm.canvas,
      appBar: AppBar(
        backgroundColor: context.rhythm.surfaceRaised,
        elevation: 0,
        surfaceTintColor: context.rhythm.surfaceRaised,
        leading: const BackButton(),
        iconTheme: IconThemeData(color: context.rhythm.textPrimary),
        title: Text(
          'Manage CLI Agents',
          style: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w700,
            color: context.rhythm.textPrimary,
          ),
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Divider(height: 1, color: context.rhythm.border),
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: TextButton.icon(
              onPressed: () {
                // Placeholder for #494
              },
              icon: Icon(Icons.add, size: 16, color: context.rhythm.accent),
              label: Text(
                'Add agent',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: context.rhythm.accent,
                ),
              ),
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.md),
                ),
              ),
            ),
          ),
        ],
      ),
      body: configsController.status == AgentConfigsStatus.loading &&
              configs.isEmpty
          ? Center(
              child: CircularProgressIndicator(color: context.rhythm.accent),
            )
          : configs.isEmpty
              ? _EmptyState(
                  onAddAgent: () {
                    // Placeholder for #494
                  },
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(20),
                  itemCount: configs.length,
                  itemBuilder: (context, index) {
                    final config = configs[index];
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: _AgentConfigCard(
                        config: config,
                        isAvailable: agentServerController.isAgentAvailable(
                          config.id,
                        ),
                        onToggle: (enabled) => context
                            .read<AgentConfigsController>()
                            .update(config.id, {'enabled': enabled}),
                      ),
                    );
                  },
                ),
    );
  }
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onAddAgent});

  final VoidCallback onAddAgent;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.smart_toy_outlined,
            size: 48,
            color: context.rhythm.textMuted,
          ),
          const SizedBox(height: 16),
          Text(
            'No agents configured',
            style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w700,
              color: context.rhythm.textPrimary,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Add a CLI agent to get started.',
            style: TextStyle(fontSize: 13, color: context.rhythm.textSecondary),
          ),
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: onAddAgent,
            icon: const Icon(Icons.add, size: 16, color: Colors.white),
            label: const Text(
              'Add agent',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: Colors.white,
              ),
            ),
            style: FilledButton.styleFrom(
              backgroundColor: context.rhythm.accent,
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.pill),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Agent config card
// ---------------------------------------------------------------------------

class _AgentConfigCard extends StatelessWidget {
  const _AgentConfigCard({
    required this.config,
    required this.isAvailable,
    required this.onToggle,
  });

  final AgentConfig config;
  final bool isAvailable;
  final ValueChanged<bool> onToggle;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceRaised,
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        border: Border.all(color: context.rhythm.border),
        boxShadow: RhythmElevation.panel,
      ),
      child: Row(
        children: [
          // Icon
          AgentIcon(config.icon, size: 36, fallbackLabel: config.label),
          const SizedBox(width: 14),
          // Label + command
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        config.label,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: context.rhythm.textPrimary,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 8),
                    _StatusBadge(isAvailable: isAvailable),
                  ],
                ),
                if (config.command.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    config.command,
                    style: TextStyle(
                      fontSize: 12,
                      fontFamily: 'Menlo',
                      color: context.rhythm.textMuted,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: 12),
          // Enabled toggle
          Switch(
            value: config.enabled,
            onChanged: onToggle,
            activeThumbColor: context.rhythm.accent,
            activeTrackColor: context.rhythm.accentMuted,
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.isAvailable});

  final bool isAvailable;

  @override
  Widget build(BuildContext context) {
    const configuredColor = Color(0xFF10B981);
    final needsSetupColor = context.rhythm.warning;

    final label = isAvailable ? 'Configured' : 'Needs setup';
    final bgColor = isAvailable
        ? configuredColor.withValues(alpha: 0.12)
        : needsSetupColor.withValues(alpha: 0.12);
    final textColor = isAvailable ? configuredColor : needsSetupColor;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(RhythmRadius.pill),
        border: Border.all(color: textColor.withValues(alpha: 0.25)),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: textColor,
        ),
      ),
    );
  }
}
