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

        // ── Rhythm install status ──────────────────────────────────────────
        if (ctrl.servers.any((s) => s.name == 'rhythm')) ...[
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Row(
              children: [
                Icon(
                  Icons.check_circle,
                  size: 16,
                  color: context.rhythm.success,
                ),
                const SizedBox(width: 8),
                Text(
                  'Rhythm tools: installed in opencode',
                  key: const ValueKey('rhythm-mcp-installed'),
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: context.rhythm.success,
                  ),
                ),
              ],
            ),
          ),
        ],

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

/// MCP-4: opens a FOCUSED credentials dialog that asks only for the curated
/// server's required key(s) — one obscured field per [McpServerEntry.requiredEnv]
/// entry, no command field. Submitting POSTs the keys via
/// [McpController.setCredentials] and refreshes so the row flips to connected.
///
/// Guard: if the server reports no required keys (shouldn't happen for a
/// key-based server), fall back to the generic Add dialog so we never present
/// an empty form.
Future<void> _showCredentialsDialog(
  BuildContext context,
  McpController ctrl,
  McpServerEntry server,
) async {
  if (server.requiredEnv.isEmpty) {
    await showDialog<void>(
      context: context,
      builder: (dialogCtx) =>
          _AddMcpServerDialog(ctrl: ctrl, initialName: server.name),
    );
    return;
  }
  await showDialog<void>(
    context: context,
    builder: (dialogCtx) => _McpCredentialsDialog(
      ctrl: ctrl,
      serverName: server.name,
      requiredEnv: server.requiredEnv,
    ),
  );
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

    // MCP-4: a remote server the SDK reports as needs_auth shows a distinct
    // "Sign-in required" badge; a curated key-based server missing required env
    // shows a tappable "Needs credentials" badge. Both signals come straight
    // from the GET response (status / needsCredentials) — the UI never
    // recomputes credential logic.
    final needsSignIn = server.status == 'needs_auth';
    final needsCredentials = server.needsCredentials && !needsSignIn;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              // Status badge — variant depends on credential/auth signals.
              if (needsCredentials)
                _NeedsCredentialsBadge(
                  key: Key('mcp-needs-credentials-${server.name}'),
                  onTap: () => _showCredentialsDialog(context, ctrl, server),
                )
              else if (needsSignIn)
                _SignInRequiredBadge(
                  key: Key('mcp-needs-signin-${server.name}'),
                )
              else
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

/// MCP-4: warning badge for a curated key-based server that is installed but
/// missing required credentials. Visually distinct (warning/orange) and
/// tappable — tapping opens the secrets dialog pre-filled with the server name.
class _NeedsCredentialsBadge extends StatelessWidget {
  const _NeedsCredentialsBadge({super.key, required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = context.rhythm.warning;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(4),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.14),
          borderRadius: BorderRadius.circular(4),
          border: Border.all(color: color.withValues(alpha: 0.5)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.key_outlined, size: 12, color: color),
            const SizedBox(width: 4),
            Text(
              'Needs credentials',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: color,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// MCP-4: badge for a remote server the SDK reports as `needs_auth`. Distinct
/// from "Needs credentials" — sign-in is an OAuth flow, not a typed secret.
class _SignInRequiredBadge extends StatelessWidget {
  const _SignInRequiredBadge({super.key});

  @override
  Widget build(BuildContext context) {
    final color = context.rhythm.accent;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.login, size: 12, color: color),
          const SizedBox(width: 4),
          Text(
            'Sign-in required',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Add MCP server dialog
// ---------------------------------------------------------------------------

class _AddMcpServerDialog extends StatefulWidget {
  const _AddMcpServerDialog({required this.ctrl, this.initialName});

  final McpController ctrl;

  /// MCP-4: when opened from a "Needs credentials" affordance, pre-fill the
  /// server name so the user only has to supply the missing secret.
  final String? initialName;

  @override
  State<_AddMcpServerDialog> createState() => _AddMcpServerDialogState();
}

class _AddMcpServerDialogState extends State<_AddMcpServerDialog> {
  late final TextEditingController _nameController =
      TextEditingController(text: widget.initialName ?? '');
  final _commandController = TextEditingController();
  final _urlController = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _submitting = false;
  String? _submitError;

  /// MCP-3: dynamic key/value rows for per-server env secrets. Each row owns a
  /// key controller + a value controller; empty rows are ignored on submit.
  final List<_EnvRow> _envRows = [];

  @override
  void dispose() {
    _nameController.dispose();
    _commandController.dispose();
    _urlController.dispose();
    for (final row in _envRows) {
      row.dispose();
    }
    super.dispose();
  }

  void _addEnvRow() {
    setState(() => _envRows.add(_EnvRow()));
  }

  void _removeEnvRow(_EnvRow row) {
    setState(() {
      _envRows.remove(row);
      row.dispose();
    });
  }

  /// Builds a `Map<String,String>` from the non-empty env rows (trimmed keys).
  Map<String, String> _collectEnvironment() {
    final env = <String, String>{};
    for (final row in _envRows) {
      final key = row.keyController.text.trim();
      if (key.isEmpty) continue;
      env[key] = row.valueController.text;
    }
    return env;
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

    final environment = _collectEnvironment();

    try {
      await widget.ctrl.addServer(
        name: name,
        command: command.isEmpty ? null : command,
        url: url.isEmpty ? null : url,
        environment: environment.isEmpty ? null : environment,
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
              const SizedBox(height: 16),
              // ── MCP-3: per-server env secrets editor ──────────────────────
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Environment secrets',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: context.rhythm.textSecondary,
                      ),
                    ),
                  ),
                  IconButton(
                    key: const Key('mcp-dialog-env-add'),
                    icon: const Icon(Icons.add, size: 18),
                    tooltip: 'Add secret',
                    onPressed: _submitting ? null : _addEnvRow,
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                    color: context.rhythm.accent,
                  ),
                ],
              ),
              for (final row in _envRows) ...[
                const SizedBox(height: 8),
                Row(
                  key: row.rowKey,
                  children: [
                    Expanded(
                      child: TextFormField(
                        controller: row.keyController,
                        decoration: const InputDecoration(
                          labelText: 'Key',
                          hintText: 'e.g. API_KEY',
                          isDense: true,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextFormField(
                        controller: row.valueController,
                        decoration: const InputDecoration(
                          labelText: 'Value',
                          isDense: true,
                        ),
                      ),
                    ),
                    IconButton(
                      icon: Icon(
                        Icons.remove_circle_outline,
                        size: 18,
                        color: context.rhythm.textSecondary,
                      ),
                      tooltip: 'Remove secret',
                      onPressed: _submitting ? null : () => _removeEnvRow(row),
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(),
                    ),
                  ],
                ),
              ],
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

/// MCP-3: holds the controllers and a stable key for one env-secret row in the
/// Add-MCP dialog. A stable [rowKey] keeps Flutter from reusing TextFields
/// across rows when one is removed.
class _EnvRow {
  _EnvRow()
      : keyController = TextEditingController(),
        valueController = TextEditingController(),
        rowKey = UniqueKey();

  final TextEditingController keyController;
  final TextEditingController valueController;
  final Key rowKey;

  void dispose() {
    keyController.dispose();
    valueController.dispose();
  }
}

// ---------------------------------------------------------------------------
// Focused credentials dialog (curated key-based servers — stripe/mailchimp)
// ---------------------------------------------------------------------------

/// MCP-4: a focused "Enter credentials" dialog that asks ONLY for the curated
/// server's required key(s). One obscured field per [requiredEnv] entry — no
/// command/URL field. On submit it POSTs the keys via
/// [McpController.setCredentials] and pops on success; failures show inline.
class _McpCredentialsDialog extends StatefulWidget {
  const _McpCredentialsDialog({
    required this.ctrl,
    required this.serverName,
    required this.requiredEnv,
  });

  final McpController ctrl;
  final String serverName;
  final List<String> requiredEnv;

  @override
  State<_McpCredentialsDialog> createState() => _McpCredentialsDialogState();
}

class _McpCredentialsDialogState extends State<_McpCredentialsDialog> {
  /// One controller per required env key, keyed by the env-var name.
  late final Map<String, TextEditingController> _controllers = {
    for (final key in widget.requiredEnv) key: TextEditingController(),
  };

  bool _submitting = false;
  String? _submitError;

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  /// Humanizes an env-var name into a friendly label, e.g.
  /// `STRIPE_SECRET_KEY` → "Stripe secret key". Adds a `(sk_...)` hint for
  /// obvious secret-key names without hardcoding per-provider strings.
  String _humanize(String envKey) {
    final words = envKey
        .split('_')
        .where((w) => w.isNotEmpty)
        .map((w) => '${w[0].toUpperCase()}${w.substring(1).toLowerCase()}')
        .toList();
    if (words.isEmpty) return envKey;
    return words.join(' ');
  }

  Future<void> _submit() async {
    final env = <String, String>{};
    var allFilled = true;
    for (final key in widget.requiredEnv) {
      final value = _controllers[key]!.text.trim();
      if (value.isEmpty) {
        allFilled = false;
        break;
      }
      env[key] = value;
    }
    if (!allFilled) {
      setState(() => _submitError = 'Enter a value for every field.');
      return;
    }

    setState(() {
      _submitting = true;
      _submitError = null;
    });

    try {
      await widget.ctrl.setCredentials(widget.serverName, env);
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
      title: Text('Connect ${widget.serverName}'),
      content: SizedBox(
        width: 400,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Enter the required credential${widget.requiredEnv.length > 1 ? 's' : ''} '
              'to connect this server.',
              style: TextStyle(
                fontSize: 13,
                color: context.rhythm.textSecondary,
              ),
            ),
            for (var i = 0; i < widget.requiredEnv.length; i++) ...[
              const SizedBox(height: 12),
              TextField(
                key: Key('mcp-cred-field-${widget.requiredEnv[i]}'),
                controller: _controllers[widget.requiredEnv[i]],
                autofocus: i == 0,
                obscureText: true,
                enabled: !_submitting,
                decoration: InputDecoration(
                  labelText: _humanize(widget.requiredEnv[i]),
                  hintText: widget.requiredEnv[i],
                  isDense: true,
                ),
              ),
            ],
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
      actions: [
        TextButton(
          onPressed: _submitting ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          key: const Key('mcp-cred-submit'),
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
              : const Text('Connect'),
        ),
      ],
    );
  }
}
