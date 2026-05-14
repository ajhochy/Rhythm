import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';
import 'dart:convert';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../../app/core/constants/app_constants.dart';

/// Settings section for connecting AI provider accounts.
///
/// Layout:
///   1. Your subscriptions — Claude OAuth, Codex/ChatGPT OAuth
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

  @override
  void initState() {
    super.initState();
    for (final key in ['google', 'openrouter']) {
      _apiKeyControllers[key] = TextEditingController();
    }
    _refreshConnectedProviders();
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

  Future<void> _authorizeOAuth(String provider) async {
    // The Opencode SDK uses an out-of-band OAuth flow: it returns a URL that
    // sends the user to the provider's login, which redirects to
    // https://opencode.ai/auth/<provider>?code=... where the user can read
    // the code. The user pastes the code back here and we hand it to
    // `provider.oauth.callback` via /opencode/auth/<provider>/callback.
    try {
      final response = await http.get(
        Uri.parse(
            '${AppConstants.agentLocalBaseUrl}/opencode/auth/$provider/authorize'),
      );
      if (!mounted) return;
      if (response.statusCode != 200) {
        String errorDetail = 'HTTP ${response.statusCode}';
        try {
          final errBody = jsonDecode(response.body) as Map<String, dynamic>;
          errorDetail = errBody['error'] as String? ?? errorDetail;
        } catch (_) {
          /* non-JSON response */
        }
        setState(() => _statusMessage =
            'Failed to get auth URL for $provider: $errorDetail');
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
        authUrl: authUrl,
      );
      if (code == null || code.isEmpty) {
        // User cancelled — leave _authorizedProviders unchanged.
        setState(
            () => _statusMessage = 'Authorization cancelled for $provider');
        return;
      }

      // Hand the code to the Opencode SDK's provider.oauth.callback.
      final callback = await http.get(
        Uri.parse('${AppConstants.agentLocalBaseUrl}/opencode/auth/'
            '$provider/callback?code=${Uri.encodeQueryComponent(code)}'),
      );
      if (!mounted) return;
      if (callback.statusCode == 200) {
        setState(() {
          _authorizedProviders.add(provider);
          _statusMessage = '✓ $provider connected';
        });
        await _refreshConnectedProviders();
      } else {
        String errorDetail = 'HTTP ${callback.statusCode}';
        try {
          final errBody = jsonDecode(callback.body) as Map<String, dynamic>;
          errorDetail = errBody['error'] as String? ?? errorDetail;
        } catch (_) {
          /* non-JSON */
        }
        setState(() => _statusMessage =
            'Authorization failed for $provider: $errorDetail');
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _statusMessage = 'Authorization failed: $e');
    }
  }

  /// Shows a paste-the-code dialog. Returns the trimmed code or null if the
  /// user cancelled.
  Future<String?> _promptForAuthCode({
    required String provider,
    required String instructions,
    required String authUrl,
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
              width: 420,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (instructions.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Text(
                        instructions,
                        style: const TextStyle(fontSize: 12),
                      ),
                    ),
                  Text(
                    'After signing in, the browser will show an authorization '
                    'code. Paste it below.',
                    style: TextStyle(
                      fontSize: 12,
                      color: context.rhythm.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: controller,
                    autofocus: true,
                    decoration: const InputDecoration(
                      hintText: 'Paste the authorization code…',
                      isDense: true,
                      border: OutlineInputBorder(),
                    ),
                    onSubmitted: (value) => Navigator.of(ctx).pop(value.trim()),
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
        _OAuthProviderTile(
          provider: 'anthropic',
          label: 'Claude',
          description: 'Sign in with your Claude Pro or Max account',
          onAuthorize: () => _authorizeOAuth('anthropic'),
        ),
        const SizedBox(height: 8),
        _OAuthProviderTile(
          provider: 'openai',
          label: 'Codex / ChatGPT',
          description: 'Sign in with your ChatGPT Plus or Pro account',
          onAuthorize: () => _authorizeOAuth('openai'),
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
        ),
        const SizedBox(height: 8),
        _OAuthProviderTile(
          provider: 'github-copilot',
          label: 'GitHub Copilot',
          description:
              'Free for verified students, teachers, and OSS maintainers',
          onAuthorize: () => _authorizeOAuth('github-copilot'),
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
  });

  final String provider;
  final String label;
  final String description;
  final VoidCallback onAuthorize;

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
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: context.rhythm.textPrimary,
                  ),
                ),
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
            child: const Text('Authorize', style: TextStyle(fontSize: 12)),
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
  });

  final String provider;
  final String label;
  final String description;
  final String hintText;
  final TextEditingController controller;
  final bool isSaving;
  final VoidCallback onSave;

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
          Text(
            label,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: context.rhythm.textPrimary,
            ),
          ),
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
