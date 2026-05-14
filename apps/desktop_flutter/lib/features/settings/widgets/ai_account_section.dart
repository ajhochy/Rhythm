import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../app/core/agents/agent_server_controller.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/ui/tokens/rhythm_theme.dart';

/// Settings section for connecting AI provider accounts.
///
/// Layout:
///   1. Your subscriptions — Claude subscription bridge or API key, Codex/ChatGPT OAuth
///   2. Free API options — Google Gemini (API key), GitHub Copilot (OAuth)
///   3. Custom provider — OpenRouter or any API key
class AiAccountSection extends StatefulWidget {
  const AiAccountSection({super.key});

  @override
  State<AiAccountSection> createState() => _AiAccountSectionState();
}

class _AiAccountSectionState extends State<AiAccountSection> {
  final _apiKeyControllers = <String, TextEditingController>{};
  String? _statusMessage;
  bool _isSaving = false;

  /// State tracking for authorized providers.
  final Set<String> _authorizedProviders = {};

  bool _hasClaudeCode = false;
  bool _hasCodex = false;

  @override
  void initState() {
    super.initState();
    for (final key in ['google', 'openrouter']) {
      _apiKeyControllers[key] = TextEditingController();
    }
    _refreshConnectedProviders();
    _refreshSources();
  }

