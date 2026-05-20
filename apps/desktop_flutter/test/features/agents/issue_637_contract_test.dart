/// Acceptance contract for issue #637 — curated OpenRouter visibility
/// inconsistent: client default-flip.
///
/// c2 (client default): `_OpenRouterModelsSection._isVisible(modelId)` must
/// default to `false` when no row exists in the visibility map. Today it
/// defaults to `true` (line 80 of _open_router_models_section.dart):
///
///   bool _isVisible(String modelId) => _visibilityMap[modelId] ?? true;
///
/// The fix is changing `?? true` to `?? false`.
///
/// THIS TEST MUST FAIL before the fix and PASS after.
///
/// Strategy: read the source file and assert the production default is `false`.
/// This is the most direct way to confirm the one-line fix without mounting a
/// full widget tree.
library;

import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;

void main() {
  group('issue-637-c2: visibility map default must be false for unknown models',
      () {
    test(
      '_isVisible in _open_router_models_section.dart must use ?? false, '
      'not ?? true (THIS FAILS before the fix)',
      () {
        // Locate the source file relative to this test file.
        // __FILE__ isn't available in Dart; use the known repo-relative path.
        const relPath =
            'lib/features/agents/views/_open_router_models_section.dart';
        final projectDir = Directory.current.path.endsWith('test')
            ? p.dirname(Directory.current.path)
            : Directory.current.path;
        final srcPath = p.join(projectDir, relPath);
        final src = File(srcPath).readAsStringSync();

        // CONTRACT ASSERTION — must fail before implementation.
        //
        // After the fix the line must read:
        //   bool _isVisible(String modelId) => _visibilityMap[modelId] ?? false;
        //
        // Before the fix the line reads:
        //   bool _isVisible(String modelId) => _visibilityMap[modelId] ?? true;
        //
        // We assert the correct form is present. If the bug is still there,
        // this assertion fails because only the buggy form (`?? true`) exists.
        expect(
          src.contains('_visibilityMap[modelId] ?? false'),
          isTrue,
          reason:
              '_isVisible must default to false so checkboxes start unchecked '
              'on fresh install. Found the buggy default "?? true" instead. '
              'Fix: change line 80 of _open_router_models_section.dart from '
              '"?? true" to "?? false".',
        );
      },
    );

    test(
      'the buggy ?? true default is not present after the fix',
      () {
        // Companion assertion: once the fix lands, the old form disappears.
        // This test will PASS before the fix (it is not a failing assertion)
        // and must continue to pass after. It documents the removal.
        //
        // NOTE: This test passes both before AND after the fix — it is a
        // documentation guard, not a blocking assertion.
        // The blocking assertion is the sibling test above.
        const relPath =
            'lib/features/agents/views/_open_router_models_section.dart';
        final projectDir = Directory.current.path.endsWith('test')
            ? p.dirname(Directory.current.path)
            : Directory.current.path;
        final srcPath = p.join(projectDir, relPath);
        final src = File(srcPath).readAsStringSync();

        // After fix: ?? true must not appear in _isVisible context.
        // We check the specific _isVisible line rather than the whole file
        // to avoid false positives from comments.
        final isVisibleLine = src
            .split('\n')
            .where((line) =>
                line.contains('_isVisible') && line.contains('_visibilityMap'))
            .join('\n');

        expect(
          isVisibleLine.contains('?? true'),
          isFalse,
          reason: 'The _isVisible method still uses "?? true" (buggy default). '
              'Change it to "?? false".',
        );
      },
    );
  });
}
