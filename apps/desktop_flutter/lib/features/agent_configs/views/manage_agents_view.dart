import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/agents/agent_server_controller.dart';
import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/agent_configs_controller.dart';
import '../widgets/agent_card.dart';

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
                      child: AgentCard(
                        config: config,
                        isAvailable: agentServerController.isAgentAvailable(
                          config.id,
                        ),
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