  @override
  void dispose() {
    for (final c in _apiKeyControllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _refreshConnectedProviders() async {
    try {
      final response = await http.get(
        Uri.parse('${AppConstants.agentLocalBaseUrl}/opencode/auth/'),
      );
      if (!mounted || response.statusCode != 200) return;
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final providers =
          (data['providers'] as List<dynamic>?)?.cast<String>() ?? [];
      setState(() {
        _authorizedProviders
          ..clear()
          ..addAll(providers);
      });
    } catch (_) {
      // ignore — local server may not be ready yet
    }
  }

  Future<void> _refreshSources() async {
    try {
      final res = await http.get(
        Uri.parse('${AppConstants.agentLocalBaseUrl}/opencode/auth/sources'),
      );
      if (!mounted || res.statusCode != 200) return;
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      setState(() {
        _hasClaudeCode = body['claudeCode'] as bool? ?? false;
        _hasCodex = body['codex'] as bool? ?? false;
      });
    } catch (_) {
      /* ignore */
    }
  }

  void _refreshAgentCapabilities() {
    if (mounted) {
      context.read<AgentServerController>().refreshCapabilities();
    }
  }

  Future<void> _authorizeOAuth(String provider) async {
    // GitHub Copilot uses its own device-flow route (Issue F).
    if (provider == 'github-copilot') {
      return _authorizeCopilotDeviceFlow();
    }

    // OpenAI (and any other future "code"-method provider): paste-back.
    // methodIndex=1 = "manual paste-back" flavor of the codex OAuth plugin.
    // methodIndex=0 = the in-process auto variant that doesn't work over HTTP.
    try {
      final response = await http.get(
        Uri.parse(
            '${AppConstants.agentLocalBaseUrl}/opencode/auth/$provider/authorize?method=1'),
      );
      if (!mounted) return;
      if (response.statusCode != 200) {
        String errorDetail = 'HTTP ${response.statusCode}';
        try {
          final errBody = jsonDecode(response.body) as Map<String, dynamic>;
          errorDetail = errBody['error'] as String? ?? errorDetail;
        } catch (_) {/* non-JSON */}
        setState(() => _statusMessage =
            'Failed to start sign-in for $provider: $errorDetail');
        return;
      }
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final authUrl = data['authUrl'] as String?;
      final instructions = data['instructions'] as String? ?? '';
      if (authUrl == null || authUrl.isEmpty) {
        setState(() => _statusMessage = 'No auth URL returned for $provider');
        return;
      }

      final uri = Uri.parse(authUrl);
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      } else {
        setState(() => _statusMessage =
            'Could not open browser. Visit $authUrl manually.');
        return;
      }

      if (!mounted) return;
      final code = await _promptForAuthCode(
        provider: provider,
        instructions: instructions,
      );
      if (code == null || code.isEmpty) {
        setState(() => _statusMessage = 'Sign-in cancelled for $provider');
        return;
      }

      // Complete via methodIndex=1 (matches the URL we started with).
      final callback = await http.get(
        Uri.parse(
            '${AppConstants.agentLocalBaseUrl}/opencode/auth/$provider/callback'
            '?code=${Uri.encodeQueryComponent(code)}&method=1'),
      );
      if (!mounted) return;
      if (callback.statusCode == 200) {
        setState(() {
          _authorizedProviders.add(provider);
          _statusMessage = '✓ $provider connected';
        });
        await _refreshConnectedProviders();
        _refreshAgentCapabilities();
      } else {
        String errorDetail = 'HTTP ${callback.statusCode}';
        try {
          final errBody = jsonDecode(callback.body) as Map<String, dynamic>;
          errorDetail = errBody['error'] as String? ?? errorDetail;
        } catch (_) {/* non-JSON */}
        setState(() =>
            _statusMessage = 'Sign-in failed for $provider: $errorDetail');
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _statusMessage = 'Authorization failed: $e');
    }
  }

  /// Paste-the-code dialog for OAuth providers whose flow lands the user on
  /// a localhost callback URL the user must copy from the browser URL bar
  /// (e.g. OpenAI redirects to http://localhost:1455/auth/callback?code=…).
  Future<String?> _promptForAuthCode({
    required String provider,
    required String instructions,
  }) async {
    final controller = TextEditingController();
    try {
      return await showDialog<String>(
        context: context,
        barrierDismissible: false,
        builder: (ctx) {
          return AlertDialog(
            title: Text('Paste authorization code — $provider'),
            content: SizedBox(
              width: 460,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (instructions.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: SelectableText(
                        instructions,
                        style: const TextStyle(fontSize: 12),
                      ),
                    ),
                  Text(
                    'After signing in, your browser will redirect to a URL '
                    'like http://localhost:1455/auth/callback?code=XXX&state=YYY. '
                    'The page will fail to load — copy the FULL URL from the '
                    'address bar and paste it below (or just the code value).',
                    style: TextStyle(
                      fontSize: 12,
                      color: ctx.rhythm.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: controller,
                    autofocus: true,
                    decoration: const InputDecoration(
                      hintText: 'Paste the full callback URL or code…',
                      isDense: true,
                      border: OutlineInputBorder(),
                    ),
                    onSubmitted: (v) => Navigator.of(ctx).pop(v.trim()),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(null),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.of(ctx).pop(controller.text.trim()),
                child: const Text('Connect'),
              ),
            ],
          );
        },
      );
    } finally {
      controller.dispose();
    }
  }

  // ── GitHub Copilot device flow ──

  Future<void> _authorizeCopilotDeviceFlow() async {
    try {
      final startRes = await http.post(
        Uri.parse(
            '${AppConstants.agentLocalBaseUrl}/opencode/auth/github-copilot/device-start'),
      );
      if (!mounted) return;
      if (startRes.statusCode != 200) {
        String errorDetail = 'HTTP ${startRes.statusCode}';
        try {
          final errBody = jsonDecode(startRes.body) as Map<String, dynamic>;
          errorDetail = errBody['error'] as String? ?? errorDetail;
        } catch (_) {/* non-JSON */}
        setState(() => _statusMessage =
            'Failed to start GitHub Copilot sign-in: $errorDetail');
        return;
      }
      final body = jsonDecode(startRes.body) as Map<String, dynamic>;
      final userCode = body['userCode'] as String? ?? '';
      final verificationUri = body['verificationUri'] as String? ?? '';

      // Open the verification URL in the browser.
      final uri = Uri.parse(verificationUri);
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      }

      if (!mounted) return;
      final ok = await _showCopilotDeviceDialog(
        userCode: userCode,
        verificationUri: verificationUri,
      );
      if (!mounted) return;
      if (ok) {
        setState(() {
          _authorizedProviders.add('github-copilot');
          _statusMessage = '✓ github-copilot connected';
        });
        await _refreshConnectedProviders();
        _refreshAgentCapabilities();
      } else {
        setState(() => _statusMessage =
            'GitHub Copilot sign-in was cancelled or timed out');
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _statusMessage = 'GitHub Copilot sign-in failed: $e');
    }
  }

  Future<bool> _showCopilotDeviceDialog({
    required String userCode,
    required String verificationUri,
  }) async {
    final completer = Completer<bool>();
    Timer? poller;
    Timer? timeout;

    Future<void> stop({required bool result}) async {
      poller?.cancel();
      timeout?.cancel();
      if (!completer.isCompleted) completer.complete(result);
    }

    poller = Timer.periodic(const Duration(seconds: 2), (_) async {
      try {
        final res = await http.get(
          Uri.parse(
              '${AppConstants.agentLocalBaseUrl}/opencode/auth/github-copilot/device-status'),
        );
        if (res.statusCode != 200) return;
        final body = jsonDecode(res.body) as Map<String, dynamic>;
        final status = body['status'] as String?;
        if (status == 'success') {
          await stop(result: true);
          if (mounted) Navigator.of(context, rootNavigator: true).pop();
        } else if (status == 'failed' || status == 'expired') {
          await stop(result: false);
          if (mounted) Navigator.of(context, rootNavigator: true).pop();
        }
      } catch (_) {/* keep polling */}
    });

    timeout = Timer(const Duration(minutes: 10), () async {
      await stop(result: false);
      if (mounted) Navigator.of(context, rootNavigator: true).pop();
    });

    if (!mounted) {
      await stop(result: false);
      return false;
    }
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) {
        return AlertDialog(
          title: const Text('Complete sign-in — github-copilot'),
          content: SizedBox(
            width: 460,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'In your browser, go to:',
                  style: TextStyle(fontSize: 12),
                ),
                const SizedBox(height: 4),
                SelectableText(
                  verificationUri,
                  style: const TextStyle(
                    fontSize: 13,
                    fontFamily: 'Menlo',
                  ),
                ),
                const SizedBox(height: 12),
                const Text(
                  'Then enter this code:',
                  style: TextStyle(fontSize: 12),
                ),
                const SizedBox(height: 4),
                SelectableText(
                  userCode,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                    fontFamily: 'Menlo',
                    letterSpacing: 2,
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  'This dialog will close when the sign-in completes. '
                  'Timeout: 10 minutes.',
                  style: TextStyle(
                    fontSize: 12,
                    color: ctx.rhythm.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () async {
                await stop(result: false);
                if (mounted) {
                  await http.post(Uri.parse(
                      '${AppConstants.agentLocalBaseUrl}/opencode/auth/github-copilot/device-cancel'));
                  if (mounted) Navigator.of(ctx).pop();
                }
              },
              child: const Text('Cancel'),
            ),
          ],
        );
      },
    );
    return completer.future;
  }

  Future<void> _bridgeAnthropic() async {
    setState(() {
      _isSaving = true;
      _statusMessage = null;
    });
    try {
      final res = await http.post(
        Uri.parse(
            '${AppConstants.agentLocalBaseUrl}/opencode/auth/anthropic/bridge'),
      );
      if (!mounted) return;
      if (res.statusCode == 200) {
        final body = jsonDecode(res.body) as Map<String, dynamic>;
        setState(() {
          _authorizedProviders.add('anthropic');
          _statusMessage =
              '✓ Claude connected (${body['subscriptionType'] ?? 'subscription'})';
        });
        await _refreshConnectedProviders();
        _refreshAgentCapabilities();
      } else {
        String reason = 'HTTP ${res.statusCode}';
        try {
          final body = jsonDecode(res.body) as Map<String, dynamic>;
          reason = body['reason'] as String? ?? reason;
        } catch (_) {
          /* non-JSON */
        }
        final friendly = switch (reason) {
          'keychain_denied' =>
            'Keychain access denied. Click "Use Claude subscription" again and choose Allow.',
          'missing' =>
            'Claude Code not detected. Install Claude Code, sign in, then come back.',
          'refresh_failed' =>
            'Could not refresh your Claude tokens. Open Claude Code once to refresh, then retry.',
          'auth_set_rejected' =>
            'Opencode rejected the Claude tokens. Open Claude Code once, then retry.',
          _ => 'Bridge failed: $reason',
        };
        setState(() => _statusMessage = friendly);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _statusMessage = 'Bridge failed: $e');
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Future<void> _saveApiKey(String provider) async {
    final controller = _apiKeyControllers[provider];
    if (controller == null) return;
    final key = controller.text.trim();
    if (key.isEmpty) {
      setState(() => _statusMessage = 'Please enter an API key');
      return;
    }

    setState(() {
      _isSaving = true;
      _statusMessage = null;
    });

    try {
      final response = await http.post(
        Uri.parse('${AppConstants.agentLocalBaseUrl}/opencode/auth/$provider'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'apiKey': key}),
      );

      if (!mounted) return;

      if (response.statusCode == 200) {
        setState(() {
          _statusMessage = '✓ $provider connected';
          controller.clear();
        });
        _refreshAgentCapabilities();
      } else {
        // Guard against non-JSON responses (e.g. HTML 404 from unregistered route)
        String errorMsg = response.reasonPhrase ?? 'Unknown error';
        try {
          final body = jsonDecode(response.body) as Map<String, dynamic>;
          errorMsg = body['error'] as String? ?? errorMsg;
        } catch (_) {
          // Server returned non-JSON — use HTTP status reason
        }
        setState(() {
          _statusMessage = 'Failed: $errorMsg';
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _statusMessage = 'Connection error: $e');
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // ── Section 1: Your subscriptions ──
        _SectionHeader(
            title: 'Your subscriptions',
            subtitle: 'Sign in with your existing account'),
        const SizedBox(height: 10),
        if (_hasClaudeCode)
          _SubscriptionTile(
            label: 'Claude',
            description: 'Use your existing Claude Code subscription',
            connected: _authorizedProviders.contains('anthropic'),
            isSaving: _isSaving,
            onConnect: _bridgeAnthropic,
          )
        else
          _ApiKeyProviderTile(
            provider: 'anthropic',
            label: 'Anthropic API',
            description:
                'Pro/Max subscriptions require Claude Code installed. Paste an API key to use Anthropic without it.',
            hintText: 'Paste your Anthropic API key…',
            controller: _apiKeyControllers.putIfAbsent(
              'anthropic',
              () => TextEditingController(),
            ),
            isSaving: _isSaving,
            onSave: () => _saveApiKey('anthropic'),
            connected: _authorizedProviders.contains('anthropic'),
          ),
        const SizedBox(height: 8),
        _OAuthProviderTile(
          provider: 'openai',
          label: 'Codex / ChatGPT',
          description: 'Sign in with your ChatGPT Plus or Pro account',
          onAuthorize: () => _authorizeOAuth('openai'),
          connected: _authorizedProviders.contains('openai'),
        ),

        const SizedBox(height: 24),

        // ── Section 2: Free API options ──
        _SectionHeader(
            title: 'Free API options', subtitle: 'No credit card required'),
        const SizedBox(height: 10),
        _ApiKeyProviderTile(
          provider: 'google',
          label: 'Google Gemini',
          description: 'Gemini 2.5 Flash — 1,500 free requests/day',
          hintText: 'Paste your Gemini API key from aistudio.google.com',
          controller: _apiKeyControllers['google']!,
          isSaving: _isSaving,
          onSave: () => _saveApiKey('google'),
          connected: _authorizedProviders.contains('google'),
        ),
        const SizedBox(height: 8),
        _OAuthProviderTile(
          provider: 'github-copilot',
          label: 'GitHub Copilot',
          description:
              'Free for verified students, teachers, and OSS maintainers',
          onAuthorize: () => _authorizeOAuth('github-copilot'),
          connected: _authorizedProviders.contains('github-copilot'),
        ),

        const SizedBox(height: 24),

        // ── Section 3: Custom provider ──
        _SectionHeader(
            title: 'Custom provider',
            subtitle: 'OpenRouter, DeepSeek, or any API key'),
        const SizedBox(height: 10),
        _ApiKeyProviderTile(
          provider: 'openrouter',
          label: 'OpenRouter',
          description: 'Access 200+ models — pay-as-you-go or use free models',
          hintText: 'Enter your OpenRouter API key...',
          controller: _apiKeyControllers['openrouter']!,
          isSaving: _isSaving,
          onSave: () => _saveApiKey('openrouter'),
          connected: _authorizedProviders.contains('openrouter'),
        ),

        if (_statusMessage != null)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Text(
              _statusMessage!,
              style: TextStyle(
                fontSize: 12,
                color: _statusMessage!.startsWith('✓')
                    ? context.rhythm.success
                    : context.rhythm.danger,
              ),
            ),
          ),
      ],
    );
  }
}

