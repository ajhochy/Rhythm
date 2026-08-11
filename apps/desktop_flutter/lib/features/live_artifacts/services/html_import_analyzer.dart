class HtmlImportAnalysis {
  const HtmlImportAnalysis(this.warnings);

  final List<String> warnings;
}

class HtmlImportAnalyzer {
  static const _allowedHosts = {
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdnjs.cloudflare.com',
    'cdn.jsdelivr.net',
    'unpkg.com',
  };

  static HtmlImportAnalysis analyze(String source) {
    final warnings = <String>[];
    final resources = RegExp(
            r'''<(?:script|link|img|source|video|audio)\b[^>]*(?:href|src)\s*=\s*["'](https?://[^"']+)''',
            caseSensitive: false)
        .allMatches(source)
        .map((match) => Uri.tryParse(match.group(1)!)?.host.toLowerCase())
        .whereType<String>()
        .toList(growable: false);
    if (resources.any((host) => !_allowedHosts.contains(host))) {
      warnings.add('external resources outside allowed hosts');
    }
    final externalScripts = RegExp(
            r'''<script\b[^>]*\bsrc\s*=\s*["'](https?://[^"']+)''',
            caseSensitive: false)
        .allMatches(source)
        .map((match) => Uri.tryParse(match.group(1)!)?.host.toLowerCase());
    if (externalScripts
        .any((host) => host == null || !_allowedHosts.contains(host))) {
      warnings.add('external scripts');
    }
    if (RegExp(r'\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(',
            caseSensitive: false)
        .hasMatch(source)) {
      warnings.add('network requests');
    }
    if (RegExp(r'<(?:iframe|video|audio)\b', caseSensitive: false)
        .hasMatch(source)) {
      warnings.add('embedded frames or media');
    }
    return HtmlImportAnalysis(List.unmodifiable(warnings));
  }
}
