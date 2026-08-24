class AutoPromotionSettingsState {
  const AutoPromotionSettingsState({
    required this.availability,
    required this.autoPromotionEnabled,
    required this.enabledAt,
    required this.autoPromotionEligible,
    required this.totalVerified,
    required this.totalRegressions,
    required this.trustThreshold,
  });

  final bool availability;
  final bool autoPromotionEnabled;
  final String? enabledAt;
  final bool autoPromotionEligible;
  final int totalVerified;
  final int totalRegressions;
  final int trustThreshold;

  factory AutoPromotionSettingsState.fromJson(Map<String, dynamic> json) {
    final state = json['state'] as Map<String, dynamic>;
    return AutoPromotionSettingsState(
      availability: json['availability'] == true,
      autoPromotionEnabled: state['autoPromotionEnabled'] == true,
      enabledAt: state['enabledAt'] as String?,
      autoPromotionEligible: state['autoPromotionEligible'] == true,
      totalVerified: (state['totalVerified'] as num?)?.toInt() ?? 0,
      totalRegressions: (state['totalRegressions'] as num?)?.toInt() ?? 0,
      trustThreshold: (state['trustThreshold'] as num?)?.toInt() ?? 0,
    );
  }
}
