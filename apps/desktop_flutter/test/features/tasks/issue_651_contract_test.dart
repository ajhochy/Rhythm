/// Acceptance contract for issue #651 — Collaborator add/remove fails silently
/// with no error UI.
///
/// MECHANISM
/// ---------
/// Both production collaborator entry points wrapped their network call in
/// `try { ... } finally { ... }` with NO catch clause. When the underlying
/// `CollaboratorsDataSource.addToTask` (or sibling) threw an `AppError` from
/// `assertOk` because the server returned 4xx/5xx, the exception propagated
/// as an unhandled async error — invisible in a release build.
///
/// FOUR ENTRY POINTS (all four must show a SnackBar on failure):
///   1. CollaboratorsRow._showPeoplePicker          (collaborators_row.dart)
///   2. CollaboratorsRow long-press onRemove        (collaborators_row.dart)
///   3. _RhythmTaskInspectorState._showPeoplePicker (rhythm_inspector.dart)
///   4. _RhythmTaskInspectorState._removeCollaborator (rhythm_inspector.dart)
///
/// FIX:
///   Wrap each await in try / catch / surface via
///   ScaffoldMessenger.showSnackBar so the user (and we) see what actually
///   failed. The loading spinner state must still be cleared on error.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
// OPC-M1-3: agent_bubble_overlay.dart deleted; c6/c7 tests removed.
import 'package:rhythm_desktop/app/core/agents/agent_trigger_watcher.dart'
    show computeIsLocalSmokeRun;
import 'package:rhythm_desktop/app/core/auth/auth_data_source.dart';
import 'package:rhythm_desktop/app/core/auth/auth_session_service.dart';
import 'package:rhythm_desktop/app/core/auth/auth_user.dart';
import 'package:rhythm_desktop/app/core/errors/app_error.dart';
import 'package:rhythm_desktop/app/core/ui/rhythm_inspector.dart';
import 'package:rhythm_desktop/app/core/workspace/workspace_models.dart';
// OPC-M1-3: AgentSessionMessage import removed (only used in deleted c7 test).
import 'package:rhythm_desktop/features/tasks/models/task.dart';
import 'package:rhythm_desktop/features/tasks/models/task_collaborator.dart';
import 'package:rhythm_desktop/shared/widgets/collaborators_row.dart';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const _ownerId = 42;
const _visaliaCrcUserId = 7;
const _existingCollabUserId = 99;

final _workspace = [
  const WorkspaceMember(
    userId: _ownerId,
    name: 'Owner',
    email: 'owner@example.com',
    role: 'admin',
    joinedAt: '2026-01-01',
  ),
  const WorkspaceMember(
    userId: _visaliaCrcUserId,
    name: 'Visalia CRC',
    email: 'visalia@example.com',
    role: 'member',
    joinedAt: '2026-01-01',
  ),
  const WorkspaceMember(
    userId: _existingCollabUserId,
    name: 'Existing Collab',
    email: 'existing@example.com',
    role: 'member',
    joinedAt: '2026-01-01',
  ),
];

class _FakeAuthSessionService extends AuthSessionService {
  _FakeAuthSessionService(this._user)
    : super(AuthDataSource(baseUrl: 'http://example.invalid'));

  final AuthUser _user;

  @override
  AuthUser? get currentUser => _user;
}

void _installFakeOwnerSession() {
  _FakeAuthSessionService(
    const AuthUser(
      id: _ownerId,
      name: 'Owner',
      email: 'owner@example.com',
      role: 'admin',
    ),
  );
}

Task _buildTask({List<TaskCollaborator> collaborators = const []}) {
  return Task(
    id: 'task-1',
    title: 'Find subs for any remaining gaps',
    status: TaskStatus.open,
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
    ownerId: _ownerId,
    collaborators: collaborators,
  );
}

Widget _wrapForTest(Widget child) {
  return MaterialApp(home: Scaffold(body: child));
}

