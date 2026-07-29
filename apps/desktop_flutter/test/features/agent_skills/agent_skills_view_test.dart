/// REAL-SURFACE widget tests for the standalone Skills menu [AgentSkillsView]
/// (#796 — skill-unify2, subsumes #779; #813 — sortable/searchable table).
///
/// These pump the MOUNTED view inside a MaterialApp with a real
/// [AgentSkillsController] backed by a FAKE [OpencodeSkillsDataSource]. No
/// isolated widget stubs.
///
/// Asserts:
///   1. The menu lists EVERY engine skill from the unified endpoint
///      (`listWithMetadata`), each with a managed/external badge.
///   2. Lifecycle (measuring/reverted) + baseline→post score render when present
///      (the score + provenance metadata moved into the lazy expansion area in
///      #813; the lifecycle pill stays in the always-visible trailing cell).
///   3. Managed rows expose edit + delete; external/handwritten rows are
///      read-only (no edit/delete affordance, lock icon shown).
///   4. "New skill" opens the managed editor and round-trips a create.
///   5. Tapping Delete (confirmed) calls the data source's delete.
///   6. Loading / error / empty states render (no crash, no hardcoded fallback).
///   7. The data source targets localhost:4001.
///   8. (#813) Clicking the Name / Description header toggles the row order
///      ascending↔descending; the default sort is Name ascending.
///   9. (#813) The search field live-filters rows by name + description
///      (case-insensitive substring); body is not searched.
///  10. (#813) Expanding a row calls `getContent(name)` exactly once (cached on
///      re-expand) and renders the returned SKILL.md body; a fetch failure
///      renders a soft error.
///  11. (#813) An `active` skill (the default lifecycle) shows a visible Status
///      pill so the column is never empty.
///  12. (#813) Clicking the Status header sorts rows by lifecycle (measuring →
///      reverted → active) and toggles ascending↔descending.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/constants/app_constants.dart';
import 'package:rhythm_desktop/features/agent_skills/controllers/agent_skills_controller.dart';
import 'package:rhythm_desktop/features/agent_skills/views/agent_skills_view.dart';
import 'package:rhythm_desktop/features/agents/data/opencode_skills_data_source.dart';
import 'package:rhythm_desktop/features/agents/views/_managed_skill_editor_sheet.dart';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/// A skills data source that returns a fixed unified list and records
/// create/delete calls. Can be driven into loading/error states.
class _FakeSkillsDataSource extends OpencodeSkillsDataSource {
  _FakeSkillsDataSource(this._entries);

  List<OpencodeSkillEntry> _entries;

  Map<String, dynamic>? lastCreate;
  Map<String, dynamic>? lastUpdate;
  String? lastDeleted;
  String? lastGetContentName;

  /// #1055 — count of [reload] calls (the Refresh button's backend re-scan),
  /// recorded instead of hitting the network in tests.
  int reloadCalls = 0;

  /// #1055 — skills that become visible only once [reload] runs, simulating a
  /// newly published org skill the engine only discovers after a re-scan.
  final List<OpencodeSkillEntry> _pendingOnReload = [];

  void addOrgSkillOnReload(String name) {
    _pendingOnReload.add(_skill(name, source: 'org'));
  }

  bool throwOnList = false;
  bool hangOnList = false;

  /// Names that should make [getContent] throw (lazy-body soft-error path).
  final Set<String> throwOnContentFor = {};

  /// How many times [getContent] was called per skill name (asserts caching).
  final Map<String, int> getContentCalls = {};

  /// Body returned by [getContent] keyed by skill name. Edit mode fetches this
  /// to populate the content box.
  final Map<String, String> contentByName = {};

  @override
  Future<List<OpencodeSkillEntry>> listWithMetadata() async {
    if (hangOnList) {
      return Completer<List<OpencodeSkillEntry>>().future;
    }
    if (throwOnList) {
      throw Exception('boom');
    }
    return List.of(_entries);
  }

  @override
  Future<OpencodeSkillEntry> create({
    required String name,
    String? description,
    required String content,
  }) async {
    lastCreate = {'name': name, 'description': description, 'content': content};
    final entry = OpencodeSkillEntry(
      name: name,
      description: description,
      location: '/managed/$name/SKILL.md',
      managed: true,
      metadata: const OpencodeSkillMetadata(),
    );
    _entries = [..._entries, entry];
    return entry;
  }

