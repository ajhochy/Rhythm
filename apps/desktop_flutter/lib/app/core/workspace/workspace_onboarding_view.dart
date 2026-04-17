import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../auth/auth_session_service.dart';
import '../services/server_config_service.dart';
import 'workspace_data_source.dart';
import 'workspace_repository.dart';

class WorkspaceOnboardingView extends StatefulWidget {
  const WorkspaceOnboardingView({super.key});

  @override
  State<WorkspaceOnboardingView> createState() =>
      _WorkspaceOnboardingViewState();
}

class _WorkspaceOnboardingViewState extends State<WorkspaceOnboardingView> {
  bool _isJoining = false;
  bool _loading = false;
  String? _error;
  final _nameController = TextEditingController();
  final _codeController = TextEditingController();

  @override
  void dispose() {
    _nameController.dispose();
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final serverConfig = context.read<ServerConfigService>();
      final repo = WorkspaceRepository(
        WorkspaceDataSource(baseUrl: serverConfig.url),
      );
      if (_isJoining) {
        final code = _codeController.text.trim().toUpperCase();
        if (code.length != 8) throw Exception('Join code must be 8 characters');
        await repo.join(code);
      } else {
        final name = _nameController.text.trim();
        if (name.isEmpty) throw Exception('Workspace name is required');
        await repo.create(name);
      }
      if (mounted) {
        await context.read<AuthSessionService>().refreshFromServer();
      }
    } catch (e) {
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    } finally {
      if (mounted)
        setState(() {
          _loading = false;
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      backgroundColor: Colors.white,
      body: Center(
        child: SizedBox(
          width: 400,
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Welcome to Rhythm',
                  style: theme.textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Set up your church workspace to get started.',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: const Color(0xFF6B7280),
                  ),
                ),
                const SizedBox(height: 32),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => setState(() => _isJoining = false),
                        style: OutlinedButton.styleFrom(
                          backgroundColor:
                              !_isJoining ? const Color(0xFF4F6AF5) : null,
                          foregroundColor: !_isJoining ? Colors.white : null,
                        ),
                        child: const Text('Create'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => setState(() => _isJoining = true),
                        style: OutlinedButton.styleFrom(
                          backgroundColor:
                              _isJoining ? const Color(0xFF4F6AF5) : null,
                          foregroundColor: _isJoining ? Colors.white : null,
                        ),
                        child: const Text('Join'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                if (!_isJoining) ...[
                  TextField(
                    controller: _nameController,
                    decoration: const InputDecoration(
                      labelText: 'Church / Organization name',
                      border: OutlineInputBorder(),
                    ),
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) => _submit(),
                  ),
                ] else ...[
                  TextField(
                    controller: _codeController,
                    decoration: const InputDecoration(
                      labelText: 'Join code (8 characters)',
                      border: OutlineInputBorder(),
                    ),
                    textCapitalization: TextCapitalization.characters,
                    maxLength: 8,
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) => _submit(),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    _error!,
                    style: const TextStyle(
                      color: Color(0xFFEF4444),
                      fontSize: 13,
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: _loading ? null : _submit,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF4F6AF5),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                  child: _loading
                      ? const SizedBox(
                          height: 18,
                          width: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : Text(
                          _isJoining ? 'Join Workspace' : 'Create Workspace',
                        ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
