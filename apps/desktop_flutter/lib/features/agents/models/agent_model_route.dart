/// A single (provider, model, routeKind) entry returned by GET /agents/models.
///
/// [routeKind] is 'direct' when the provider is a first-party account
/// (anthropic, openai, google, github-copilot) and 'aggregator' when
/// the model is reached via an aggregator key (openrouter, together, groq).
///
/// [aggregatorVia] carries the human-readable aggregator name
/// (e.g. 'OpenRouter') and is non-null only when routeKind is 'aggregator'.
class AgentModelRoute {
  const AgentModelRoute({
    required this.providerId,
    required this.modelId,
    required this.routeKind,
    this.aggregatorVia,
    required this.label,
  });

  final String providerId;
  final String modelId;

  /// 'direct' or 'aggregator'.
  final String routeKind;

  /// Non-null when routeKind == 'aggregator'.
  final String? aggregatorVia;

  /// Display string from the server, e.g. "claude-sonnet-4-6 · direct".
  final String label;

  bool get isDirect => routeKind == 'direct';
  bool get isAggregator => routeKind == 'aggregator';

  factory AgentModelRoute.fromJson(Map<String, dynamic> json) {
    return AgentModelRoute(
      providerId: json['providerId'] as String? ?? '',
      modelId: json['modelId'] as String? ?? '',
      routeKind: json['routeKind'] as String? ?? 'direct',
      aggregatorVia: json['aggregatorVia'] as String?,
      label: json['label'] as String? ?? '',
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