// ── Section header widget ──

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, this.subtitle});

  final String title;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title.toUpperCase(),
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: context.rhythm.textMuted,
            letterSpacing: 0.8,
          ),
        ),
        if (subtitle != null) ...[
          const SizedBox(height: 2),
          Text(
            subtitle!,
            style: TextStyle(fontSize: 11, color: context.rhythm.textMuted),
          ),
        ],
      ],
    );
  }
}

// ── OAuth provider tile (opens browser) ──

class _OAuthProviderTile extends StatelessWidget {
  const _OAuthProviderTile({
    required this.provider,
    required this.label,
    required this.description,
    required this.onAuthorize,
    this.connected = false,
  });

  final String provider;
  final String label;
  final String description;
  final VoidCallback onAuthorize;
  final bool connected;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: context.rhythm.border),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Text(
                    label,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: context.rhythm.textPrimary,
                    ),
                  ),
                  if (connected) ...[
                    const SizedBox(width: 8),
                    Icon(Icons.check_circle,
                        size: 14, color: context.rhythm.success),
                  ],
                ]),
                const SizedBox(height: 2),
                Text(
                  description,
                  style: TextStyle(
                    fontSize: 11,
                    color: context.rhythm.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          FilledButton(
            onPressed: onAuthorize,
            style: FilledButton.styleFrom(
              backgroundColor: context.rhythm.accent,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: Text(connected ? 'Reconnect' : 'Authorize',
                style: const TextStyle(fontSize: 12)),
          ),
        ],
      ),
    );
  }
}

