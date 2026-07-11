import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../../app/core/utils/time_format.dart';
import '../controllers/agent_webhooks_controller.dart';
import '../models/agent_webhook_endpoint.dart';

class AgentWebhooksView extends StatefulWidget {
  const AgentWebhooksView({super.key});

  @override
  State<AgentWebhooksView> createState() => _AgentWebhooksViewState();
}

class _AgentWebhooksViewState extends State<AgentWebhooksView> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AgentWebhooksController>().refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<AgentWebhooksController>(
      builder: (context, controller, _) {
        return Scaffold(
          backgroundColor: context.rhythm.canvas,
          appBar: AppBar(
            backgroundColor: context.rhythm.surface,
            elevation: 0,
            title: Text(
              'Webhook Endpoints',
              style: TextStyle(
                color: context.rhythm.textPrimary,
                fontWeight: FontWeight.w700,
                fontSize: 17,
              ),
            ),
            iconTheme: IconThemeData(color: context.rhythm.textSecondary),
            bottom: PreferredSize(
              preferredSize: const Size.fromHeight(1),
              child: Divider(
                height: 1,
                thickness: 1,
                color: context.rhythm.border,
              ),
            ),
          ),
          floatingActionButton: FloatingActionButton(
            backgroundColor: context.rhythm.accent,
            foregroundColor: Colors.white,
            tooltip: 'New webhook',
            onPressed: () => _showNewWebhookSheet(context, controller),
            child: const Icon(Icons.add),
          ),
          body: _buildBody(context, controller),
        );
      },
    );
  }

  Widget _buildBody(BuildContext context, AgentWebhooksController controller) {
    if (controller.status == AgentWebhooksStatus.loading &&
        controller.endpoints.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (controller.status == AgentWebhooksStatus.error &&
        controller.error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, color: context.rhythm.danger, size: 40),
            const SizedBox(height: 12),
            Text(
              controller.error!,
              style: TextStyle(color: context.rhythm.textSecondary),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: controller.refresh,
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    if (controller.endpoints.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.webhook_outlined,
              size: 56,
              color: context.rhythm.textMuted,
            ),
            const SizedBox(height: 16),
            Text(
              'No webhooks yet',
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w600,
                color: context.rhythm.textSecondary,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Tap + to create your first webhook endpoint.',
              style: TextStyle(fontSize: 14, color: context.rhythm.textMuted),
            ),
          ],
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
      itemCount: controller.endpoints.length,
      separatorBuilder: (_, __) =>
          Divider(height: 1, color: context.rhythm.borderSubtle),
      itemBuilder: (context, index) {
        final endpoint = controller.endpoints[index];
        return _WebhookTile(
          endpoint: endpoint,
          onDelete: () => _confirmDelete(context, controller, endpoint),
        );
      },
    );
  }

  Future<void> _showNewWebhookSheet(
    BuildContext context,
    AgentWebhooksController controller,
  ) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: context.rhythm.surface,
      shape: RoundedRectangleBorder(
        borderRadius: const BorderRadius.vertical(
          top: Radius.circular(RhythmRadius.xl),
        ),
        side: BorderSide(color: context.rhythm.border),
      ),
      builder: (sheetCtx) => ChangeNotifierProvider.value(
        value: controller,
        child: const _NewWebhookSheet(),
      ),
    );
  }

  Future<void> _confirmDelete(
    BuildContext context,
    AgentWebhooksController controller,
    AgentWebhookEndpoint endpoint,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogCtx) => AlertDialog(
        backgroundColor: context.rhythm.surfaceRaised,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(RhythmRadius.lg),
          side: BorderSide(color: context.rhythm.border),
        ),
        title: Text(
          'Delete webhook?',
          style: TextStyle(
            color: context.rhythm.textPrimary,
            fontWeight: FontWeight.w700,
          ),
        ),
        content: Text(
          'Deleting "${endpoint.name}" will immediately revoke its receive URL. This cannot be undone.',
          style: TextStyle(color: context.rhythm.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogCtx, false),
            child: Text(
              'Cancel',
              style: TextStyle(color: context.rhythm.textSecondary),
            ),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: context.rhythm.danger,
            ),
            onPressed: () => Navigator.pop(dialogCtx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirmed == true && mounted) {
      await controller.delete(endpoint.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Tile
// ---------------------------------------------------------------------------

class _WebhookTile extends StatelessWidget {
  const _WebhookTile({required this.endpoint, required this.onDelete});

  final AgentWebhookEndpoint endpoint;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final url = endpoint.receiveUrl;
    final truncatedUrl = url.length > 52 ? '${url.substring(0, 49)}…' : url;
    final lastTriggered = endpoint.lastTriggeredAt != null
        ? _formatStamp(endpoint.lastTriggeredAt!)
        : 'Never';

    return InkWell(
      onLongPress: onDelete,
      borderRadius: BorderRadius.circular(RhythmRadius.sm),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: endpoint.enabled
                    ? context.rhythm.accentMuted
                    : context.rhythm.surfaceMuted,
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
              ),
              child: Icon(
                Icons.webhook,
                size: 18,
                color: endpoint.enabled
                    ? context.rhythm.accent
                    : context.rhythm.textMuted,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          endpoint.name,
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            color: context.rhythm.textPrimary,
                            fontSize: 14,
                          ),
                        ),
                      ),
                      if (!endpoint.enabled)
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: context.rhythm.surfaceMuted,
                            borderRadius: BorderRadius.circular(
                              RhythmRadius.pill,
                            ),
                            border: Border.all(color: context.rhythm.border),
                          ),
                          child: Text(
                            'Disabled',
                            style: TextStyle(
                              fontSize: 11,
                              color: context.rhythm.textMuted,
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    truncatedUrl,
                    style: TextStyle(
                      fontSize: 12,
                      color: context.rhythm.textMuted,
                      fontFamily: 'monospace',
                    ),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Icon(
                        Icons.bolt_outlined,
                        size: 12,
                        color: context.rhythm.textMuted,
                      ),
                      const SizedBox(width: 3),
                      Text(
                        '${endpoint.triggerCount} triggers',
                        style: TextStyle(
                          fontSize: 12,
                          color: context.rhythm.textMuted,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Icon(
                        Icons.access_time,
                        size: 12,
                        color: context.rhythm.textMuted,
                      ),
                      const SizedBox(width: 3),
                      Text(
                        lastTriggered,
                        style: TextStyle(
                          fontSize: 12,
                          color: context.rhythm.textMuted,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            IconButton(
              icon: Icon(
                Icons.copy_outlined,
                size: 18,
                color: context.rhythm.textSecondary,
              ),
              tooltip: 'Copy receive URL',
              onPressed: () {
                Clipboard.setData(ClipboardData(text: url));
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: const Text('Receive URL copied'),
                    backgroundColor: context.rhythm.success,
                    behavior: SnackBarBehavior.floating,
                    duration: const Duration(seconds: 2),
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// New Webhook Bottom Sheet
// ---------------------------------------------------------------------------

class _NewWebhookSheet extends StatefulWidget {
  const _NewWebhookSheet();

  @override
  State<_NewWebhookSheet> createState() => _NewWebhookSheetState();
}

class _NewWebhookSheetState extends State<_NewWebhookSheet> {
  final _nameController = TextEditingController();
  final _promptController = TextEditingController();
  bool _enabled = true;
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _nameController.dispose();
    _promptController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Name is required.');
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });

    final controller = context.read<AgentWebhooksController>();
    final created = await controller.create({
      'name': name,
      'eventTypesJson': '[]',
      if (_promptController.text.trim().isNotEmpty)
        'targetPrompt': _promptController.text.trim(),
      'enabled': _enabled,
    });

    if (!mounted) return;
    setState(() => _loading = false);

    if (created == null) {
      setState(() => _error = controller.error ?? 'Failed to create webhook.');
      return;
    }

    Navigator.of(context).pop();
    _showSuccessSheet(context, created.receiveUrl);
  }

  void _showSuccessSheet(BuildContext context, String receiveUrl) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: context.rhythm.surface,
      shape: RoundedRectangleBorder(
        borderRadius: const BorderRadius.vertical(
          top: Radius.circular(RhythmRadius.xl),
        ),
        side: BorderSide(color: context.rhythm.border),
      ),
      builder: (sheetCtx) => _SuccessSheet(receiveUrl: receiveUrl),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 24,
        right: 24,
        top: 24,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'New Webhook',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: context.rhythm.textPrimary,
                  ),
                ),
              ),
              IconButton(
                icon: Icon(
                  Icons.close,
                  size: 18,
                  color: context.rhythm.textMuted,
                ),
                onPressed: () => Navigator.of(context).pop(),
              ),
            ],
          ),
          const SizedBox(height: 20),
          TextField(
            controller: _nameController,
            autofocus: true,
            style: TextStyle(color: context.rhythm.textPrimary),
            decoration: InputDecoration(
              labelText: 'Name',
              hintText: 'e.g. GitHub Push Handler',
              labelStyle: TextStyle(color: context.rhythm.textSecondary),
              hintStyle: TextStyle(color: context.rhythm.textMuted),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
                borderSide: BorderSide(color: context.rhythm.border),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
                borderSide: BorderSide(
                  color: context.rhythm.accent,
                  width: 1.5,
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _promptController,
            minLines: 3,
            maxLines: 6,
            style: TextStyle(color: context.rhythm.textPrimary),
            decoration: InputDecoration(
              labelText: 'Target prompt (optional)',
              hintText: 'Instructions for the agent when this webhook fires…',
              alignLabelWithHint: true,
              labelStyle: TextStyle(color: context.rhythm.textSecondary),
              hintStyle: TextStyle(color: context.rhythm.textMuted),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
                borderSide: BorderSide(color: context.rhythm.border),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
                borderSide: BorderSide(
                  color: context.rhythm.accent,
                  width: 1.5,
                ),
              ),
            ),
          ),
          const SizedBox(height: 12),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(
              'Enabled',
              style: TextStyle(color: context.rhythm.textPrimary),
            ),
            subtitle: Text(
              'Webhook will accept incoming requests immediately.',
              style: TextStyle(color: context.rhythm.textMuted, fontSize: 12),
            ),
            value: _enabled,
            activeThumbColor: context.rhythm.accent,
            onChanged: (v) => setState(() => _enabled = v),
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(
              _error!,
              style: TextStyle(color: context.rhythm.danger, fontSize: 13),
            ),
          ],
          const SizedBox(height: 20),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: context.rhythm.accent,
              minimumSize: const Size.fromHeight(48),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
              ),
            ),
            onPressed: _loading ? null : _submit,
            child: _loading
                ? SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white.withValues(alpha: 0.8),
                    ),
                  )
                : const Text('Create'),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Success Sheet
