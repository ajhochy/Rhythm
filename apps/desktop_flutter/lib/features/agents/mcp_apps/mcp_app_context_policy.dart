import 'dart:convert';

/// Fail-closed policy for the currently unsupported app-to-agent context path.
///
/// A future UI may call [evaluate] only after a human confirmation. Until that
/// UI also persists the returned taint record and inserts [untrustedFence], the
/// application must keep context updates unwired.
abstract final class McpAppContextPolicy {
  static const maxContextBytes = 16 * 1024;
  static const untrustedFence =
      '<untrusted-mcp-app-context>\n{{content}}\n</untrusted-mcp-app-context>';

  static McpAppContextDecision evaluate({
    required String content,
    required bool confirmed,
    required String mode,
  }) {
    if (mode != 'interactive') {
      return const McpAppContextDecision.denied('interactive_required');
    }
    if (!confirmed) {
      return const McpAppContextDecision.denied('confirmation_required');
    }
    if (content.isEmpty || utf8.encode(content).length > maxContextBytes) {
      return const McpAppContextDecision.denied('context_bounds');
    }
    final scan = content.toLowerCase();
    const blocked = [
      'ignore previous instructions',
      'system prompt',
      '<script',
      'javascript:',
      'file://',
      'http://localhost',
      'http://127.0.0.1',
    ];
    if (blocked.any(scan.contains)) {
      return const McpAppContextDecision.denied('scan_rejected');
    }
    final taint = McpAppContextTaint(
      source: 'mcp_app',
      classification: 'external_untrusted',
      bytes: utf8.encode(content).length,
    );
    return McpAppContextDecision.allowed(
      untrustedFence.replaceFirst('{{content}}', content),
      taint,
    );
  }
}

final class McpAppContextTaint {
  const McpAppContextTaint({
    required this.source,
    required this.classification,
    required this.bytes,
  });

  final String source;
  final String classification;
  final int bytes;
}

final class McpAppContextDecision {
  const McpAppContextDecision.allowed(this.fencedContent, this.taint)
      : reason = null;
  const McpAppContextDecision.denied(this.reason)
      : fencedContent = null,
        taint = null;

  final String? fencedContent;
  final McpAppContextTaint? taint;
  final String? reason;
  bool get isAllowed => reason == null;
}
