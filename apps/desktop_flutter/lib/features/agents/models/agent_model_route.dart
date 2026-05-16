/// A single (provider, model, routeKind) entry returned by GET /agents/models.
///
/// [routeKind] is 'direct' when the provider is a first-party account
/// (anthropic, openai, google, github-copilot) and 'aggregator' when
/// the model is reached via an aggregator key (openrouter, together, groq).
///
/// [aggregatorVia] carries the human-readable aggregator name
/// (e.g. 'OpenRouter') and is non-null only when routeKind is 'aggregator'.
///
/// [variantLabel] is an optional sub-label for variant model IDs, e.g.
/// "1M context" or "Legacy".
class AgentModelRoute {
  const AgentModelRoute({
    required this.providerId,
    required this.modelId,
    required this.routeKind,
    this.aggregatorVia,
    required this.label,
    this.variantLabel,
  });

  final String providerId;
  final String modelId;

  /// 'direct' or 'aggregator'.
  final String routeKind;

  /// Non-null when routeKind == 'aggregator'.
  final String? aggregatorVia;

  /// Display string from the server, e.g. "claude-sonnet-4-6 · direct".
  final String label;

  /// Optional variant sub-label, e.g. "1M context", "Legacy", "Thinking".
  final String? variantLabel;

  bool get isDirect => routeKind == 'direct';
  bool get isAggregator => routeKind == 'aggregator';

  factory AgentModelRoute.fromJson(Map<String, dynamic> json) {
    return AgentModelRoute(
      providerId: json['providerId'] as String? ?? '',
      modelId: json['modelId'] as String? ?? '',
      routeKind: json['routeKind'] as String? ?? 'direct',
      aggregatorVia: json['aggregatorVia'] as String?,
      label: json['label'] as String? ?? '',
      variantLabel: json['variantLabel'] as String?,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is AgentModelRoute &&
      other.providerId == providerId &&
      other.modelId == modelId &&
      other.routeKind == routeKind;

  @override
  int get hashCode => Object.hash(providerId, modelId, routeKind);
}

// ---------------------------------------------------------------------------
// Visibility model for Issue #609
// ---------------------------------------------------------------------------

/// A visibility entry from GET /agent-models/visibility.
class AgentModelVisibility {
  const AgentModelVisibility({
    required this.provider,
    required this.modelId,
    required this.visible,
  });

  final String provider;
  final String modelId;
  final bool visible;

  factory AgentModelVisibility.fromJson(Map<String, dynamic> json) {
    return AgentModelVisibility(
      provider: json['provider'] as String? ?? '',
      modelId: json['modelId'] as String? ?? '',
      visible: json['visible'] as bool? ?? true,
    );
  }
}

/// A trimmed OpenRouter model entry from GET /opencode/models?provider=openrouter.
class OpenRouterModelEntry {
  const OpenRouterModelEntry({
    required this.id,
    required this.name,
    this.contextLength,
    this.pricingPrompt,
    this.pricingCompletion,
  });

  final String id;
  final String name;
  final int? contextLength;
  final String? pricingPrompt;
  final String? pricingCompletion;

  factory OpenRouterModelEntry.fromJson(Map<String, dynamic> json) {
    final pricing = json['pricing'] as Map<String, dynamic>?;
    return OpenRouterModelEntry(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      contextLength: json['context_length'] as int?,
      pricingPrompt: pricing?['prompt'] as String?,
      pricingCompletion: pricing?['completion'] as String?,
    );
  }
}
