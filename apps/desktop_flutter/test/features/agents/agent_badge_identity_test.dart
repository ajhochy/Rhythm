/// Unit tests for [resolveAgentBadgeIdentity] — the pure, model-family-aware
/// resolver behind the agent session badge.
///
/// BUG: OpenRouter (aggregator) sessions showed the "Claude Code" icon + label
/// for non-Claude models, because providerId='openrouter' is intentionally
/// absent from providerToAgentKind, so resolution fell back to the creation
/// agentId (default 'claude-code'). The resolver now derives identity from the
/// model family when the provider is an aggregator.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/agent_configs/models/agent_config.dart';
import 'package:rhythm_desktop/features/agents/views/agent_badge_identity.dart';

// Configs keyed by canonical agent id.
final _claude = AgentConfig(
  id: 'claude-code',
  label: 'Claude Code',
  icon: 'terminal',
  enabled: true,
  isAgent: true,
  sortOrder: 0,
);
final _codex = AgentConfig(
  id: 'codex',
  label: 'Codex',
  icon: 'terminal',
  enabled: true,
  isAgent: true,
  sortOrder: 1,
);
final _gemini = AgentConfig(
  id: 'gemini-cli',
  label: 'Gemini CLI',
  icon: 'terminal',
  enabled: true,
  isAgent: true,
  sortOrder: 2,
);

final _configs = {
  'claude-code': _claude,
  'codex': _codex,
  'gemini-cli': _gemini,
};

AgentConfig? _byId(String id) => _configs[id];

// Mirrors the real AgentServerController offline defaults — aggregators
// (openrouter/together/groq) are intentionally absent.
const _providerToAgentKind = <String, String>{
  'anthropic': 'claude-code',
  'github-copilot': 'claude-code',
  'openai': 'codex',
  'google': 'gemini-cli',
};

AgentBadgeIdentity _resolve({
  String agentId = 'claude-code',
  String? providerId,
  String? modelId,
}) {
  return resolveAgentBadgeIdentity(
    agentId: agentId,
    providerId: providerId,
    modelId: modelId,
    providerToAgentKind: _providerToAgentKind,
    configById: _byId,
  );
}

void main() {
  group('direct provider mapping', () {
    test('anthropic → claude-code config', () {
      final id = _resolve(providerId: 'anthropic');
      expect(id.config, same(_claude));
      expect(id.label, 'Claude Code');
      expect(id.materialIcon, isNull);
    });

    test('openai → codex config', () {
      final id = _resolve(providerId: 'openai');
      expect(id.config, same(_codex));
      expect(id.label, 'Codex');
    });

    test('google → gemini-cli config', () {
      final id = _resolve(providerId: 'google');
      expect(id.config, same(_gemini));
      expect(id.label, 'Gemini CLI');
    });
  });

  group('aggregator (openrouter) → model-family derivation', () {
    test('anthropic/claude model → Claude Code config', () {
      final id = _resolve(
        agentId: 'claude-code',
        providerId: 'openrouter',
        modelId: 'anthropic/claude-opus-4.7',
      );
      expect(id.config, same(_claude));
      expect(id.label, 'Claude Code');
      expect(id.materialIcon, isNull);
    });

    test('meta-llama model → OpenRouter special identity', () {
      final id = _resolve(
        agentId: 'claude-code',
        providerId: 'openrouter',
        modelId: 'meta-llama/llama-3.1-70b',
      );
      expect(id.config, isNull);
      expect(id.label, 'OpenRouter');
      expect(id.materialIcon, Icons.alt_route);
      expect(id.isRecognised, isTrue);
    });

    test('deepseek model → OpenRouter special identity', () {
      final id = _resolve(
        providerId: 'openrouter',
        modelId: 'deepseek/deepseek-r1',
      );
      expect(id.config, isNull);
      expect(id.label, 'OpenRouter');
      expect(id.materialIcon, Icons.alt_route);
    });

    test('openai/gpt model → codex config', () {
      final id = _resolve(
        providerId: 'openrouter',
        modelId: 'openai/gpt-4o',
      );
      expect(id.config, same(_codex));
      expect(id.label, 'Codex');
    });

    test('google/gemini model → gemini-cli config', () {
      final id = _resolve(
        providerId: 'openrouter',
        modelId: 'google/gemini-2.0-flash',
      );
      expect(id.config, same(_gemini));
      expect(id.label, 'Gemini CLI');
    });

    test('null modelId falls back to creation agentId config', () {
      final id = _resolve(
        agentId: 'codex',
        providerId: 'openrouter',
        modelId: null,
      );
      expect(id.config, same(_codex));
      expect(id.label, 'Codex');
    });

    test('empty modelId falls back to creation agentId config', () {
      final id = _resolve(
        agentId: 'claude-code',
        providerId: 'together',
        modelId: '',
      );
      expect(id.config, same(_claude));
    });

    test('secondary heuristic: family unknown but id contains claude', () {
      final id = _resolve(
        providerId: 'openrouter',
        modelId: 'some-vendor/claude-clone-v2',
      );
      expect(id.config, same(_claude));
    });

    test('mistral/qwen/x-ai families → OpenRouter', () {
      for (final m in [
        'mistralai/mistral-large',
        'qwen/qwen-2.5',
        'x-ai/grok-2'
      ]) {
        final id = _resolve(providerId: 'groq', modelId: m);
        expect(id.label, 'OpenRouter', reason: 'modelId=$m');
        expect(id.materialIcon, Icons.alt_route, reason: 'modelId=$m');
      }
    });
  });

  group('no providerId → creation agentId', () {
    test('agentId codex → codex config', () {
      final id = _resolve(agentId: 'codex', providerId: null);
      expect(id.config, same(_codex));
      expect(id.label, 'Codex');
    });

    test('empty providerId treated as absent', () {
      final id = _resolve(agentId: 'gemini-cli', providerId: '');
      expect(id.config, same(_gemini));
    });
  });

  group('unknown / deleted config', () {
    test('agentId with no config → label is the id, muted (not recognised)',
        () {
      final id = _resolve(agentId: 'ghost-agent', providerId: null);
      expect(id.config, isNull);
      expect(id.materialIcon, isNull);
      expect(id.label, 'ghost-agent');
      expect(id.isRecognised, isFalse);
    });
  });
}
