/// A single entry from GET /agents/models/catalog (#602).
///
/// Carries the full set of fields the unified picker needs:
///  - which [agent] kind (claude-code, codex, gemini-cli, opencode)
///  - which [provider] (anthropic, openai, github-copilot, google, openrouter …)
///  - whether the provider is [authorized]
///  - a [connectUrl] to open in the browser when not authorized
class CatalogModelEntry {
  const CatalogModelEntry({
    required this.agent,
    required this.provider,
    required this.modelId,
    required this.displayName,
    this.variantLabel,
    required this.route,
    required this.authorized,
    required this.authProvider,
    this.connectUrl,
  });

  /// Agent kind (e.g. 'claude-code', 'codex', 'gemini-cli', 'opencode').
  final String agent;

  /// Provider ID (e.g. 'anthropic', 'openai', 'github-copilot', 'openrouter').
  final String provider;

  /// Model identifier (e.g. 'claude-sonnet-4-6').
  final String modelId;

  /// Human-readable display name (currently same as modelId from server).
  final String displayName;

  /// Optional variant sub-label (e.g. '1M context', 'Legacy', 'Thinking').
  final String? variantLabel;

  /// 'direct' or 'aggregator'.
  final String route;

  /// True when the provider is in the user's authed-providers set.
  final bool authorized;

  /// Canonical provider string for auth (same as [provider] currently).
  final String authProvider;

  /// Relative URL to open in a browser to connect this provider.
  /// Non-null for most rows; may be null if the server has no connect path.
  final String? connectUrl;

  bool get isDirect => route == 'direct';
  bool get isAggregator => route == 'aggregator';

  factory CatalogModelEntry.fromJson(Map<String, dynamic> json) {
    return CatalogModelEntry(
      agent: json['agent'] as String? ?? '',
      provider: json['provider'] as String? ?? '',
      modelId: json['modelId'] as String? ?? '',
      displayName:
          json['displayName'] as String? ?? json['modelId'] as String? ?? '',
      variantLabel: json['variantLabel'] as String?,
      route: json['route'] as String? ?? 'direct',
      authorized: json['authorized'] as bool? ?? false,
      authProvider: json['authProvider'] as String? ?? '',
      connectUrl: json['connectUrl'] as String?,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is CatalogModelEntry &&
      other.provider == provider &&
      other.modelId == modelId &&
      other.route == route;

  @override
  int get hashCode => Object.hash(provider, modelId, route);
}