  @override
  Future<String> getContent(String name) async {
    lastGetContentName = name;
    getContentCalls[name] = (getContentCalls[name] ?? 0) + 1;
    if (throwOnContentFor.contains(name)) {
      throw Exception('content boom');
    }
    return contentByName[name] ?? '';
  }

  @override
  Future<OpencodeSkillEntry> update(
    String name, {
    String? description,
    required String content,
  }) async {
    lastUpdate = {'name': name, 'description': description, 'content': content};
    final entry = OpencodeSkillEntry(
      name: name,
      description: description,
      location: '/managed/$name/SKILL.md',
      managed: true,
      metadata: const OpencodeSkillMetadata(),
    );
    _entries = _entries.map((s) => s.name == name ? entry : s).toList();
    return entry;
  }

  @override
  Future<void> delete(String name) async {
    lastDeleted = name;
    _entries = _entries.where((s) => s.name != name).toList();
  }

  @override
  Future<void> reload() async {
    reloadCalls += 1;
    if (_pendingOnReload.isNotEmpty) {
      _entries = [..._entries, ..._pendingOnReload];
      _pendingOnReload.clear();
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

OpencodeSkillEntry _skill(
  String name, {
  bool managed = false,
  String? source,
  String? description = 'desc',
  OpencodeSkillMetadata? metadata,
}) => OpencodeSkillEntry(
  name: name,
  description: description,
  location: managed ? '/managed/$name/SKILL.md' : '/external/$name/SKILL.md',
  managed: managed,
  source: source,
  metadata: metadata ?? const OpencodeSkillMetadata(),
);

Widget _buildApp(AgentSkillsController controller) {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AgentSkillsController>.value(value: controller),
    ],
    child: const MaterialApp(home: AgentSkillsView()),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('AgentSkillsView — unified engine-skill list', () {
    testWidgets('lists managed + external skills with provenance badges', (
      tester,
    ) async {
      final ds = _FakeSkillsDataSource([
        _skill('release-notes', managed: true),
        _skill('engineering:code-review'),
      ]);
      final controller = AgentSkillsController(ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      expect(find.text('release-notes'), findsOneWidget);
      expect(find.text('engineering:code-review'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('badge-managed-release-notes')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('badge-external-engineering:code-review')),
        findsOneWidget,
      );
    });

    testWidgets('managed row shows edit + delete; external is read-only', (
      tester,
    ) async {
      final ds = _FakeSkillsDataSource([
        _skill('release-notes', managed: true),
        _skill('docx'),
      ]);
      final controller = AgentSkillsController(ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      // Managed: edit + delete present.
      expect(
        find.byKey(const ValueKey('edit-skill-release-notes')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('delete-skill-release-notes')),
        findsOneWidget,
      );

      // External: no edit/delete, shows a read-only lock affordance.
      expect(find.byKey(const ValueKey('edit-skill-docx')), findsNothing);
      expect(find.byKey(const ValueKey('delete-skill-docx')), findsNothing);
      expect(find.byKey(const ValueKey('readonly-skill-docx')), findsOneWidget);
    });

    // #1055 — Skills UI source badges: an org skill (pulled from the shared
    // org index — read-only) renders its own ORG badge and no edit/delete,
    // distinct from both MANAGED and EXTERNAL; managed rows are unaffected.
    testWidgets(
      'org row shows an ORG badge and no edit/delete; managed row unchanged',
      (tester) async {
        final ds = _FakeSkillsDataSource([
          _skill('release-notes', managed: true),
          _skill('shared-onboarding', source: 'org'),
          _skill('docx'),
        ]);
        final controller = AgentSkillsController(ds);
        addTearDown(controller.dispose);

        await tester.pumpWidget(_buildApp(controller));
        await tester.pumpAndSettle();

        // Managed row: unchanged (badge + edit/delete).
        expect(
          find.byKey(const ValueKey('badge-managed-release-notes')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('edit-skill-release-notes')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('delete-skill-release-notes')),
          findsOneWidget,
        );

        // Org row: its own badge, no edit/delete, read-only lock shown.
        expect(
          find.byKey(const ValueKey('badge-org-shared-onboarding')),
          findsOneWidget,
        );
        expect(find.text('ORG'), findsOneWidget);
        expect(
          find.byKey(const ValueKey('edit-skill-shared-onboarding')),
          findsNothing,
        );
        expect(
          find.byKey(const ValueKey('delete-skill-shared-onboarding')),
          findsNothing,
        );
        expect(
          find.byKey(const ValueKey('readonly-skill-shared-onboarding')),
          findsOneWidget,
        );

        // External row: still its own distinct badge (falsifies "org and
        // external share a badge").
        expect(
          find.byKey(const ValueKey('badge-external-docx')),
          findsOneWidget,
        );
      },
    );

    // #1055 — the Refresh action re-scans the engine (backend reloadSkills,
    // via POST /system/refresh) BEFORE re-listing, so a newly published org
    // skill appears without an app/engine restart.
    testWidgets(
      'tapping Refresh calls the backend reload then re-lists newly published skills',
      (tester) async {
        final ds = _FakeSkillsDataSource([
          _skill('release-notes', managed: true),
        ]);
        final controller = AgentSkillsController(ds);
        addTearDown(controller.dispose);

        await tester.pumpWidget(_buildApp(controller));
        await tester.pumpAndSettle();

        expect(ds.reloadCalls, equals(0));
        expect(find.text('shared-onboarding'), findsNothing);

        // Simulate a newly published org skill becoming visible to the engine
        // only after a reload (e.g. #1054's skills.urls re-fetch).
        ds.addOrgSkillOnReload('shared-onboarding');

        await tester.tap(find.byTooltip('Refresh'));
        await tester.pumpAndSettle();

        expect(ds.reloadCalls, equals(1));
        expect(find.text('shared-onboarding'), findsOneWidget);
        expect(
          find.byKey(const ValueKey('badge-org-shared-onboarding')),
          findsOneWidget,
        );
      },
    );

    testWidgets('renders lifecycle status + baseline→post score', (
      tester,
    ) async {
      final ds = _FakeSkillsDataSource([
        _skill(
          'reverted-skill',
          managed: true,
          metadata: const OpencodeSkillMetadata(
            confidence: 0.81,
            version: 3,
            status: 'reverted',
            source: 'teacher-escalation',
            uses: 7,
            baselineScore: 0.70,
            postScore: 0.55,
          ),
        ),
      ]);
      final controller = AgentSkillsController(ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      // The lifecycle pill stays in the always-visible trailing cell.
      expect(
        find.byKey(const ValueKey('status-badge-reverted')),
        findsOneWidget,
      );

      // Provenance + score moved into the lazy expansion area (#813) — expand.
      await tester.tap(find.byKey(const ValueKey('skill-row-reverted-skill')));
      await tester.pumpAndSettle();

      expect(find.textContaining('teacher-escalation'), findsOneWidget);
      expect(find.textContaining('confidence 0.81'), findsOneWidget);
      expect(find.textContaining('v3'), findsOneWidget);
      expect(find.textContaining('score 0.70 → 0.55'), findsOneWidget);
    });

    testWidgets('external fork shows the auto-improved note', (tester) async {
      final ds = _FakeSkillsDataSource([
        _skill(
          'forked-skill',
          managed: true,
          metadata: const OpencodeSkillMetadata(
            status: 'measuring',
            isExternalFork: true,
          ),
        ),
      ]);
      final controller = AgentSkillsController(ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      // Lifecycle pill is always visible.
      expect(
        find.byKey(const ValueKey('status-badge-measuring')),
        findsOneWidget,
      );

      // The auto-improved note is part of the lazy expansion (#813) — expand.
      await tester.tap(find.byKey(const ValueKey('skill-row-forked-skill')));
      await tester.pumpAndSettle();
      expect(find.textContaining('auto-improved'), findsOneWidget);
    });

    testWidgets(
      '"New skill" opens the managed editor and round-trips a create',
      (tester) async {
        final ds = _FakeSkillsDataSource([
          _skill('release-notes', managed: true),
        ]);
        final controller = AgentSkillsController(ds);
        addTearDown(controller.dispose);

        await tester.pumpWidget(_buildApp(controller));
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const ValueKey('new-skill-button')));
        await tester.pumpAndSettle();

        // The managed editor sheet is open.
        expect(find.text('New skill'), findsWidgets);

        // Scope field finds to the editor sheet — the page now also has a
        // search TextField (#813), so `.first`/`.last` across the whole tree
        // would target the wrong fields.
        final sheetFields = find.descendant(
          of: find.byType(ManagedSkillEditorSheet),
          matching: find.byType(TextField),
        );
        await tester.enterText(sheetFields.first, 'my-new-skill');
        await tester.enterText(sheetFields.last, 'the body');
        await tester.tap(find.widgetWithText(FilledButton, 'Create skill'));
        await tester.pumpAndSettle();

        expect(ds.lastCreate?['name'], equals('my-new-skill'));
        expect(ds.lastCreate?['content'], equals('the body'));
        // The newly created skill appears after the round-trip reload.
        expect(find.text('my-new-skill'), findsOneWidget);
      },
    );

    testWidgets(
      'editing a managed skill loads its body and round-trips an update (#812)',
      (tester) async {
        final ds =
            _FakeSkillsDataSource([_skill('release-notes', managed: true)])
              ..contentByName['release-notes'] =
                  '---\nname: release-notes\n---\n\nThe saved body.';
        final controller = AgentSkillsController(ds);
        addTearDown(controller.dispose);

        await tester.pumpWidget(_buildApp(controller));
        await tester.pumpAndSettle();

        await tester.tap(
          find.byKey(const ValueKey('edit-skill-release-notes')),
        );
        await tester.pumpAndSettle();

        // Edit mode fetched the body via getContent and populated the box —
        // it is NOT empty (the #812 bug).
        expect(ds.lastGetContentName, equals('release-notes'));
        expect(find.text('Edit skill'), findsWidgets);
        expect(find.textContaining('The saved body.'), findsOneWidget);

        // Edit the body and save → update round-trips with the new content.
        final sheetFields = find.descendant(
          of: find.byType(ManagedSkillEditorSheet),
          matching: find.byType(TextField),
        );
        await tester.enterText(sheetFields.last, 'The edited body.');
        await tester.tap(find.widgetWithText(FilledButton, 'Save skill'));
        await tester.pumpAndSettle();

        expect(ds.lastUpdate?['name'], equals('release-notes'));
        expect(ds.lastUpdate?['content'], equals('The edited body.'));
      },
    );

    testWidgets('deleting a managed skill (confirmed) calls delete', (
      tester,
    ) async {
      final ds = _FakeSkillsDataSource([
        _skill('release-notes', managed: true),
      ]);
      final controller = AgentSkillsController(ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      await tester.tap(
        find.byKey(const ValueKey('delete-skill-release-notes')),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Delete').last);
      await tester.pumpAndSettle();

      expect(ds.lastDeleted, equals('release-notes'));
    });

    testWidgets('loading shows a spinner', (tester) async {
      final ds = _FakeSkillsDataSource([])..hangOnList = true;
      final controller = AgentSkillsController(ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pump();
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('error shows the error message + no hardcoded fallback', (
      tester,
    ) async {
      final ds = _FakeSkillsDataSource([])..throwOnList = true;
      final controller = AgentSkillsController(ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('skills-error-state')), findsOneWidget);
      expect(find.textContaining('boom'), findsOneWidget);
    });

    testWidgets('empty list shows the empty state', (tester) async {
      final ds = _FakeSkillsDataSource([]);
      final controller = AgentSkillsController(ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('skills-empty-state')), findsOneWidget);
      expect(find.text('No skills yet'), findsOneWidget);
    });
  });

  group('AgentSkillsView — #813 sortable + searchable table', () {
    /// Returns the on-screen top-to-bottom order of the given skill names by
    /// their vertical position, so we can assert sort order deterministically.
    List<String> orderedNames(WidgetTester tester, List<String> names) {
      final pairs =
          names
              .where((n) => find.text(n).evaluate().isNotEmpty)
              .map((n) => MapEntry(n, tester.getTopLeft(find.text(n)).dy))
              .toList()
            ..sort((a, b) => a.value.compareTo(b.value));
      return pairs.map((e) => e.key).toList();
    }

    testWidgets('default sort is Name ascending; clicking Name toggles desc', (
      tester,
    ) async {
      final ds = _FakeSkillsDataSource([
        _skill('charlie', managed: true),
        _skill('alpha'),
        _skill('bravo', managed: true),
      ]);
      final controller = AgentSkillsController(ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      // Default: Name ascending.
      expect(
        orderedNames(tester, ['alpha', 'bravo', 'charlie']),
        equals(['alpha', 'bravo', 'charlie']),
      );
      // Active indicator points up.
      expect(
        find.byKey(const ValueKey('skills-sort-name-asc')),
        findsOneWidget,
      );

      // Click Name header → descending.
      await tester.tap(find.byKey(const ValueKey('skills-sort-name')));
      await tester.pumpAndSettle();

      expect(
        orderedNames(tester, ['alpha', 'bravo', 'charlie']),
        equals(['charlie', 'bravo', 'alpha']),
      );
      expect(
        find.byKey(const ValueKey('skills-sort-name-desc')),
        findsOneWidget,
      );
    });

    testWidgets('clicking Description header sorts rows by description', (
      tester,
    ) async {
      // Names and descriptions are deliberately inverse-ordered so a
      // description sort produces a different row order than the name sort.
      final ds = _FakeSkillsDataSource([
        _skill('alpha', managed: true, description: 'zebra task'),
        _skill('bravo', description: 'apple task'),
        _skill('charlie', managed: true, description: 'mango task'),
      ]);
      final controller = AgentSkillsController(ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      // Sanity: default Name-asc order.
      expect(
        orderedNames(tester, ['alpha', 'bravo', 'charlie']),
        equals(['alpha', 'bravo', 'charlie']),
      );

      // Sort by Description ascending: apple(bravo) < mango(charlie) < zebra(alpha).
      await tester.tap(find.byKey(const ValueKey('skills-sort-description')));
      await tester.pumpAndSettle();

      expect(
        orderedNames(tester, ['alpha', 'bravo', 'charlie']),
        equals(['bravo', 'charlie', 'alpha']),
      );
      expect(
        find.byKey(const ValueKey('skills-sort-description-asc')),
        findsOneWidget,
      );

      // Toggle to descending: zebra(alpha) < mango(charlie) < apple(bravo).
      await tester.tap(find.byKey(const ValueKey('skills-sort-description')));
      await tester.pumpAndSettle();
      expect(
        orderedNames(tester, ['alpha', 'bravo', 'charlie']),
        equals(['alpha', 'charlie', 'bravo']),
      );
    });

    testWidgets('search filters rows by name and by description', (
      tester,
    ) async {
      final ds = _FakeSkillsDataSource([
        _skill(
          'release-notes',
          managed: true,
          description: 'draft a changelog',
        ),
        _skill('docx', description: 'edit Word documents'),
        _skill('pptx', description: 'build slide decks'),
      ]);
      final controller = AgentSkillsController(ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      // Filter by NAME substring (case-insensitive).
      await tester.enterText(
        find.byKey(const ValueKey('skills-search-field')),
        'DOC',
      );
      await tester.pumpAndSettle();
      expect(find.text('docx'), findsOneWidget);
      expect(find.text('release-notes'), findsNothing);
      expect(find.text('pptx'), findsNothing);

      // Filter by DESCRIPTION substring.
      await tester.enterText(
        find.byKey(const ValueKey('skills-search-field')),
        'changelog',
      );
      await tester.pumpAndSettle();
      expect(find.text('release-notes'), findsOneWidget);
      expect(find.text('docx'), findsNothing);

      // No match → no-results placeholder, not a crash / hardcoded list.
      await tester.enterText(
        find.byKey(const ValueKey('skills-search-field')),
        'zzz-nomatch',
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('skills-no-matches')), findsOneWidget);

      // Clearing restores the full list.
      await tester.enterText(
        find.byKey(const ValueKey('skills-search-field')),
        '',
      );
      await tester.pumpAndSettle();
      expect(find.text('release-notes'), findsOneWidget);
      expect(find.text('docx'), findsOneWidget);
      expect(find.text('pptx'), findsOneWidget);
    });

    testWidgets(
      'expanding a row fetches the body via getContent and renders it; '
      're-expanding does not refetch (cached)',
      (tester) async {
        final ds = _FakeSkillsDataSource([
          _skill('release-notes', managed: true),
        ])..contentByName['release-notes'] = 'The SKILL.md body text.';
        final controller = AgentSkillsController(ds);
        addTearDown(controller.dispose);

        await tester.pumpWidget(_buildApp(controller));
        await tester.pumpAndSettle();

        // Not fetched until expanded.
        expect(ds.getContentCalls['release-notes'], isNull);
        expect(find.textContaining('The SKILL.md body text.'), findsNothing);

        // Expand → getContent fires and the body renders.
        await tester.tap(find.byKey(const ValueKey('skill-row-release-notes')));
        await tester.pumpAndSettle();
        expect(ds.lastGetContentName, equals('release-notes'));
        expect(ds.getContentCalls['release-notes'], equals(1));
        expect(find.textContaining('The SKILL.md body text.'), findsOneWidget);

        // Collapse and re-expand → served from cache, no second fetch.
        await tester.tap(find.byKey(const ValueKey('skill-row-release-notes')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('skill-row-release-notes')));
        await tester.pumpAndSettle();
        expect(ds.getContentCalls['release-notes'], equals(1));
        expect(find.textContaining('The SKILL.md body text.'), findsOneWidget);
      },
    );

    testWidgets('a failed body fetch renders a soft error, not a crash', (
      tester,
    ) async {
      final ds = _FakeSkillsDataSource([_skill('release-notes', managed: true)])
        ..throwOnContentFor.add('release-notes');
      final controller = AgentSkillsController(ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('skill-row-release-notes')));
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('skill-body-error-release-notes')),
        findsOneWidget,
      );
      expect(find.textContaining('content boom'), findsOneWidget);
    });

    testWidgets(
      'an active skill renders a visible Status pill (column not empty)',
      (tester) async {
        // Default metadata → status null → treated as `active`. Pre-#813 the
        // trailing cell rendered nothing for active skills, so the Status
        // column looked empty on a normal system.
        final ds = _FakeSkillsDataSource([
          _skill('release-notes', managed: true),
        ]);
        final controller = AgentSkillsController(ds);
        addTearDown(controller.dispose);

        await tester.pumpWidget(_buildApp(controller));
        await tester.pumpAndSettle();

        expect(
          find.byKey(const ValueKey('status-badge-active')),
          findsOneWidget,
        );
        expect(find.text('ACTIVE'), findsOneWidget);
      },
    );

    testWidgets('clicking the Status header sorts rows by lifecycle asc/desc', (
      tester,
    ) async {
      // Lifecycle order is measuring → reverted → active; names are inverse so
      // a status sort produces a different order than the default Name sort.
      final ds = _FakeSkillsDataSource([
        _skill(
          'alpha',
          managed: true,
          metadata: const OpencodeSkillMetadata(status: 'active'),
        ),
        _skill(
          'bravo',
          managed: true,
          metadata: const OpencodeSkillMetadata(status: 'measuring'),
        ),
        _skill(
          'charlie',
          managed: true,
          metadata: const OpencodeSkillMetadata(status: 'reverted'),
        ),
      ]);
      final controller = AgentSkillsController(ds);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_buildApp(controller));
      await tester.pumpAndSettle();

      // Sanity: default Name-asc order.
      expect(
        orderedNames(tester, ['alpha', 'bravo', 'charlie']),
        equals(['alpha', 'bravo', 'charlie']),
      );

      // Sort by Status ascending: measuring(bravo) → reverted(charlie) →
      // active(alpha).
      await tester.tap(find.byKey(const ValueKey('skills-sort-status')));
      await tester.pumpAndSettle();
      expect(
        orderedNames(tester, ['alpha', 'bravo', 'charlie']),
        equals(['bravo', 'charlie', 'alpha']),
      );
      expect(
        find.byKey(const ValueKey('skills-sort-status-asc')),
        findsOneWidget,
      );

      // Toggle to descending → reversed: active(alpha) → reverted(charlie) →
      // measuring(bravo).
      await tester.tap(find.byKey(const ValueKey('skills-sort-status')));
      await tester.pumpAndSettle();
      expect(
        orderedNames(tester, ['alpha', 'bravo', 'charlie']),
        equals(['alpha', 'charlie', 'bravo']),
      );
      expect(
        find.byKey(const ValueKey('skills-sort-status-desc')),
        findsOneWidget,
      );
    });
  });

  group('OpencodeSkillsDataSource — dual-endpoint targeting', () {
    test('targets the local agent server (:4001), never the prod URL', () {
      // The agent skills traffic must stay on localhost:4001 regardless of the
      // configurable production server URL (CLAUDE.md dual-endpoint rule).
      expect(AppConstants.agentLocalBaseUrl, contains('4001'));
      expect(AppConstants.agentLocalBaseUrl, contains('localhost'));
    });
  });

  group('AgentSkillsView — #845 skill-effectiveness dashboard', () {
    /// Returns the on-screen top-to-bottom order of the given skill names by
    /// their vertical position (mirrors the #813 sort-order helper).
    List<String> orderedNames(WidgetTester tester, List<String> names) {
      final pairs =
          names
              .where((n) => find.text(n).evaluate().isNotEmpty)
              .map((n) => MapEntry(n, tester.getTopLeft(find.text(n)).dy))
              .toList()
            ..sort((a, b) => a.value.compareTo(b.value));
      return pairs.map((e) => e.key).toList();
    }

    testWidgets(
      'issue-845-c1a: table header exposes sortable Score and Usage columns',
      (tester) async {
        final ds = _FakeSkillsDataSource([
          _skill('release-notes', managed: true),
        ]);
        final controller = AgentSkillsController(ds);
        addTearDown(controller.dispose);

        await tester.pumpWidget(_buildApp(controller));
        await tester.pumpAndSettle();

        expect(find.byKey(const ValueKey('skills-sort-score')), findsOneWidget);
        expect(find.byKey(const ValueKey('skills-sort-usage')), findsOneWidget);
      },
    );

    testWidgets(
      'issue-845-c1b: clicking the Score header sorts rows by postScore asc/desc',
      (tester) async {
        // Names are inverse of score order so a score sort produces a
        // different row order than the default Name sort.
        final ds = _FakeSkillsDataSource([
          _skill(
            'alpha',
            managed: true,
            metadata: const OpencodeSkillMetadata(postScore: 90),
          ),
          _skill(
            'bravo',
            managed: true,
            metadata: const OpencodeSkillMetadata(postScore: 10),
          ),
          _skill(
            'charlie',
            managed: true,
            metadata: const OpencodeSkillMetadata(postScore: 50),
          ),
        ]);
        final controller = AgentSkillsController(ds);
        addTearDown(controller.dispose);

        await tester.pumpWidget(_buildApp(controller));
        await tester.pumpAndSettle();

        // Sanity: default Name-asc order.
        expect(
          orderedNames(tester, ['alpha', 'bravo', 'charlie']),
          equals(['alpha', 'bravo', 'charlie']),
        );

        // Score ascending: bravo(10) < charlie(50) < alpha(90).
        await tester.tap(find.byKey(const ValueKey('skills-sort-score')));
        await tester.pumpAndSettle();
        expect(
          orderedNames(tester, ['alpha', 'bravo', 'charlie']),
          equals(['bravo', 'charlie', 'alpha']),
        );
        expect(
          find.byKey(const ValueKey('skills-sort-score-asc')),
          findsOneWidget,
        );

        // Toggle to descending: alpha(90) > charlie(50) > bravo(10).
        await tester.tap(find.byKey(const ValueKey('skills-sort-score')));
        await tester.pumpAndSettle();
        expect(
          orderedNames(tester, ['alpha', 'bravo', 'charlie']),
          equals(['alpha', 'charlie', 'bravo']),
        );
        expect(
          find.byKey(const ValueKey('skills-sort-score-desc')),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'issue-845-c1c: clicking the Usage header sorts rows by uses asc/desc',
      (tester) async {
        final ds = _FakeSkillsDataSource([
          _skill(
            'alpha',
            managed: true,
            metadata: const OpencodeSkillMetadata(uses: 42),
          ),
          _skill(
            'bravo',
            managed: true,
            metadata: const OpencodeSkillMetadata(uses: 1),
          ),
          _skill(
            'charlie',
            managed: true,
            metadata: const OpencodeSkillMetadata(uses: 7),
          ),
        ]);
        final controller = AgentSkillsController(ds);
        addTearDown(controller.dispose);

        await tester.pumpWidget(_buildApp(controller));
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const ValueKey('skills-sort-usage')));
        await tester.pumpAndSettle();
        // Usage ascending: bravo(1) < charlie(7) < alpha(42).
        expect(
          orderedNames(tester, ['alpha', 'bravo', 'charlie']),
          equals(['bravo', 'charlie', 'alpha']),
        );
        expect(
          find.byKey(const ValueKey('skills-sort-usage-asc')),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'issue-845-c1d: a skill with no metadata score/usage sorts as lowest '
      '(treated as absent, not crashing the comparator)',
      (tester) async {
        final ds = _FakeSkillsDataSource([
          _skill(
            'alpha',
            managed: true,
            metadata: const OpencodeSkillMetadata(postScore: 5),
          ),
          _skill('bravo', managed: true), // default metadata: no scores
        ]);
        final controller = AgentSkillsController(ds);
        addTearDown(controller.dispose);

        await tester.pumpWidget(_buildApp(controller));
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const ValueKey('skills-sort-score')));
        await tester.pumpAndSettle();
        // No crash; bravo (no score) sorts before alpha (score 5) ascending.
        expect(
          orderedNames(tester, ['alpha', 'bravo']),
          equals(['bravo', 'alpha']),
        );
      },
    );

    testWidgets(
      'issue-845-c1e: Score and Usage values render inline in the row',
      (tester) async {
        final ds = _FakeSkillsDataSource([
          _skill(
            'release-notes',
            managed: true,
            metadata: const OpencodeSkillMetadata(postScore: 87, uses: 23),
          ),
        ]);
        final controller = AgentSkillsController(ds);
        addTearDown(controller.dispose);

        await tester.pumpWidget(_buildApp(controller));
        await tester.pumpAndSettle();

        expect(find.textContaining('87'), findsWidgets);
        expect(find.textContaining('23'), findsWidgets);
      },
    );

    testWidgets(
      'issue-845-c2a: expansion area shows measurement history with baseline '
      '→ post score and the judge reason for a KEPT measurement',
      (tester) async {
        final ds = _FakeSkillsDataSource([
          _skill(
            'measured-skill',
            managed: true,
            metadata: const OpencodeSkillMetadata(
              status: 'active',
              baselineScore: 60,
              postScore: 82,
              measureReason:
                  'baseline=60 (ok); post=82 (better); decision=keep',
            ),
          ),
        ]);
        final controller = AgentSkillsController(ds);
        addTearDown(controller.dispose);

        await tester.pumpWidget(_buildApp(controller));
        await tester.pumpAndSettle();

        await tester.tap(
          find.byKey(const ValueKey('skill-row-measured-skill')),
        );
        await tester.pumpAndSettle();

        expect(
          find.byKey(const ValueKey('measurement-history-measured-skill')),
          findsOneWidget,
        );
        expect(find.textContaining('60'), findsWidgets);
        expect(find.textContaining('82'), findsWidgets);
        expect(find.textContaining('decision=keep'), findsOneWidget);
      },
    );

    testWidgets(
      'issue-845-c2b: expansion area surfaces a revert event distinctly from '
      'a kept measurement',
      (tester) async {
        final ds = _FakeSkillsDataSource([
          _skill(
            'reverted-skill',
            managed: true,
            metadata: const OpencodeSkillMetadata(
              status: 'reverted',
              baselineScore: 70,
              postScore: 55,
              measureReason: 'reverted:hash:abc123',
            ),
          ),
        ]);
        final controller = AgentSkillsController(ds);
        addTearDown(controller.dispose);

        await tester.pumpWidget(_buildApp(controller));
        await tester.pumpAndSettle();

        await tester.tap(
          find.byKey(const ValueKey('skill-row-reverted-skill')),
        );
        await tester.pumpAndSettle();

        expect(
          find.byKey(const ValueKey('measurement-history-reverted-skill')),
          findsOneWidget,
        );
        expect(find.textContaining('Reverted'), findsOneWidget);
      },
    );

    testWidgets(
      'issue-845-c2c: a skill with no measurement ledger shows no history '
      'section (not a crash, not a fabricated entry)',
      (tester) async {
        final ds = _FakeSkillsDataSource([
          _skill('untouched-skill', managed: true),
        ]);
        final controller = AgentSkillsController(ds);
        addTearDown(controller.dispose);

        await tester.pumpWidget(_buildApp(controller));
        await tester.pumpAndSettle();

        await tester.tap(
          find.byKey(const ValueKey('skill-row-untouched-skill')),
        );
        await tester.pumpAndSettle();

        expect(
          find.byKey(const ValueKey('measurement-history-untouched-skill')),
          findsNothing,
        );
      },
    );
  });
}