// ── API key provider tile (text input + save) ──

class _ApiKeyProviderTile extends StatelessWidget {
  const _ApiKeyProviderTile({
    required this.provider,
    required this.label,
    required this.description,
    required this.hintText,
    required this.controller,
    required this.isSaving,
    required this.onSave,
    this.connected = false,
  });

  final String provider;
  final String label;
  final String description;
  final String hintText;
  final TextEditingController controller;
  final bool isSaving;
  final VoidCallback onSave;
  final bool connected;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: context.rhythm.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: context.rhythm.textPrimary,
              ),
            ),
            if (connected) ...[
              const SizedBox(width: 8),
              Icon(Icons.check_circle, size: 14, color: context.rhythm.success),
            ],
          ]),
          const SizedBox(height: 2),
          Text(
            description,
            style: TextStyle(
              fontSize: 11,
              color: context.rhythm.textSecondary,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: controller,
                  obscureText: true,
                  style: TextStyle(
                    fontSize: 12,
                    color: context.rhythm.textPrimary,
                  ),
                  decoration: InputDecoration(
                    hintText: hintText,
                    isDense: true,
                    filled: true,
                    fillColor: context.rhythm.canvas,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(6),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              SizedBox(
                height: 32,
                child: FilledButton(
                  onPressed: isSaving ? null : onSave,
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                  ),
                  child: isSaving
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Text('Save', style: TextStyle(fontSize: 12)),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ── Subscription tile (bridge-based, no code entry) ──

class _SubscriptionTile extends StatelessWidget {
  const _SubscriptionTile({
    required this.label,
    required this.description,
    required this.connected,
    required this.isSaving,
    required this.onConnect,
  });

  final String label;
  final String description;
  final bool connected;
  final bool isSaving;
  final VoidCallback onConnect;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: context.rhythm.border),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Text(
                    label,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: context.rhythm.textPrimary,
                    ),
                  ),
                  if (connected) ...[
                    const SizedBox(width: 8),
                    Icon(Icons.check_circle,
                        size: 14, color: context.rhythm.success),
                  ],
                ]),
                const SizedBox(height: 2),
                Text(
                  description,
                  style: TextStyle(
                    fontSize: 11,
                    color: context.rhythm.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          FilledButton(
            onPressed: isSaving ? null : onConnect,
            style: FilledButton.styleFrom(
              backgroundColor: context.rhythm.accent,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: Text(
              connected ? 'Reconnect' : 'Use Claude subscription',
              style: const TextStyle(fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
}