// ---------------------------------------------------------------------------

class _SuccessSheet extends StatelessWidget {
  const _SuccessSheet({required this.receiveUrl});

  final String receiveUrl;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 24, 24, 40),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: context.rhythm.success.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(RhythmRadius.sm),
                ),
                child: Icon(
                  Icons.check_circle_outline,
                  color: context.rhythm.success,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  'Webhook created!',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: context.rhythm.textPrimary,
                  ),
                ),
              ),
              IconButton(
                icon: Icon(
                  Icons.close,
                  size: 18,
                  color: context.rhythm.textMuted,
                ),
                onPressed: () => Navigator.of(context).pop(),
              ),
            ],
          ),
          const SizedBox(height: 20),
          Text(
            'Receive URL',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: context.rhythm.textSecondary,
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: context.rhythm.surfaceMuted,
              borderRadius: BorderRadius.circular(RhythmRadius.sm),
              border: Border.all(color: context.rhythm.border),
            ),
            child: SelectableText(
              receiveUrl,
              style: TextStyle(
                fontSize: 13,
                fontFamily: 'monospace',
                color: context.rhythm.textPrimary,
              ),
            ),
          ),
          const SizedBox(height: 12),
          Text(
            'Send POST requests to this URL to trigger the agent. '
            'Keep this URL private — it includes your webhook secret.',
            style: TextStyle(fontSize: 13, color: context.rhythm.textMuted),
          ),
          const SizedBox(height: 20),
          FilledButton.icon(
            style: FilledButton.styleFrom(
              backgroundColor: context.rhythm.accent,
              minimumSize: const Size.fromHeight(48),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
              ),
            ),
            icon: const Icon(Icons.copy_outlined, size: 18),
            label: const Text('Copy receive URL'),
            onPressed: () {
              Clipboard.setData(ClipboardData(text: receiveUrl));
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: const Text('Receive URL copied to clipboard'),
                  backgroundColor: context.rhythm.success,
                  behavior: SnackBarBehavior.floating,
                  duration: const Duration(seconds: 2),
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

String _formatStamp(String value) {
  return formatLocalTimestamp(value);
}
