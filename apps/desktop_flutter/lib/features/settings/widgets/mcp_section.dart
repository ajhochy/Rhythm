import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/mcp_controller.dart';
import '../data/mcp_data_source.dart';

/// OPC-M4-3 — MCP server management section for SettingsView.
///
/// Lists connected/disconnected/failed MCP servers, shows an "Add" dialog
/// to register new servers, and exposes per-server connect/disconnect/remove
/// actions.
///
/// Reads from [McpController] via [Provider] — wire [McpController] in
/// main.dart's MultiProvider before mounting this widget.
class McpSection extends StatefulWidget {
  const McpSection({super.key});

  @override
  State<McpSection> createState() => _McpSectionState();
}

class _McpSectionState extends State<McpSection> {
  @override
  void initState() {
    super.initState();
    // Kick off initial load once the widget is mounted.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      context.read<McpController>().refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
    final ctrl = context.watch<McpController>();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // ── Section header ─────────────────────────────────────────────────
        Row(
          children: [
            Expanded(
              child: Text(
                'MCP SERVERS',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: context.rhythm.textSecondary,
                  letterSpacing: 0.8,
                ),
              ),
            ),
            IconButton(
              key: const Key('mcp-add-button'),
              icon: const Icon(Icons.add_circle_outline, size: 18),
              tooltip: 'Add MCP server',
              onPressed: () => _showAddDialog(context, ctrl),
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(),
              color: context.rhythm.accent,
            ),
          ],
        ),
        const SizedBox(height: 12),

        // ── Server list card ───────────────────────────────────────────────
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: context.rhythm.surfaceRaised,
            borderRadius: BorderRadius.circular(RhythmRadius.xl),
            border: Border.all(color: context.rhythm.borderSubtle),
            boxShadow: RhythmElevation.panel,
          ),
          child: _buildBody(context, ctrl),
        ),
      ],
    );
  }

  Widget _buildBody(BuildContext context, McpController ctrl) {
    if (ctrl.status == McpControllerStatus.loading && ctrl.servers.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.symmetric(vertical: 12),
          child: CircularProgressIndicator(),
        ),
      );
    }

    if (ctrl.status == McpControllerStatus.error && ctrl.servers.isEmpty) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            ctrl.errorMessage ?? 'Failed to load MCP servers.',
            style: TextStyle(fontSize: 13, color: context.rhythm.danger),
          ),
          const SizedBox(height: 12),
          OutlinedButton(
            onPressed: () => context.read<McpController>().refresh(),
            child: const Text('Retry'),
          ),
        ],
      );
    }

    if (ctrl.servers.isEmpty) {
      return Text(
        'No MCP servers configured. Tap + to add one.',
        style: TextStyle(fontSize: 13, color: context.rhythm.textSecondary),
      );
    }

    return Column(
      children: [
        for (final server in ctrl.servers)
          _McpServerRow(
            server: server,
            inlineError: ctrl.errorFor(server.name),
          ),
      ],
    );
  }

  Future<void> _showAddDialog(
    BuildContext context,
    McpController ctrl,
  ) async {
    await showDialog<void>(
      context: context,
      builder: (dialogCtx) => _AddMcpServerDialog(ctrl: ctrl),
    );
  }
}

// ---------------------------------------------------------------------------
// Individual server row
// ---------------------------------------------------------------------------

class _McpServerRow extends StatelessWidget {
  const _McpServerRow({
    required this.server,
    this.inlineError,
  });

  final McpServerEntry server;
  final String? inlineError;

