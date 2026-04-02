import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/auth/auth_session_service.dart';
import '../../../app/core/services/server_config_service.dart';
import '../../../app/core/updates/update_controller.dart';
import '../../../app/theme/rhythm_tokens.dart';

class SettingsView extends StatefulWidget {
  const SettingsView({super.key});

  @override
  State<SettingsView> createState() => _SettingsViewState();
}

class _SettingsViewState extends State<SettingsView> {
  late final TextEditingController _urlController;
  bool _saving = false;

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
    final user = auth.currentUser;

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
