import 'package:flutter/material.dart';

@immutable
class RhythmColorRoles extends ThemeExtension<RhythmColorRoles> {
  const RhythmColorRoles({
    required this.canvas,
    required this.surface,
    required this.surfaceMuted,
    required this.surfaceRaised,
    required this.border,
    required this.borderSubtle,
    required this.textPrimary,
    required this.textSecondary,
    required this.textMuted,
    required this.accent,
    required this.accentMuted,
    required this.success,
    required this.warning,
    required this.danger,
    required this.info,
    required this.focusRing,
  });

  final Color canvas;
  final Color surface;
  final Color surfaceMuted;
  final Color surfaceRaised;
  final Color border;
  final Color borderSubtle;
  final Color textPrimary;
  final Color textSecondary;
  final Color textMuted;
  final Color accent;
  final Color accentMuted;
  final Color success;
  final Color warning;
  final Color danger;
  final Color info;
  final Color focusRing;

  static const light = RhythmColorRoles(
    canvas: Color(0xFFF4F1EA),
    surface: Color(0xFFFFFEFC),
    surfaceMuted: Color(0xFFF8F5EF),
    surfaceRaised: Color(0xFFFFFFFF),
    border: Color(0xFFE5DED1),
    borderSubtle: Color(0xFFF0E9DE),
    textPrimary: Color(0xFF1E293B),
    textSecondary: Color(0xFF64748B),
    textMuted: Color(0xFF94A3B8),
    accent: Color(0xFF5F6FE1),
    accentMuted: Color(0x1F5F6FE1),
    success: Color(0xFF10B981),
    warning: Color(0xFFF0B56A),
    danger: Color(0xFFDC5B58),
    info: Color(0xFF3285D9),
    focusRing: Color(0xFF5F6FE1),
  );

  static const dark = RhythmColorRoles(
    canvas: Color(0xFF101216),
    surface: Color(0xFF171A20),
    surfaceMuted: Color(0xFF1E222A),
    surfaceRaised: Color(0xFF252A33),
    border: Color(0xFF353B46),
    borderSubtle: Color(0xFF272C35),
    textPrimary: Color(0xFFF3F6FA),
    textSecondary: Color(0xFFB5BECA),
    textMuted: Color(0xFF7C8796),
    accent: Color(0xFF8C9BFF),
    accentMuted: Color(0x268C9BFF),
    success: Color(0xFF35C98B),
    warning: Color(0xFFF4BF63),
    danger: Color(0xFFFF7A73),
    info: Color(0xFF66B4FF),
    focusRing: Color(0xFFA8B3FF),
  );

  @override
  RhythmColorRoles copyWith({
    Color? canvas,
    Color? surface,
    Color? surfaceMuted,
    Color? surfaceRaised,
    Color? border,
    Color? borderSubtle,
    Color? textPrimary,
    Color? textSecondary,
    Color? textMuted,
    Color? accent,
    Color? accentMuted,
    Color? success,
    Color? warning,
    Color? danger,
    Color? info,
    Color? focusRing,
  }) {
    return RhythmColorRoles(
      canvas: canvas ?? this.canvas,
      surface: surface ?? this.surface,
      surfaceMuted: surfaceMuted ?? this.surfaceMuted,
      surfaceRaised: surfaceRaised ?? this.surfaceRaised,
      border: border ?? this.border,
      borderSubtle: borderSubtle ?? this.borderSubtle,
      textPrimary: textPrimary ?? this.textPrimary,
      textSecondary: textSecondary ?? this.textSecondary,
      textMuted: textMuted ?? this.textMuted,
      accent: accent ?? this.accent,
      accentMuted: accentMuted ?? this.accentMuted,
      success: success ?? this.success,
      warning: warning ?? this.warning,
      danger: danger ?? this.danger,
      info: info ?? this.info,
      focusRing: focusRing ?? this.focusRing,
    );
  }

  @override
  RhythmColorRoles lerp(ThemeExtension<RhythmColorRoles>? other, double t) {
    if (other is! RhythmColorRoles) return this;
    return RhythmColorRoles(
      canvas: Color.lerp(canvas, other.canvas, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      surfaceMuted: Color.lerp(surfaceMuted, other.surfaceMuted, t)!,
      surfaceRaised: Color.lerp(surfaceRaised, other.surfaceRaised, t)!,
      border: Color.lerp(border, other.border, t)!,
      borderSubtle: Color.lerp(borderSubtle, other.borderSubtle, t)!,
      textPrimary: Color.lerp(textPrimary, other.textPrimary, t)!,
      textSecondary: Color.lerp(textSecondary, other.textSecondary, t)!,
      textMuted: Color.lerp(textMuted, other.textMuted, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      accentMuted: Color.lerp(accentMuted, other.accentMuted, t)!,
      success: Color.lerp(success, other.success, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
      info: Color.lerp(info, other.info, t)!,
      focusRing: Color.lerp(focusRing, other.focusRing, t)!,
    );
  }
}

extension RhythmThemeContext on BuildContext {
  RhythmColorRoles get rhythm =>
      Theme.of(this).extension<RhythmColorRoles>() ?? RhythmColorRoles.light;
}

class RhythmSpacing {
  const RhythmSpacing._();

  static const xxs = 4.0;
  static const xs = 8.0;
  static const sm = 12.0;
  static const md = 16.0;
  static const lg = 24.0;
  static const xl = 32.0;
  static const xxl = 48.0;
}

class RhythmRadius {
  const RhythmRadius._();

  static const xs = 6.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 22.0;
  static const pill = 999.0;
}

class RhythmElevation {
  const RhythmElevation._();

  static const panel = [
    BoxShadow(color: Color(0x14000000), blurRadius: 24, offset: Offset(0, 10)),
  ];

  static const raised = [
    BoxShadow(color: Color(0x24000000), blurRadius: 34, offset: Offset(0, 18)),
  ];
}

class RhythmStateLayer {
  const RhythmStateLayer._();

  static const hoverOpacity = 0.08;
  static const pressedOpacity = 0.12;
  static const selectedOpacity = 0.16;
  static const disabledOpacity = 0.38;
}
