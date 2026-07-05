/// Models for the per-provider "Usage Budget" tracker (GET /agents/usage-budget).
///
/// Mirrors the api_server `usage_budget_service` shapes. All values are real
/// provider data; `kind == 'unavailable'` means no usable usage API for that
/// provider (e.g. OpenAI's ChatGPT-plan token).
///
/// #907 — `providers` is NOT one-entry-per-provider-string: a user with
/// multiple connected Anthropic accounts gets one 'anthropic' entry PER
/// account (distinguished by `accountId` + a per-account `label`), so every
/// connected account's gauges render simultaneously.
library;

class UsageBudgetItem {
  const UsageBudgetItem({
    required this.label,
    this.remainingFraction,
    this.resetAt,
    this.detail,
  });

  /// A model id, an account label, or a window name ('5h limit', 'weekly').
  final String label;

  /// Fraction REMAINING, 0..1. Null when the provider exposes no ceiling.
  final double? remainingFraction;

  /// Reset time (ISO-8601) for this bucket/window, when known.
  final DateTime? resetAt;

  /// Secondary detail, e.g. "$0.04 / $10" or a window status.
  final String? detail;

  factory UsageBudgetItem.fromJson(Map<String, dynamic> json) {
    final reset = json['resetAt'] as String?;
    return UsageBudgetItem(
      label: json['label'] as String? ?? '',
      remainingFraction: (json['remainingFraction'] as num?)?.toDouble(),
      resetAt: (reset != null) ? DateTime.tryParse(reset) : null,
      detail: json['detail'] as String?,
    );
  }
}

class UsageBudgetProvider {
  const UsageBudgetProvider({
    required this.provider,
    required this.label,
    required this.kind,
    required this.items,
    this.reason,
    this.accountId,
  });

  final String provider; // gemini | openrouter | anthropic | openai
  final String label;
  final String kind; // quota | credits | window | unavailable
  final List<UsageBudgetItem> items;
  final String? reason;

  /// #907 — present only for 'anthropic' entries. A connected user can have
  /// multiple Anthropic accounts; each gets its own provider entry in the
  /// snapshot (see UsageBudgetSnapshot doc) rather than one merged entry, so
  /// this panel already renders one block per account with no extra code.
  final String? accountId;

  bool get isUnavailable => kind == 'unavailable';

  factory UsageBudgetProvider.fromJson(Map<String, dynamic> json) {
    final rawItems = json['items'] as List<dynamic>? ?? const [];
    return UsageBudgetProvider(
      provider: json['provider'] as String? ?? '',
      label: json['label'] as String? ?? '',
      kind: json['kind'] as String? ?? 'unavailable',
      items: rawItems
          .map((e) => UsageBudgetItem.fromJson(e as Map<String, dynamic>))
          .toList(),
      reason: json['reason'] as String?,
      accountId: json['accountId'] as String?,
    );
  }
}

class UsageBudgetSnapshot {
  const UsageBudgetSnapshot({required this.providers, this.fetchedAt});

  final List<UsageBudgetProvider> providers;
  final DateTime? fetchedAt;

  factory UsageBudgetSnapshot.fromJson(Map<String, dynamic> json) {
    final raw = json['providers'] as List<dynamic>? ?? const [];
    final fetched = json['fetchedAt'] as String?;
    return UsageBudgetSnapshot(
      providers: raw
          .map((e) => UsageBudgetProvider.fromJson(e as Map<String, dynamic>))
          .toList(),
      fetchedAt: (fetched != null) ? DateTime.tryParse(fetched) : null,
    );
  }
}