/// Consume any layout-overflow (or other non-assertion) errors that the
/// inspector's complex dialog body emits during the test pump cycle. The
/// regression we are pinning is the SnackBar surfacing, not the dialog
/// chrome; the layout warnings would otherwise mask the real assertion.
void _drainLayoutOverflowErrors() {
  Object? error;
  do {
    error = TestWidgetsFlutterBinding.instance.takeException();
  } while (error != null);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(_installFakeOwnerSession);

  group('CollaboratorsRow', () {
    testWidgets(
      'issue-651-c1: CollaboratorsRow surfaces onAdd AppError as a SnackBar',
      (tester) async {
        await tester.binding.setSurfaceSize(const Size(1200, 800));
        addTearDown(() => tester.binding.setSurfaceSize(null));

        const errorMessage = 'Request failed (HTTP 404).';
        late int onAddCalledWith;
        Future<void> onAdd(int userId) async {
          onAddCalledWith = userId;
          throw AppError(errorMessage, statusCode: 404);
        }

        await tester.pumpWidget(
          _wrapForTest(
            CollaboratorsRow(
              collaborators: const [],
              ownerId: _ownerId,
              workspaceMembers: _workspace,
              onAdd: onAdd,
              onRemove: (_) async {},
            ),
          ),
        );

        // Tap the "+ collaborator" icon button.
        await tester.tap(find.byTooltip('Add collaborator'));
        await tester.pumpAndSettle();

        // Pick "Visalia CRC" from the SimpleDialog candidates.
        await tester.tap(find.text('Visalia CRC').last);
        await tester.pumpAndSettle();

        expect(
          onAddCalledWith,
          _visaliaCrcUserId,
          reason: 'onAdd must still be invoked with the selected userId',
        );
        expect(
          find.text(errorMessage),
          findsOneWidget,
          reason:
              'CollaboratorsRow must surface the AppError message via SnackBar '
              'so failures are never silent.',
        );
      },
    );

    testWidgets(
      'issue-651-c2: CollaboratorsRow surfaces onRemove AppError as a SnackBar',
      (tester) async {
        // Tooltip's internal LongPressGestureRecognizer competes with the row's
        // outer GestureDetector in the gesture arena and tends to win in
        // widget-test contexts. We sidestep the arena by invoking the
        // GestureDetector's onLongPress callback directly — what matters for
        // this regression is the SnackBar surface, not how the gesture is
        // dispatched.
        await tester.binding.setSurfaceSize(const Size(1200, 800));
        addTearDown(() => tester.binding.setSurfaceSize(null));

        const errorMessage = 'Only the task owner can remove collaborators';
        late int onRemoveCalledWith;
        Future<void> onRemove(int userId) async {
          onRemoveCalledWith = userId;
          throw AppError(errorMessage, statusCode: 403);
        }

        await tester.pumpWidget(
          _wrapForTest(
            CollaboratorsRow(
              collaborators: const [
                TaskCollaborator(
                  userId: _existingCollabUserId,
                  name: 'Existing Collab',
                ),
              ],
              ownerId: _ownerId,
              workspaceMembers: _workspace,
              onAdd: (_) async {},
              onRemove: onRemove,
            ),
          ),
        );

        // Find the GestureDetector wired with the long-press handler for the
        // chip and invoke its callback directly. There is exactly one
        // collaborator chip, and its GestureDetector is the only one with a
        // non-null onLongPress in this widget tree.
        final detectors = tester
            .widgetList<GestureDetector>(find.byType(GestureDetector))
            .where((g) => g.onLongPress != null)
            .toList();
        expect(
          detectors,
          hasLength(1),
          reason: 'Expected exactly one chip with a long-press remove handler',
        );
        detectors.single.onLongPress!();
        await tester.pumpAndSettle();

        expect(
          onRemoveCalledWith,
          _existingCollabUserId,
          reason: 'onRemove must be invoked with the chip\'s userId',
        );
        expect(
          find.text(errorMessage),
          findsOneWidget,
          reason:
              'CollaboratorsRow must surface the AppError message via SnackBar '
              'when remove fails.',
        );
      },
    );
  });

  group('RhythmTaskInspector', () {
    testWidgets(
      'issue-651-c3: inspector surfaces onAddCollaborator AppError + clears loading',
      (tester) async {
        // Inspector header overflows by a few px under the default test
        // viewport because its action button row (Edit / Cancel / Save / Close)
        // is wider than the dialog allots. That's purely cosmetic chrome —
        // unrelated to the regression we are pinning. Suppress those layout
        // errors so the SnackBar expectation can be evaluated cleanly.
        await tester.binding.setSurfaceSize(const Size(1800, 1200));
        addTearDown(() => tester.binding.setSurfaceSize(null));

        const errorMessage = 'Request failed (HTTP 404).';

        Future<List<TaskCollaborator>> onAddCollaborator(int userId) async {
          throw AppError(errorMessage, statusCode: 404);
        }

        Future<List<TaskCollaborator>> onRemoveCollaborator(int userId) async {
          return const [];
        }

        Future<void> onSave(RhythmTaskInspectorSaveRequest req) async {}

        await tester.pumpWidget(
          MaterialApp(
            home: Builder(
              builder: (ctx) {
                return Scaffold(
                  body: Center(
                    child: ElevatedButton(
                      onPressed: () => showRhythmTaskInspector(
                        ctx,
                        task: _buildTask(),
                        workspaceMembers: _workspace,
                        onSaveDetails: onSave,
                        onAddCollaborator: onAddCollaborator,
                        onRemoveCollaborator: onRemoveCollaborator,
                      ),
                      child: const Text('Open inspector'),
                    ),
                  ),
                );
              },
            ),
          ),
        );

        await tester.tap(find.text('Open inspector'));
        await tester.pumpAndSettle();
        _drainLayoutOverflowErrors();

        // Issue #675: the inspector now opens in edit mode by default —
        // settle and drain the known aside-panel overflow errors.
        await tester.pumpAndSettle();
        _drainLayoutOverflowErrors();

        // Tap the "Add collaborator" button inside the inspector.
        await tester.tap(find.text('Add collaborator'));
        await tester.pumpAndSettle();
        _drainLayoutOverflowErrors();

        // Pick Visalia CRC.
        await tester.tap(find.text('Visalia CRC').last);
        await tester.pumpAndSettle();
        _drainLayoutOverflowErrors();

        expect(
          find.text(errorMessage),
          findsOneWidget,
          reason:
              'Inspector must surface the AppError message via SnackBar instead '
              'of silently swallowing it.',
        );
      },
    );

    testWidgets(
      'issue-651-c4: inspector surfaces onRemoveCollaborator AppError',
      (tester) async {
        await tester.binding.setSurfaceSize(const Size(1800, 1200));
        addTearDown(() => tester.binding.setSurfaceSize(null));

        const errorMessage = 'Server error (HTTP 500).';

        Future<List<TaskCollaborator>> onAddCollaborator(int userId) async {
          return const [];
        }

        Future<List<TaskCollaborator>> onRemoveCollaborator(int userId) async {
          throw AppError(errorMessage, statusCode: 500);
        }

        Future<void> onSave(RhythmTaskInspectorSaveRequest req) async {}

        await tester.pumpWidget(
          MaterialApp(
            home: Builder(
              builder: (ctx) {
                return Scaffold(
                  body: Center(
                    child: ElevatedButton(
                      onPressed: () => showRhythmTaskInspector(
                        ctx,
                        task: _buildTask(
                          collaborators: const [
                            TaskCollaborator(
                              userId: _existingCollabUserId,
                              name: 'Existing Collab',
                            ),
                          ],
                        ),
                        workspaceMembers: _workspace,
                        onSaveDetails: onSave,
                        onAddCollaborator: onAddCollaborator,
                        onRemoveCollaborator: onRemoveCollaborator,
                      ),
                      child: const Text('Open inspector'),
                    ),
                  ),
                );
              },
            ),
          ),
        );

        await tester.tap(find.text('Open inspector'));
        await tester.pumpAndSettle();
        _drainLayoutOverflowErrors();

        // Issue #675: edit mode is the default, so the chip's delete
        // affordance is available immediately.

        // InputChip's delete icon defaults to a tooltip of "Delete".
        final deleteButton = find.byTooltip('Delete');
        expect(
          deleteButton,
          findsWidgets,
          reason:
              'Inspector must expose the InputChip delete affordance in edit mode',
        );
        await tester.tap(deleteButton.first);
        await tester.pumpAndSettle();
        _drainLayoutOverflowErrors();

        expect(
          find.text(errorMessage),
          findsOneWidget,
          reason:
              'Inspector must surface the AppError message via SnackBar when '
              'remove fails, not silently swallow it.',
        );
      },
    );
  });

  // OPC-M1-3: c6/c7 (isPendingAgent + filterStalePendingErrors from
  // agent_bubble_overlay.dart) removed — bubble file deleted.

  // ---------------------------------------------------------------------------
  // c8 — Release builds refuse to honor RHYTHM_LOCAL_SMOKE=1 env var, since a
  //      stale `launchctl setenv` from a smoke session would otherwise silently
  //      silence the trigger watcher in every shipped DMG. The dart-define
  //      route still works (compile-time, can't leak across launchd sessions).
  // ---------------------------------------------------------------------------

  group('RHYTHM_LOCAL_SMOKE release-build hardening', () {
    test('issue-651-c8a: env var is honored only in debug builds', () {
      var warned = 0;
      void onWarn() => warned += 1;

      // Debug build + env var set → smoke mode active.
      expect(
        computeIsLocalSmokeRun(
          dartDefine: null,
          envVar: '1',
          isDebugMode: true,
          onIgnoredInRelease: onWarn,
        ),
        isTrue,
      );
      expect(warned, 0, reason: 'no warning in debug build');

      // Release build + env var set → IGNORED + warning fires.
      expect(
        computeIsLocalSmokeRun(
          dartDefine: null,
          envVar: '1',
          isDebugMode: false,
          onIgnoredInRelease: onWarn,
        ),
        isFalse,
        reason:
            'Release builds must refuse to honor a stale launchd env var '
            'so the trigger watcher cannot be silently disabled in shipped '
            'DMGs (root cause of the v18.38 regression).',
      );
      expect(
        warned,
        1,
        reason: 'warning hook must fire when env var ignored in release',
      );
    });

    test('issue-651-c8b: dart-define always wins regardless of build mode', () {
      var warned = 0;
      // Release build but --dart-define=RHYTHM_LOCAL_SMOKE=1 → still active.
      // dart-define is compile-time, scoped to the binary, so it cannot leak
      // across launchd sessions like an env var can.
      expect(
        computeIsLocalSmokeRun(
          dartDefine: '1',
          envVar: null,
          isDebugMode: false,
          onIgnoredInRelease: () => warned += 1,
        ),
        isTrue,
      );
      expect(warned, 0, reason: 'no warning when dart-define is the source');
    });

    test(
      'issue-651-c8c: env var unset → smoke mode off in all build modes',
      () {
        var warned = 0;
        expect(
          computeIsLocalSmokeRun(
            dartDefine: null,
            envVar: null,
            isDebugMode: false,
            onIgnoredInRelease: () => warned += 1,
          ),
          isFalse,
        );
        expect(
          computeIsLocalSmokeRun(
            dartDefine: null,
            envVar: null,
            isDebugMode: true,
            onIgnoredInRelease: () => warned += 1,
          ),
          isFalse,
        );
        expect(warned, 0);
      },
    );
  });
}
