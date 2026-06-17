import 'package:flutter/material.dart';

import '../../agent_configs/models/agent_config.dart';

/// The resolved visual identity for an agent session badge.
///
/// Produced by [resolveAgentBadgeIdentity]. Exactly one of two render modes
/// applies:
///   - [config] non-null → render the agent's [AgentConfig] (icon asset +
///     label) — a recognised, mapped agent (claude-code / codex / gemini-cli).
///   - [config] null + [materialIcon] non-null → render a neutral Material
///     [Icon] + [label] — used for the special "OpenRouter" identity when an
///     aggregator session runs a model with no 1:1 agent mapping.
///   - [config] null + [materialIcon] null → label only (truly unknown agent
///     whose config has been deleted).
@immutable
class AgentBadgeIdentity {
  const AgentBadgeIdentity({
    this.config,
    required this.label,
    this.materialIcon,
  });

  /// The resolved agent config, when the identity maps to a known agent.
  final AgentConfig? config;

  /// Display label. Falls back to the kind/agent id when no config is found.
  final String label;

  /// A neutral Material icon to render when [config] is null but the identity
  /// is still recognised (e.g. the aggregator "OpenRouter" identity).
  final IconData? materialIcon;

  /// True when this identity is a recognised agent (has a config) or the
  /// special OpenRouter identity (has a material icon). Used to pick accent vs
  /// muted styling — only a truly-unknown identity (config null + icon null)
  /// is styled as muted.
  bool get isRecognised => config != null || materialIcon != null;
}

/// Resolves the badge identity for a session given its creation [agentId], the
/// session-level [providerId] (the model picker stores the provider name, e.g.
/// 'openai' or 'openrouter'), and the [modelId] (e.g. 'anthropic/claude-opus',
/// 'meta-llama/llama-3.1-70b').
///
/// Precedence:
///   1. [providerId] non-empty AND directly mapped in [providerToAgentKind]
///      (anthropic/github-copilot → claude-code, openai → codex, google →
///      gemini-cli) → that kind. This is the direct-provider path.
///   2. [providerId] non-empty but unmapped (an aggregator like openrouter /
///      together / groq) → derive the kind from the [modelId] family:
///        - family 'anthropic' or contains 'claude'  → claude-code
///        - family 'openai'    or contains 'gpt'      → codex
///        - family 'google'    or contains 'gemini'   → gemini-cli
///        - anything else (llama, deepseek, mistral, qwen, x-ai, …) → the
///          special "OpenRouter" identity (label 'OpenRouter',
///          [Icons.alt_route], no config).
///      If [modelId] is null/empty there is nothing to derive from, so fall
///      back to the creation [agentId] config.
///   3. No [providerId] → kind = [agentId].
///
/// For a resolved kind id, [config] is looked up via [configById]. When the
/// config is found it provides the label and icon; when it is missing the
/// label falls back to the kind id (truly-unknown, muted) — except for the
/// OpenRouter identity which always renders its own label + material icon.
AgentBadgeIdentity resolveAgentBadgeIdentity({
  required String agentId,
  String? providerId,
  String? modelId,
  required Map<String, String> providerToAgentKind,
  required AgentConfig? Function(String id) configById,
}) {
  final hasProvider = providerId != null && providerId.isNotEmpty;

  if (hasProvider) {
    final mappedKind = providerToAgentKind[providerId];
    if (mappedKind != null) {
      // Direct provider → mapped agent kind.
      return _identityForKind(mappedKind, configById);
    }
    // Aggregator / unmapped provider → derive from the model family.
    final family = _familyKindFromModelId(modelId);
    if (family == null) {
      // No model info to derive from — fall back to the creation agentId.
      return _identityForKind(agentId, configById);
    }
    if (family == _openRouterKind) {
      return const AgentBadgeIdentity(
        config: null,
        label: 'OpenRouter',
        materialIcon: Icons.alt_route,
      );
    }
    return _identityForKind(family, configById);
  }

  // No provider id — use the creation agentId.
  return _identityForKind(agentId, configById);
}

/// Sentinel returned by [_familyKindFromModelId] for the OpenRouter-special
/// identity (no 1:1 agent mapping).
const String _openRouterKind = '__openrouter__';

AgentBadgeIdentity _identityForKind(
  String kind,
  AgentConfig? Function(String id) configById,
) {
  final config = configById(kind);
  return AgentBadgeIdentity(
    config: config,
    label: config?.label ?? kind,
  );
}

/// Maps a [modelId] (e.g. 'anthropic/claude-opus-4.7', 'meta-llama/llama-3.1')
/// to an agent kind id, or [_openRouterKind] when no known family matches.
/// Returns null when [modelId] is null/empty (nothing to derive).
String? _familyKindFromModelId(String? modelId) {
  if (modelId == null || modelId.trim().isEmpty) return null;
  final lower = modelId.toLowerCase();
  final slash = lower.indexOf('/');
  final family = slash >= 0 ? lower.substring(0, slash) : lower;

  // Exact family match first.
  switch (family) {
    case 'anthropic':
      return 'claude-code';
    case 'openai':
      return 'codex';
    case 'google':
      return 'gemini-cli';
  }

  // Secondary heuristic on the full model id.
  if (lower.contains('claude')) return 'claude-code';
  if (lower.contains('gpt')) return 'codex';
  if (lower.contains('gemini')) return 'gemini-cli';

  return _openRouterKind;
}
