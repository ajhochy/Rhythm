import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:provider/provider.dart';

import '../../../app/core/auth/auth_session_service.dart';
import '../../../app/core/notifications/local_notification_service.dart';
import '../../../app/core/services/server_config_service.dart';
import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../../features/reminders/models/reminder_preferences.dart';
import '../../../features/reminders/services/reminder_preferences_service.dart';
import '../widgets/settings_section.dart';

class SettingsView extends StatefulWidget {
  const SettingsView({super.key});

  @override
  State<SettingsView> createState() => _SettingsViewState();
}

class _SettingsViewState extends State<SettingsView> {
  // ---- Advanced section ----
  bool _advancedExpanded = false;
  final _apiUrlController = TextEditingController();
  final _apiUrlFocusNode = FocusNode();

  // ---- About ----
  String _appVersion = '';

  @override
  void initState() {
    super.initState();
    _loadAppVersion();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final serverConfig = context.read<ServerConfigService>();
      _apiUrlController.text = serverConfig.url;
    });
  }

  Future<void> _loadAppVersion() async {
    final info = await PackageInfo.fromPlatform();
    if (mounted) {
      setState(() {
        _appVersion = info.version;
      });
    }
  }

  @override
  void dispose() {
    _apiUrlController.dispose();
    _apiUrlFocusNode.dispose();
    super.dispose();
  }

  // ---- Helpers ----

  String _formatTime(TimeOfDay t) =>
      '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  /// Returns true if the reminder time falls within the quiet-hours window.
  bool _reminderInQuietHours(ReminderPreferences prefs) {
    final rt = prefs.reminderTime;
    final start = prefs.quietHoursStart;
    final end = prefs.quietHoursEnd;

    final rtMins = rt.hour * 60 + rt.minute;
    final startMins = start.hour * 60 + start.minute;
    final endMins = end.hour * 60 + end.minute;

    if (startMins == endMins) return false;

    if (startMins < endMins) {
      return rtMins >= startMins && rtMins < endMins;
    } else {
      return rtMins >= startMins || rtMins < endMins;
    }
  }

  Future<void> _pickTime(
    BuildContext context,
    TimeOfDay initial,
    ValueChanged<TimeOfDay> onPicked,
  ) async {
    final picked = await showTimePicker(
      context: context,
      initialTime: initial,
    );
    if (picked != null) {
      onPicked(picked);
    }
  }

  Future<void> _confirmAndSaveApiUrl(BuildContext context) async {
    final newUrl = _apiUrlController.text.trim();
    final serverConfig = context.read<ServerConfigService>();
    final authSession = context.read<AuthSessionService>();
    if (newUrl == serverConfig.url) return;

    _apiUrlFocusNode.unfocus();

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Change API URL?'),
        content: const Text(
          'This will sign you out so the app reconnects to the new server.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Change & Sign Out'),
          ),
        ],
      ),
    );

    if (confirmed == true && mounted) {
      await serverConfig.save(newUrl);
      if (mounted) {
        await authSession.logout();
      }
    }
  }

  // ---- Build ----

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final textTheme = Theme.of(context).textTheme;

    final auth = context.watch<AuthSessionService>();
    final reminderPrefs = context.watch<ReminderPreferencesService>();
    final serverConfig = context.watch<ServerConfigService>();
    final notificationSvc = context.read<LocalNotificationService>();

    final user = auth.currentUser;
    final workspace = auth.currentWorkspace;
    final prefs = reminderPrefs.preferences;

    // Keep text field in sync when serverConfig changes externally.
    if (_apiUrlController.text != serverConfig.url &&
        !_apiUrlFocusNode.hasFocus) {
      _apiUrlController.text = serverConfig.url;
    }

    return Scaffold(
      backgroundColor: colors.canvas,
      appBar: AppBar(
        backgroundColor: colors.canvas,
        elevation: 0,
        title: Text(
          'Settings',
          style: textTheme.titleLarge?.copyWith(
            color: colors.textPrimary,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.symmetric(
          horizontal: RhythmSpacing.md,
          vertical: RhythmSpacing.md,
        ),
        children: [
          // ----------------------------------------------------------------
          // Account
          // ----------------------------------------------------------------
          SettingsSection(
            title: 'Account',
            children: [
              _AccountTile(user: user, workspace: workspace),
              _SettingsTile(
                leading: const Icon(Icons.logout),
                title: 'Sign out',
                titleColor: colors.danger,
                onTap: () => auth.logout(),
              ),
            ],
          ),

          const SizedBox(height: RhythmSpacing.lg),

          // ----------------------------------------------------------------
          // Reminders
          // ----------------------------------------------------------------
          SettingsSection(
            title: 'Reminders',
            children: [
              // Enable toggle
              _SettingsTile(
                leading: const Icon(Icons.notifications_outlined),
                title: 'Enable reminders',
                trailing: Switch(
                  value: prefs.enabled,
                  onChanged: (val) {
                    reminderPrefs.update(prefs.copyWith(enabled: val));
                  },
                ),
              ),

              // Reminder time
              _SettingsTile(
                leading: const Icon(Icons.access_time_outlined),
                title: 'Reminder time',
                subtitle: _formatTime(prefs.reminderTime),
                onTap: prefs.enabled
                    ? () => _pickTime(
                          context,
                          prefs.reminderTime,
                          (t) => reminderPrefs
                              .update(prefs.copyWith(reminderTime: t)),
                        )
                    : null,
              ),

              // Quiet hours start
              _SettingsTile(
                leading: const Icon(Icons.do_not_disturb_on_outlined),
                title: 'Quiet hours start',
                subtitle: _formatTime(prefs.quietHoursStart),
                onTap: () => _pickTime(
                  context,
                  prefs.quietHoursStart,
                  (t) =>
                      reminderPrefs.update(prefs.copyWith(quietHoursStart: t)),
                ),
              ),

              // Quiet hours end
              _SettingsTile(
                leading: const Icon(Icons.do_not_disturb_off_outlined),
                title: 'Quiet hours end',
                subtitle: _formatTime(prefs.quietHoursEnd),
                onTap: () => _pickTime(
                  context,
                  prefs.quietHoursEnd,
                  (t) => reminderPrefs.update(prefs.copyWith(quietHoursEnd: t)),
                ),
              ),

              // Warning when reminder time is inside quiet hours
              if (prefs.enabled && _reminderInQuietHours(prefs))
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: RhythmSpacing.md,
                    vertical: RhythmSpacing.xs,
                  ),
                  child: Row(
                    children: [
                      Icon(
                        Icons.info_outline,
                        size: 14,
                        color: colors.warning,
                      ),
                      const SizedBox(width: RhythmSpacing.xs),
                      Flexible(
                        child: Text(
                          'Reminders won\'t fire during quiet hours.',
                          style: textTheme.bodySmall
                              ?.copyWith(color: colors.warning),
                        ),
                      ),
                    ],
                  ),
                ),

              // Request permission button
              _SettingsTile(
                leading: const Icon(Icons.lock_open_outlined),
                title: 'Request notification permission',
                onTap: () async {
                  await notificationSvc.requestPermissions();
                },
              ),
            ],
          ),

          const SizedBox(height: RhythmSpacing.lg),

          // ----------------------------------------------------------------
          // Advanced (collapsible)
          // ----------------------------------------------------------------
          SettingsSection(
            title: 'Advanced',
            children: [
              _SettingsTile(
                leading: const Icon(Icons.tune_outlined),
                title: 'Advanced',
                trailing: Icon(
                  _advancedExpanded
                      ? Icons.keyboard_arrow_up
                      : Icons.keyboard_arrow_down,
                  color: colors.textSecondary,
                ),
                onTap: () =>
                    setState(() => _advancedExpanded = !_advancedExpanded),
              ),
              if (_advancedExpanded)
                Padding(
                  padding: const EdgeInsets.all(RhythmSpacing.md),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'API Base URL',
                        style: textTheme.bodySmall
                            ?.copyWith(color: colors.textSecondary),
                      ),
                      const SizedBox(height: RhythmSpacing.xs),
                      TextField(
                        controller: _apiUrlController,
                        focusNode: _apiUrlFocusNode,
                        keyboardType: TextInputType.url,
                        autocorrect: false,
                        style: textTheme.bodyMedium
                            ?.copyWith(color: colors.textPrimary),
                        decoration: InputDecoration(
                          hintText: 'https://api.example.com',
                          hintStyle: textTheme.bodyMedium
                              ?.copyWith(color: colors.textMuted),
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: RhythmSpacing.sm,
                            vertical: RhythmSpacing.xs,
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius:
                                BorderRadius.circular(RhythmRadius.sm),
                            borderSide: BorderSide(color: colors.border),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius:
                                BorderRadius.circular(RhythmRadius.sm),
                            borderSide: BorderSide(color: colors.accent),
                          ),
                        ),
                        textInputAction: TextInputAction.done,
                        onSubmitted: (_) => _confirmAndSaveApiUrl(context),
                      ),
                      const SizedBox(height: RhythmSpacing.xs),
                      Text(
                        'Changing this will sign you out.',
                        style: textTheme.bodySmall
                            ?.copyWith(color: colors.warning),
                      ),
                      const SizedBox(height: RhythmSpacing.sm),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton(
                          onPressed: () => _confirmAndSaveApiUrl(context),
                          style: FilledButton.styleFrom(
                            backgroundColor: colors.accent,
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(
                              borderRadius:
                                  BorderRadius.circular(RhythmRadius.sm),
                            ),
                          ),
                          child: const Text('Save'),
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),

          const SizedBox(height: RhythmSpacing.lg),

          // ----------------------------------------------------------------
          // About
          // ----------------------------------------------------------------
          SettingsSection(
            title: 'About',
            children: [
              _SettingsTile(
                leading: const Icon(Icons.info_outline),
                title: 'Rhythm Mobile',
                subtitle: _appVersion.isEmpty ? '' : 'v$_appVersion',
              ),
            ],
          ),

          const SizedBox(height: RhythmSpacing.xxl),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Private helper widgets
// ---------------------------------------------------------------------------

class _AccountTile extends StatelessWidget {
  const _AccountTile({required this.user, required this.workspace});

  final dynamic user;
  final dynamic workspace;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final textTheme = Theme.of(context).textTheme;

    final name = user?.name as String? ?? '';
    final email = user?.email as String? ?? '';
    final photoUrl = user?.photoUrl as String?;
    final workspaceName = workspace?.name as String? ?? '';

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: RhythmSpacing.md,
        vertical: RhythmSpacing.sm,
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 24,
            backgroundColor: colors.accentMuted,
            backgroundImage: photoUrl != null ? NetworkImage(photoUrl) : null,
            child: photoUrl == null
                ? Text(
                    name.isNotEmpty ? name[0].toUpperCase() : '?',
                    style: textTheme.titleMedium?.copyWith(
                      color: colors.accent,
                      fontWeight: FontWeight.w700,
                    ),
                  )
                : null,
          ),
          const SizedBox(width: RhythmSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: textTheme.bodyLarge?.copyWith(
                    color: colors.textPrimary,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (email.isNotEmpty)
                  Text(
                    email,
                    style: textTheme.bodySmall
                        ?.copyWith(color: colors.textSecondary),
                  ),
                if (workspaceName.isNotEmpty)
                  Text(
                    workspaceName,
                    style:
                        textTheme.bodySmall?.copyWith(color: colors.textMuted),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SettingsTile extends StatelessWidget {
  const _SettingsTile({
    required this.title,
    this.leading,
    this.subtitle,
    this.trailing,
    this.onTap,
    this.titleColor,
  });

  final String title;
  final Widget? leading;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;
  final Color? titleColor;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final textTheme = Theme.of(context).textTheme;

    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: RhythmSpacing.md,
          vertical: RhythmSpacing.sm,
        ),
        child: Row(
          children: [
            if (leading != null)
              IconTheme(
                data: IconThemeData(
                  color: titleColor ?? colors.textSecondary,
                  size: 20,
                ),
                child: leading!,
              ),
            if (leading != null) const SizedBox(width: RhythmSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: textTheme.bodyMedium?.copyWith(
                      color: titleColor ?? colors.textPrimary,
                    ),
                  ),
                  if (subtitle != null && subtitle!.isNotEmpty)
                    Text(
                      subtitle!,
                      style: textTheme.bodySmall
                          ?.copyWith(color: colors.textSecondary),
                    ),
                ],
              ),
            ),
            if (trailing != null) trailing!,
          ],
        ),
      ),
    );
  }
}
