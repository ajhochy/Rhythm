import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/agents/agent_server_controller.dart';
import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../../features/settings/views/settings_view.dart';
import '../controllers/agent_configs_controller.dart';
import '../widgets/agent_card.dart';
import '../widgets/preset_picker.dart';

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
            child: PresetPicker(
              builder: (context, menuController, child) => TextButton.icon(
                onPressed: () => menuController.isOpen
                    ? menuController.close()
                    : menuController.open(),
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
          ),
        ],
      ),
      body: configsController.status == AgentConfigsStatus.loading &&
              configs.isEmpty
          ? Center(
              child: CircularProgressIndicator(color: context.rhythm.accent),
            )
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                // Connect AI account callout card
                _ConnectAccountCard(),
                const SizedBox(height: 16),
                if (configs.isEmpty)
                  const _EmptyState()
                else
                  for (final config in configs) ...[
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: AgentCard(
                        config: config,
                        isAvailable: agentServerController.isAgentAvailable(
                          config.id,
                        ),
                      ),
                    ),
                  ],
              ],
            ),
    );
  }
}

// ---------------------------------------------------------------------------
// Connect account card
// ---------------------------------------------------------------------------

class _ConnectAccountCard extends StatelessWidget {
  const _ConnectAccountCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: context.rhythm.accentMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        border: Border.all(
          color: context.rhythm.accent.withValues(alpha: 0.25),
        ),
      ),
      child: Row(
        children: [
          Icon(Icons.link, size: 18, color: context.rhythm.accent),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Connect an AI Account',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: context.rhythm.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Authorize Claude, Codex, or a free API key to use agent sessions.',
                  style: TextStyle(
                    fontSize: 11,
                    color: context.rhythm.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => const SettingsView(),
                ),
              );
            },
            style: TextButton.styleFrom(
              foregroundColor: context.rhythm.accent,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text('Set up',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

class _EmptyState extends StatelessWidget {
  const _EmptyState();

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
          PresetPicker(
            builder: (context, menuController, child) => FilledButton.icon(
              onPressed: () => menuController.isOpen
                  ? menuController.close()
                  : menuController.open(),
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
                padding:
                    const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.pill),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
