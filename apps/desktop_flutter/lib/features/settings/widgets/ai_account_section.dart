import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';

import '../../../app/core/agents/agent_server_controller.dart';
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

  @override
  void initState() {
    super.initState();
    for (final key in ['google', 'openrouter']) {
      _apiKeyControllers[key] = TextEditingController();
    }
  }

  @override
  void dispose() {
    for (final c in _apiKeyControllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _authorizeOAuth(String provider) async {
    // Attempt to open the OAuth URL. In a full implementation this would
    // open the system browser, the user authorizes, and a callback endpoint
    // on the Opencode engine receives the token.
    final url = '${AppConstants.agentLocalBaseUrl}/opencode/auth/$provider/authorize';
    try {
      final response = await http.get(Uri.parse(url));
      if (!mounted) return;
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        final authUrl = data['authUrl'] as String?;
        setState(() {
          _statusMessage = 'Open $authUrl in your browser to authorize $provider';
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _statusMessage = 'Failed to start authorization: $e');
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
        final body = jsonDecode(response.body) as Map<String, dynamic>;
        setState(() {
          _statusMessage = 'Failed: ${body['error'] ?? response.reasonPhrase}';
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
        _SectionHeader(title: 'Your subscriptions', subtitle: 'Sign in with your existing account'),
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
        _SectionHeader(title: 'Free API options', subtitle: 'No credit card required'),
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
          description: 'Free for verified students, teachers, and OSS maintainers',
          onAuthorize: () => _authorizeOAuth('github-copilot'),
        ),

        const SizedBox(height: 24),

        // ── Section 3: Custom provider ──
        _SectionHeader(title: 'Custom provider', subtitle: 'OpenRouter, DeepSeek, or any API key'),
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
                          width: 14, height: 14,
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