  @override
  Widget build(BuildContext context) {
    final ctrl = context.read<McpController>();
    final isConnected = server.status == 'connected';
    final isFailed = server.status == 'failed';

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              // Status badge
              _StatusBadge(
                key: Key('mcp-badge-${server.name}'),
                status: server.status,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  server.name,
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    color: context.rhythm.textPrimary,
                  ),
                ),
              ),
              // Connect / Disconnect
              if (!isFailed)
                TextButton(
                  onPressed: isConnected
                      ? () => ctrl.disconnectServer(server.name)
                      : () => ctrl.connectServer(server.name),
                  child: Text(isConnected ? 'Disconnect' : 'Connect'),
                ),
              // Remove
              IconButton(
                icon: Icon(
                  Icons.delete_outline,
                  size: 18,
                  color: context.rhythm.textSecondary,
                ),
                tooltip: 'Remove',
                onPressed: () => ctrl.removeServer(server.name),
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
            ],
          ),
          // Error from server.error (e.g. status == 'failed')
          if (server.error != null) ...[
            const SizedBox(height: 4),
            Text(
              server.error!,
              style: TextStyle(fontSize: 12, color: context.rhythm.danger),
            ),
          ],
          // Per-server inline error from controller
          if (inlineError != null) ...[
            const SizedBox(height: 4),
            Text(
              inlineError!,
              style: TextStyle(fontSize: 12, color: context.rhythm.danger),
            ),
          ],
        ],
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({super.key, required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final color = switch (status) {
      'connected' => context.rhythm.success,
      'disconnected' => context.rhythm.textMuted,
      _ => context.rhythm.danger,
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        status,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: color,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Add MCP server dialog
// ---------------------------------------------------------------------------

class _AddMcpServerDialog extends StatefulWidget {
  const _AddMcpServerDialog({required this.ctrl});

  final McpController ctrl;

  @override
  State<_AddMcpServerDialog> createState() => _AddMcpServerDialogState();
}

class _AddMcpServerDialogState extends State<_AddMcpServerDialog> {
  final _nameController = TextEditingController();
  final _commandController = TextEditingController();
  final _urlController = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _submitting = false;
  String? _submitError;

  @override
  void dispose() {
    _nameController.dispose();
    _commandController.dispose();
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    final name = _nameController.text.trim();
    final command = _commandController.text.trim();
    final url = _urlController.text.trim();

    if (command.isEmpty && url.isEmpty) {
      _formKey.currentState?.validate();
      return;
    }

    setState(() {
      _submitting = true;
      _submitError = null;
    });

    try {
      await widget.ctrl.addServer(
        name: name,
        command: command.isEmpty ? null : command,
        url: url.isEmpty ? null : url,
      );
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) {
        setState(() {
          _submitting = false;
          _submitError = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Add MCP Server'),
      content: SizedBox(
        width: 400,
        child: Form(
          key: _formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextFormField(
                key: const Key('mcp-dialog-name-field'),
                controller: _nameController,
                autofocus: true,
                decoration: const InputDecoration(
                  labelText: 'Server name *',
                  hintText: 'e.g. rhythm-mcp',
                  isDense: true,
                ),
                validator: (value) {
                  if (value == null || value.trim().isEmpty) {
                    return 'Name is required';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _commandController,
                decoration: const InputDecoration(
                  labelText: 'Command (local server)',
                  hintText: 'e.g. npx -y @my/mcp-server',
                  isDense: true,
                ),
                validator: (value) {
                  final cmd = value?.trim() ?? '';
                  final url = _urlController.text.trim();
                  if (cmd.isEmpty && url.isEmpty) {
                    return 'Provide either a command or a URL';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 8),
              Text(
                'or',
                style: TextStyle(
                  fontSize: 12,
                  color: context.rhythm.textSecondary,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              TextFormField(
                controller: _urlController,
                decoration: const InputDecoration(
                  labelText: 'URL (remote server)',
                  hintText: 'https://my-mcp-server.example.com/mcp',
                  isDense: true,
                ),
                keyboardType: TextInputType.url,
                validator: (value) {
                  final url = value?.trim() ?? '';
                  final cmd = _commandController.text.trim();
                  if (url.isEmpty && cmd.isEmpty) {
                    return 'Provide either a command or a URL';
                  }
                  return null;
                },
              ),
              if (_submitError != null) ...[
                const SizedBox(height: 12),
                Text(
                  _submitError!,
                  style: TextStyle(fontSize: 12, color: context.rhythm.danger),
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _submitting ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          key: const Key('mcp-dialog-add-confirm'),
          onPressed: _submitting ? null : _submit,
          child: _submitting
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                )
              : const Text('Add'),
        ),
      ],
    );
  }
}
