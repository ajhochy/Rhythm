class HtmlImportDecomposition {
  const HtmlImportDecomposition({
    required this.html,
    required this.css,
    required this.js,
    required this.droppedExternal,
    required this.notes,
  });

  final String html;
  final String css;
  final String js;
  final List<String> droppedExternal;
  final List<String> notes;
}

class HtmlImportDecomposer {
  static HtmlImportDecomposition decompose(String source) {
    return HtmlImportDecomposition(
      html: source,
      css: '',
      js: '',
      droppedExternal: const [],
      notes: const [],
    );
  }
}
