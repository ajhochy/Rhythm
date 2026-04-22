import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../../app/core/auth/auth_session_service.dart';
import '../../../app/core/auth/auth_user.dart';
import '../../../app/core/services/server_config_service.dart';
import '../../../app/core/updates/update_controller.dart';
import '../../../app/core/workspace/workspace_controller.dart';
import '../../../app/core/workspace/workspace_models.dart';
import '../../../app/core/services/theme_mode_service.dart';
import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/settings_controller.dart';

class SettingsView extends StatefulWidget {
  const SettingsView({super.key});

  @override
  State<SettingsView> createState() => _SettingsViewState();
}

class _SettingsViewState extends State<SettingsView> {
  late final TextEditingController _urlController;
  bool _saving = false;
  bool _loadedPermissionsOnce = false;

  @override
  void initState() {
    super.initState();
    final svc = context.read<ServerConfigService>();
    _urlController = TextEditingController(text: svc.url);
  }

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final value = _urlController.text.trim();
    if (value.isEmpty) return;
    setState(() => _saving = true);
    await context.read<ServerConfigService>().save(value);
    setState(() => _saving = false);
    if (mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Saved')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthSessionService>();
    final updateController = context.watch<UpdateController>();
    final settingsController = context.watch<SettingsController>();
    final user = auth.currentUser;
    final canManagePermissions = user?.isAdmin ?? false;

    if (canManagePermissions && !_loadedPermissionsOnce) {
      _loadedPermissionsOnce = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        context.read<SettingsController>().loadUsers();
      });
    }

    return Scaffold(
      backgroundColor: context.rhythm.canvas,
      appBar: AppBar(
        title: const Text('Settings'),
        backgroundColor: context.rhythm.surface,
        foregroundColor: context.rhythm.textPrimary,
        elevation: 0,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(color: context.rhythm.borderSubtle, height: 1),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          if (user != null) ...[
            Text(
              'ACCOUNT',
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
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Signed in user',
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: context.rhythm.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      CircleAvatar(
                        radius: 22,
                        backgroundColor: context.rhythm.accentMuted,
                        backgroundImage: user.photoUrl != null
                            ? NetworkImage(user.photoUrl!)
                            : null,
                        child: user.photoUrl == null
                            ? Text(
                                _settingsInitialsFor(user.name),
                                style: TextStyle(
                                  color: context.rhythm.accent,
                                  fontWeight: FontWeight.w700,
                                ),
                              )
                            : null,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              user.name,
                              style: TextStyle(
                                color: context.rhythm.textPrimary,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              user.email,
                              style: TextStyle(
                                fontSize: 13,
                                color: context.rhythm.textSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Role: ${user.role}',
                    style: TextStyle(
                      fontSize: 13,
                      color: context.rhythm.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    user.isFacilitiesManager
                        ? 'Facilities manager access enabled'
                        : 'Facilities manager access disabled',
                    style: TextStyle(
                      fontSize: 13,
                      color: context.rhythm.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 16),
                  OutlinedButton(
                    onPressed: () async {
                      final navigator = Navigator.of(context);
                      await auth.logout();
                      if (mounted) {
                        navigator.pop();
                      }
                    },
                    child: const Text('Sign out'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
          ],
          if (canManagePermissions) ...[
            Text(
              'USER PERMISSIONS',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: context.rhythm.textSecondary,
                letterSpacing: 0.8,
              ),
            ),
            const SizedBox(height: 12),
            _UserPermissionsCard(
              controller: settingsController,
              onUserUpdated: auth.updateCurrentUser,
            ),
            const SizedBox(height: 24),
          ],
          const _AppearanceSection(),
          const SizedBox(height: 24),
          const _ClaudeIntegrationSection(),
          const SizedBox(height: 24),
          const _WorkspaceSectionWidget(),
          Text(
            'UPDATES',
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
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Desktop app updates',
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    color: context.rhythm.textPrimary,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  updateController.currentVersion == null
                      ? 'Version unknown'
                      : 'Current version: v${updateController.currentVersion}',
                  style: TextStyle(
                    fontSize: 13,
                    color: context.rhythm.textSecondary,
                  ),
                ),
                const SizedBox(height: 12),
                if (updateController.isChecking)
                  Text(
                    'Checking for updates...',
                    style: TextStyle(
                      fontSize: 13,
                      color: context.rhythm.textSecondary,
                    ),
                  )
                else if (updateController.availableUpdate != null) ...[
                  Text(
                    'Update ready: ${updateController.availableUpdate!.version}${updateController.availableUpdate!.prerelease ? ' beta' : ''}',
                    style: TextStyle(
                      fontSize: 13,
                      color: context.rhythm.textPrimary,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    children: [
                      FilledButton(
                        onPressed: updateController.openDownload,
                        child: const Text('Download'),
                      ),
                      OutlinedButton(
                        onPressed: updateController.openReleaseNotes,
                        child: const Text('Release notes'),
                      ),
                    ],
                  ),
                ] else ...[
                  Text(
                    'You are on the latest release.',
                    style: TextStyle(
                      fontSize: 13,
                      color: context.rhythm.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton(
                    onPressed: updateController.checkForUpdates,
                    child: const Text('Check now'),
                  ),
                ],
                if (updateController.errorMessage != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    updateController.errorMessage!,
                    style: TextStyle(
                      fontSize: 12,
                      color: context.rhythm.danger,
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 24),
          Text(
            'SERVER',
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
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'API Server URL',
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    color: context.rhythm.textPrimary,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Use http://localhost:4000 for local, or your hosted server URL.',
                  style: TextStyle(
                    fontSize: 13,
                    color: context.rhythm.textSecondary,
                  ),
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _urlController,
                  decoration: const InputDecoration(
                    hintText: 'http://localhost:4000',
                    isDense: true,
                  ),
                  keyboardType: TextInputType.url,
                  autocorrect: false,
                  onFieldSubmitted: (_) => _save(),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _saving ? null : _save,
                  child: _saving
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Text('Save'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _UserPermissionsCard extends StatelessWidget {
  const _UserPermissionsCard({
    required this.controller,
    required this.onUserUpdated,
  });

  final SettingsController controller;
  final ValueChanged<AuthUser> onUserUpdated;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceRaised,
        borderRadius: BorderRadius.circular(RhythmRadius.xl),
        border: Border.all(color: context.rhythm.borderSubtle),
        boxShadow: RhythmElevation.panel,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Admin controls',
            style: TextStyle(
              fontWeight: FontWeight.w600,
              color: context.rhythm.textPrimary,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Manage which users are admins and which users can manage Facilities.',
            style: TextStyle(fontSize: 13, color: context.rhythm.textSecondary),
          ),
          const SizedBox(height: 16),
          if (controller.usersStatus == SettingsUsersStatus.loading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (controller.usersStatus == SettingsUsersStatus.error)
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  controller.usersErrorMessage ?? 'Could not load users.',
                  style: TextStyle(
                    fontSize: 13,
                    color: context.rhythm.danger,
                  ),
                ),
                const SizedBox(height: 12),
                OutlinedButton(
                  onPressed: () => controller.loadUsers(force: true),
                  child: const Text('Retry'),
                ),
              ],
            )
          else ...[
            for (final user in controller.users)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _UserPermissionRow(
                  user: user,
                  saving: controller.isSavingUser(user.id),
                  onRoleChanged: user.role == 'system'
                      ? null
                      : (value) async {
                          if (value == null || value == user.role) return;
                          try {
                            final updated = await controller.updateUser(
                              user.id,
                              role: value,
                            );
                            onUserUpdated(updated);
                          } catch (error) {
                            if (!context.mounted) return;
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text(error.toString())),
                            );
                          }
                        },
                  onFacilitiesChanged: user.role == 'system'
                      ? null
                      : (value) async {
                          try {
                            final updated = await controller.updateUser(
                              user.id,
                              isFacilitiesManager: value,
                            );
                            onUserUpdated(updated);
                          } catch (error) {
                            if (!context.mounted) return;
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text(error.toString())),
                            );
                          }
                        },
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _UserPermissionRow extends StatelessWidget {
  const _UserPermissionRow({
    required this.user,
    required this.saving,
    required this.onRoleChanged,
    required this.onFacilitiesChanged,
  });

  final AuthUser user;
  final bool saving;
  final ValueChanged<String?>? onRoleChanged;
  final ValueChanged<bool>? onFacilitiesChanged;

  @override
  Widget build(BuildContext context) {
    final roleItems = user.role == 'system'
        ? const [DropdownMenuItem(value: 'system', child: Text('System'))]
        : const [
            DropdownMenuItem(value: 'member', child: Text('Member')),
            DropdownMenuItem(value: 'admin', child: Text('Admin')),
          ];

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: context.rhythm.surface,
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        border: Border.all(color: context.rhythm.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      user.name,
                      style: TextStyle(
                        color: context.rhythm.textPrimary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      user.email,
                      style: TextStyle(
                        fontSize: 13,
                        color: context.rhythm.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              if (saving)
                const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
            ],
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 16,
            runSpacing: 12,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              SizedBox(
                width: 180,
                child: DropdownButtonFormField<String>(
                  value: user.role == 'system' ? 'system' : user.role,
                  decoration: const InputDecoration(
                    labelText: 'Role',
                    isDense: true,
                  ),
                  items: roleItems,
                  onChanged: saving ? null : onRoleChanged,
                ),
              ),
              SizedBox(
                width: 260,
                child: SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    'Facilities manager',
                    style: TextStyle(
                      fontSize: 14,
                      color: context.rhythm.textPrimary,
                    ),
                  ),
                  subtitle: Text(
                    'Can create, edit, and manage rooms in Facilities.',
                    style: TextStyle(
                      fontSize: 12,
                      color: context.rhythm.textSecondary,
                    ),
                  ),
                  value: user.isFacilitiesManager,
                  onChanged: saving ? null : onFacilitiesChanged,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Claude / MCP integration
// ---------------------------------------------------------------------------

class _ClaudeIntegrationSection extends StatefulWidget {
  const _ClaudeIntegrationSection();

  @override
  State<_ClaudeIntegrationSection> createState() =>
      _ClaudeIntegrationSectionState();
}

class _ClaudeIntegrationSectionState extends State<_ClaudeIntegrationSection> {
  bool _tokenVisible = false;
  bool _copied = false;

  void _copyToken(String token) {
    Clipboard.setData(ClipboardData(text: token));
    setState(() => _copied = true);
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) setState(() => _copied = false);
    });
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthSessionService>();
    final serverConfig = context.watch<ServerConfigService>();
    final token = auth.sessionToken;
    final isAuthenticated = auth.isAuthenticated && token != null;
    final isCloudUrl = serverConfig.url.contains('api.vcrcapps.com');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'CLAUDE INTEGRATION',
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
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'MCP Server Token',
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  color: context.rhythm.textPrimary,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Use this token to connect Claude Desktop or Claude Code to '
                'your Rhythm workspace via the @ajhochy/rhythm-mcp-server '
                'package.',
                style: TextStyle(
                  fontSize: 13,
                  color: context.rhythm.textSecondary,
                ),
              ),
              const SizedBox(height: 16),
              if (!isAuthenticated) ...[
                Text(
                  'Sign in to generate a token.',
                  style: TextStyle(
                    fontSize: 13,
                    color: context.rhythm.textMuted,
                  ),
                ),
              ] else if (!isCloudUrl) ...[
                Row(
                  children: [
                    Icon(
                      Icons.info_outline,
                      size: 16,
                      color: context.rhythm.warning,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Your API Server is set to ${serverConfig.url}. Switch to api.vcrcapps.com to get a cloud token for Claude.',
                        style: TextStyle(
                          fontSize: 13,
                          color: context.rhythm.textSecondary,
                        ),
                      ),
                    ),
                  ],
                ),
              ] else ...[
                // Token display row
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 10,
                  ),
                  decoration: BoxDecoration(
                    color: context.rhythm.surfaceMuted,
                    borderRadius: BorderRadius.circular(RhythmRadius.md),
                    border: Border.all(color: context.rhythm.border),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          _tokenVisible ? token : '•' * 40,
                          style: TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 12,
                            color: context.rhythm.textPrimary,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 8),
                      IconButton(
                        icon: Icon(
                          _tokenVisible
                              ? Icons.visibility_off_outlined
                              : Icons.visibility_outlined,
                          size: 18,
                          color: context.rhythm.textSecondary,
                        ),
                        tooltip: _tokenVisible ? 'Hide token' : 'Show token',
                        onPressed: () =>
                            setState(() => _tokenVisible = !_tokenVisible),
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(),
                      ),
                      const SizedBox(width: 8),
                      FilledButton.icon(
                        onPressed: () => _copyToken(token),
                        icon: Icon(
                          _copied ? Icons.check : Icons.copy,
                          size: 16,
                        ),
                        label: Text(_copied ? 'Copied!' : 'Copy'),
                        style: FilledButton.styleFrom(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 10,
                          ),
                          backgroundColor: _copied
                              ? context.rhythm.success
                              : context.rhythm.accent,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  'Claude Desktop config (~/.claude/claude_desktop_config.json):',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: context.rhythm.textSecondary,
                  ),
                ),
                const SizedBox(height: 6),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1E293B),
                    borderRadius: BorderRadius.circular(RhythmRadius.md),
                  ),
                  child: SelectableText(
                    '{\n'
                    '  "mcpServers": {\n'
                    '    "rhythm": {\n'
                    '      "command": "npx",\n'
                    '      "args": ["-y", "@ajhochy/rhythm-mcp-server"],\n'
                    '      "env": {\n'
                    '        "RHYTHM_API_URL": "${serverConfig.url}",\n'
                    '        "RHYTHM_API_TOKEN": "${_tokenVisible ? token : "••••••••"}"\n'
                    '      }\n'
                    '    }\n'
                    '  }\n'
                    '}',
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 12,
                      color: Color(0xFF94A3B8),
                      height: 1.6,
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Token is valid for 1 year. Sign out and back in to rotate it.',
                  style: TextStyle(
                    fontSize: 12,
                    color: context.rhythm.textMuted,
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------

class _WorkspaceSectionWidget extends StatefulWidget {
  const _WorkspaceSectionWidget();

  @override
  State<_WorkspaceSectionWidget> createState() =>
      _WorkspaceSectionWidgetState();
}

class _WorkspaceSectionWidgetState extends State<_WorkspaceSectionWidget> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      context.read<WorkspaceController>().loadMembers();
    });
  }

  Future<void> _showAddMemberDialog(BuildContext context) async {
    final auth = context.read<AuthSessionService>();
    if (!auth.isWorkspaceAdmin) return;

    final workspaceController = context.read<WorkspaceController>();
    final settingsController = context.read<SettingsController>();

    if (workspaceController.status == WorkspaceStatus.idle &&
        workspaceController.members.isEmpty) {
      await workspaceController.loadMembers();
    }
    if (settingsController.usersStatus != SettingsUsersStatus.ready ||
        settingsController.users.isEmpty) {
      await settingsController.loadUsers(force: true);
    }

    if (!context.mounted) return;
    final messenger = ScaffoldMessenger.of(context);

    final queryController = TextEditingController();
    int? selectedUserId;

    try {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) {
          return StatefulBuilder(
            builder: (dialogContext, setDialogState) {
              final existingIds = workspaceController.members
                  .map((member) => member.userId)
                  .toSet();
              final query = queryController.text.trim().toLowerCase();
              final candidates = settingsController.users.where((user) {
                if (user.role == 'system') return false;
                if (existingIds.contains(user.id)) return false;
                if (query.isEmpty) return true;
                final haystack = '${user.name} ${user.email}'.toLowerCase();
                return haystack.contains(query);
              }).toList();

              return AlertDialog(
                title: const Text('Add workspace member'),
                content: SizedBox(
                  width: 420,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      TextField(
                        controller: queryController,
                        autofocus: true,
                        decoration: const InputDecoration(
                          hintText: 'Search users by name or email',
                          isDense: true,
                        ),
                        onChanged: (_) {
                          setDialogState(() {
                            selectedUserId = null;
                          });
                        },
                      ),
                      const SizedBox(height: 12),
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxHeight: 320),
                        child: candidates.isEmpty
                            ? Center(
                                child: Padding(
                                  padding:
                                      const EdgeInsets.symmetric(vertical: 16),
                                  child: Text(
                                    'No matching registered users found.',
                                    style: TextStyle(
                                      fontSize: 13,
                                      color: dialogContext.rhythm.textSecondary,
                                    ),
                                    textAlign: TextAlign.center,
                                  ),
                                ),
                              )
                            : ListView.separated(
                                shrinkWrap: true,
                                itemCount: candidates.length,
                                separatorBuilder: (_, __) =>
                                    const SizedBox(height: 8),
                                itemBuilder: (_, index) {
                                  final user = candidates[index];
                                  return RadioListTile<int>(
                                    value: user.id,
                                    groupValue: selectedUserId,
                                    dense: true,
                                    contentPadding: EdgeInsets.zero,
                                    title: Text(
                                      user.name,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                    subtitle: Text(user.email),
                                    onChanged: (value) {
                                      setDialogState(() {
                                        selectedUserId = value;
                                      });
                                    },
                                  );
                                },
                              ),
                      ),
                    ],
                  ),
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.of(dialogContext).pop(false),
                    child: const Text('Cancel'),
                  ),
                  FilledButton(
                    onPressed: selectedUserId == null
                        ? null
                        : () => Navigator.of(dialogContext).pop(true),
                    child: const Text('Add'),
                  ),
                ],
              );
            },
          );
        },
      );

      if (confirmed == true && selectedUserId != null && context.mounted) {
        await workspaceController.addMemberDirect(selectedUserId!);
        if (!context.mounted) return;
        messenger.showSnackBar(const SnackBar(content: Text('Member added')));
      }
    } catch (error) {
      if (!context.mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(error.toString())));
    } finally {
      queryController.dispose();
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthSessionService>();
    final controller = context.watch<WorkspaceController>();
    final workspace = auth.workspace;
    if (workspace == null) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'WORKSPACE',
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
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                workspace.name,
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 16,
                  color: context.rhythm.textPrimary,
                ),
              ),
              if (auth.isWorkspaceAdmin && workspace.joinCode != null) ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    const Text('Join code: '),
                    Text(
                      workspace.joinCode!,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(width: 4),
                    IconButton(
                      icon: const Icon(Icons.copy, size: 16),
                      tooltip: 'Copy join code',
                      onPressed: () {
                        Clipboard.setData(
                          ClipboardData(text: workspace.joinCode!),
                        );
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Join code copied')),
                        );
                      },
                    ),
                    TextButton(
                      onPressed: () async {
                        final newCode = await context
                            .read<WorkspaceController>()
                            .regenerateJoinCode();
                        if (mounted) {
                          await context
                              .read<AuthSessionService>()
                              .refreshFromServer();
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('New code: $newCode')),
                          );
                        }
                      },
                      child: const Text('Regenerate'),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 16),
              Text(
                'Members',
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  color: context.rhythm.textSecondary,
                  fontSize: 13,
                ),
              ),
              const SizedBox(height: 8),
              if (controller.status == WorkspaceStatus.loading)
                const CircularProgressIndicator()
              else
                ...controller.members.map(
                  (member) => _MemberTile(
                    member: member,
                    isCurrentUserAdmin: auth.isWorkspaceAdmin,
                  ),
                ),
              if (auth.isWorkspaceAdmin) ...[
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: () => _showAddMemberDialog(context),
                  icon: const Icon(Icons.person_add_outlined, size: 16),
                  label: const Text('Add member'),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 24),
      ],
    );
  }
}

