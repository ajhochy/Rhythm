/// Regression contract: curating an OpenRouter model must refresh the catalog
/// the composer model picker actually reads.
///
/// Bug: `_setVisible` in _open_router_models_section.dart called
/// `refreshModelRoutes()` after saving visibility. But the unified composer
/// picker (_unified_agent_model_picker.dart) reads `AgentsController.catalog`
/// (GET /agents/models/catalog), which is only updated by `refreshCatalog()`.
/// So a curated model was persisted server-side (and returned by the catalog
/// endpoint) but never appeared in the picker until an app restart —
/// "selected models in the browser do not show up in the model picker."
///
/// This source-level assertion mirrors the issue-637 contract convention for
/// this file (mounting the section runs real HTTP via its internal data
/// source, so a string contract is the pragmatic guard).
///
/// MUST FAIL before the fix (only refreshModelRoutes present in _setVisible)
/// and PASS after (refreshCatalog present).
library;

import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;

void main() {
  test(
    'curating visibility calls refreshCatalog (the source the unified picker '
    'reads), not only refreshModelRoutes',
    () {
      const relPath =
          'lib/features/agents/views/_open_router_models_section.dart';
      final projectDir = Directory.current.path.endsWith('test')
          ? p.dirname(Directory.current.path)
          : Directory.current.path;
      final src = File(p.join(projectDir, relPath)).readAsStringSync();

      // The visibility-save path must refresh the cross-agent catalog so the
      // unified composer picker reflects the curation immediately.
      expect(
        src.contains('refreshCatalog('),
        isTrue,
        reason: 'After saving OpenRouter visibility, the section must call '
            'AgentsController.refreshCatalog() so the unified model picker '
            '(which reads controller.catalog) shows the curated model. '
            'refreshModelRoutes() alone updates a different list and leaves '
            'curated models missing from the picker until app restart.',
      );
    },
  );
}
