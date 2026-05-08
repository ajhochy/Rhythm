import 'package:flutter/material.dart';

/// Renders the icon for an agent config.
///
/// [iconPath] is the raw value stored in [AgentConfig.icon].
///
/// - If [iconPath] is `'terminal'`, a Material terminal icon is shown.
/// - Otherwise the value is treated as a Flutter asset path and loaded
///   via [Image.asset].
/// - If the asset is missing, or [fallbackLabel] is provided, a colored
///   circle with the first character of [fallbackLabel] is rendered
///   instead.
class AgentIcon extends StatelessWidget {
  const AgentIcon(
    this.iconPath, {
    super.key,
    this.size = 24,
    this.fallbackLabel,
  });

  /// Asset path (e.g. `assets/agents/claude-code.png`) or the sentinel
  /// value `'terminal'`.
  final String iconPath;

  /// Rendered width and height in logical pixels.
  final double size;

  /// Optional label used to generate a fallback avatar when the asset
  /// cannot be loaded.  Only the first character is shown.
  final String? fallbackLabel;

  @override
  Widget build(BuildContext context) {
    if (iconPath == 'terminal') {
      return Icon(Icons.terminal, size: size);
    }

    return Image.asset(
      iconPath,
      width: size,
      height: size,
      errorBuilder: (context, error, stackTrace) => _FallbackAvatar(
        size: size,
        label: fallbackLabel,
      ),
    );
  }
}

class _FallbackAvatar extends StatelessWidget {
  const _FallbackAvatar({required this.size, this.label});

  final double size;
  final String? label;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final initial =
        (label != null && label!.isNotEmpty) ? label![0].toUpperCase() : '?';

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: colorScheme.primaryContainer,
        shape: BoxShape.circle,
      ),
      alignment: Alignment.center,
      child: Text(
        initial,
        style: TextStyle(
          fontSize: size * 0.5,
          fontWeight: FontWeight.bold,
          color: colorScheme.onPrimaryContainer,
        ),
      ),
    );
  }
}
