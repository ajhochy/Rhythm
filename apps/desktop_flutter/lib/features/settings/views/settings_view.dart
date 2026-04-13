import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../../app/core/auth/auth_session_service.dart';
import '../../../app/core/auth/auth_user.dart';
import '../../../app/core/services/server_config_service.dart';
import '../../../app/core/updates/update_controller.dart';
import '../../../app/core/workspace/workspace_controller.dart';
import '../../../app/core/workspace/workspace_models.dart';
import '../../../app/theme/rhythm_tokens.dart';
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
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Saved')),
      );
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
      backgroundColor: RhythmTokens.background,
      appBar: AppBar(
        title: const Text('Settings'),
        backgroundColor: RhythmTokens.surface,
        foregroundColor: RhythmTokens.textPrimary,
        elevation: 0,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(color: RhythmTokens.borderSoft, height: 1),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          if (user != null) ...[
            const Text(
              'ACCOUNT',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: RhythmTokens.textSecondary,
                letterSpacing: 0.8,
              ),
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: RhythmTokens.surfaceStrong,
                borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
                border: Border.all(color: RhythmTokens.borderSoft),
                boxShadow: RhythmTokens.shadow,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Signed in user',
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: RhythmTokens.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      CircleAvatar(
                        radius: 22,
                        backgroundColor: RhythmTokens.accentSoft,
                        backgroundImage: user.photoUrl != null
                            ? NetworkImage(user.photoUrl!)
                            : null,
                        child: user.photoUrl == null
                            ? Text(
                                _settingsInitialsFor(user.name),
                                style: const TextStyle(
                                  color: RhythmTokens.accent,
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
                              style: const TextStyle(
                                color: RhythmTokens.textPrimary,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              user.email,
                              style: const TextStyle(
                                fontSize: 13,
                                color: RhythmTokens.textSecondary,
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
                    style: const TextStyle(
                      fontSize: 13,
                      color: RhythmTokens.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    user.isFacilitiesManager
                        ? 'Facilities manager access enabled'
                        : 'Facilities manager access disabled',
                    style: const TextStyle(
                      fontSize: 13,
                      color: RhythmTokens.textSecondary,
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
            const Text(
              'USER PERMISSIONS',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: RhythmTokens.textSecondary,
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
          const _WorkspaceSectionWidget(),
          const Text(
            'UPDATES',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: RhythmTokens.textSecondary,
              letterSpacing: 0.8,
            ),
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: RhythmTokens.surfaceStrong,
              borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
              border: Border.all(color: RhythmTokens.borderSoft),
              boxShadow: RhythmTokens.shadow,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Desktop app updates',
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    color: RhythmTokens.textPrimary,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  updateController.currentVersion == null
                      ? 'Version unknown'
                      : 'Current version: v${updateController.currentVersion}',
                  style: const TextStyle(
                    fontSize: 13,
                    color: RhythmTokens.textSecondary,
                  ),
                ),
                const SizedBox(height: 12),
                if (updateController.isChecking)
                  const Text(
                    'Checking for updates...',
                    style: TextStyle(
                      fontSize: 13,
                      color: RhythmTokens.textSecondary,
                    ),
                  )
                else if (updateController.availableUpdate != null) ...[
                  Text(
                    'Update ready: ${updateController.availableUpdate!.version}${updateController.availableUpdate!.prerelease ? ' beta' : ''}',
                    style: const TextStyle(
                      fontSize: 13,
                      color: RhythmTokens.textPrimary,
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
                  const Text(
                    'You are on the latest release.',
                    style: TextStyle(
                      fontSize: 13,
                      color: RhythmTokens.textSecondary,
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
                    style: const TextStyle(
                      fontSize: 12,
                      color: RhythmTokens.danger,
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 24),
          const Text(
            'SERVER',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: RhythmTokens.textSecondary,
              letterSpacing: 0.8,
            ),
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: RhythmTokens.surfaceStrong,
              borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
              border: Border.all(color: RhythmTokens.borderSoft),
              boxShadow: RhythmTokens.shadow,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'API Server URL',
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    color: RhythmTokens.textPrimary,
                  ),
                ),
                const SizedBox(height: 4),
                const Text(
                  'Use http://localhost:4000 for local, or your hosted server URL.',
                  style: TextStyle(
                    fontSize: 13,
                    color: RhythmTokens.textSecondary,
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
                              strokeWidth: 2, color: Colors.white),
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
        color: RhythmTokens.surfaceStrong,
        borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
        border: Border.all(color: RhythmTokens.borderSoft),
        boxShadow: RhythmTokens.shadow,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Admin controls',
            style: TextStyle(
              fontWeight: FontWeight.w600,
              color: RhythmTokens.textPrimary,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Manage which users are admins and which users can manage Facilities.',
            style: TextStyle(
              fontSize: 13,
              color: RhythmTokens.textSecondary,
            ),
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
                  style: const TextStyle(
                    fontSize: 13,
                    color: RhythmTokens.danger,
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
        ? const [
            DropdownMenuItem(value: 'system', child: Text('System')),
          ]
        : const [
            DropdownMenuItem(value: 'member', child: Text('Member')),
            DropdownMenuItem(value: 'admin', child: Text('Admin')),
          ];

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: RhythmTokens.surface,
        borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
        border: Border.all(color: RhythmTokens.borderSoft),
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
                      style: const TextStyle(
                        color: RhythmTokens.textPrimary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      user.email,
                      style: const TextStyle(
                        fontSize: 13,
                        color: RhythmTokens.textSecondary,
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
                  title: const Text(
                    'Facilities manager',
                    style: TextStyle(
                      fontSize: 14,
                      color: RhythmTokens.textPrimary,
                    ),
                  ),
                  subtitle: const Text(
                    'Can create, edit, and manage rooms in Facilities.',
                    style: TextStyle(
                      fontSize: 12,
                      color: RhythmTokens.textSecondary,
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

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthSessionService>();
    final controller = context.watch<WorkspaceController>();
    final workspace = auth.workspace;
    if (workspace == null) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'WORKSPACE',
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: RhythmTokens.textSecondary,
            letterSpacing: 0.8,
          ),
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: RhythmTokens.surfaceStrong,
            borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
            border: Border.all(color: RhythmTokens.borderSoft),
            boxShadow: RhythmTokens.shadow,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                workspace.name,
                style: const TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 16,
                  color: RhythmTokens.textPrimary,
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
                          fontFamily: 'monospace', fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(width: 4),
                    IconButton(
                      icon: const Icon(Icons.copy, size: 16),
                      tooltip: 'Copy join code',
                      onPressed: () {
                        Clipboard.setData(
                            ClipboardData(text: workspace.joinCode!));
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
              const Text(
                'Members',
                style: TextStyle(
                    fontWeight: FontWeight.w600,
                    color: RhythmTokens.textSecondary,
                    fontSize: 13),
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
            ],
          ),
        ),
        const SizedBox(height: 24),
      ],
    );
  }
}

class _MemberTile extends StatelessWidget {
  const _MemberTile({
    required this.member,
    required this.isCurrentUserAdmin,
  });

  final WorkspaceMember member;
  final bool isCurrentUserAdmin;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: CircleAvatar(
        child: Text(member.name[0].toUpperCase()),
      ),
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
                    value: 'remove', child: Text('Remove member')),
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
              style: const TextStyle(
                  color: RhythmTokens.textSecondary, fontSize: 12),
            ),
    );
  }
}

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