class _MemberTile extends StatelessWidget {
  const _MemberTile({required this.member, required this.isCurrentUserAdmin});

  final WorkspaceMember member;
  final bool isCurrentUserAdmin;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: CircleAvatar(child: Text(member.name[0].toUpperCase())),
      title: Text(member.name),
      subtitle: Text(member.email),
      trailing: isCurrentUserAdmin
          ? PopupMenuButton<String>(
              itemBuilder: (_) => [
                PopupMenuItem(
                  value: member.isAdmin ? 'make_staff' : 'make_admin',
                  child: Text(member.isAdmin ? 'Make Staff' : 'Make Admin'),
                ),
                const PopupMenuItem(
                  value: 'remove',
                  child: Text('Remove member'),
                ),
              ],
              onSelected: (action) async {
                final ctrl = context.read<WorkspaceController>();
                if (action == 'make_staff') {
                  await ctrl.updateMemberRole(member.userId, 'staff');
                } else if (action == 'make_admin') {
                  await ctrl.updateMemberRole(member.userId, 'admin');
                } else if (action == 'remove') {
                  await ctrl.removeMember(member.userId);
                }
              },
            )
          : Text(
              member.role,
              style: TextStyle(
                color: context.rhythm.textSecondary,
                fontSize: 12,
              ),
            ),
    );
  }
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

class _AppearanceSection extends StatelessWidget {
  const _AppearanceSection();

  @override
  Widget build(BuildContext context) {
    final service = context.watch<ThemeModeService>();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'APPEARANCE',
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
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Theme',
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  color: context.rhythm.textPrimary,
                ),
              ),
              const SizedBox(height: 16),
              SegmentedButton<ThemeMode>(
                segments: const [
                  ButtonSegment(
                    value: ThemeMode.light,
                    label: Text('Light'),
                    icon: Icon(Icons.light_mode_outlined),
                  ),
                  ButtonSegment(
                    value: ThemeMode.system,
                    label: Text('System'),
                    icon: Icon(Icons.brightness_auto_outlined),
                  ),
                  ButtonSegment(
                    value: ThemeMode.dark,
                    label: Text('Dark'),
                    icon: Icon(Icons.dark_mode_outlined),
                  ),
                ],
                selected: {service.themeMode},
                onSelectionChanged: (selection) => context
                    .read<ThemeModeService>()
                    .setThemeMode(selection.first),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------

String _settingsInitialsFor(String name) {
  final parts = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty)
      .take(2)
      .toList();
  if (parts.isEmpty) return '?';
  return parts.map((part) => part[0].toUpperCase()).join();
}
