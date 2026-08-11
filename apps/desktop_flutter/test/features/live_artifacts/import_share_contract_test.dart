import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:rhythm_desktop/features/live_artifacts/controllers/live_artifacts_controller.dart';
import 'package:rhythm_desktop/features/live_artifacts/data/live_artifacts_data_source.dart';
import 'package:rhythm_desktop/features/live_artifacts/models/live_artifact.dart';
import 'package:rhythm_desktop/features/live_artifacts/widgets/dashboard_artifact_tabs.dart';
import 'package:rhythm_desktop/features/live_artifacts/widgets/live_artifact_view.dart';
import 'package:rhythm_desktop/features/settings/data/user_preferences_data_source.dart';

const _artifactJson = {
  'id': 'stable-artifact-id',
  'title': 'Imported calendar',
  'updatedAt': '2026-08-10T00:00:00.000Z',
  'ownerUserId': 7,
  'workspaceId': 2,
  'visibility': 'private',
};

const _standaloneArtifact = '''
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
  <style>:root { --brand: #5b4b8a; } body { color: var(--brand); }</style>
</head>
<body>
  <main id="app">Calendar</main>
  <script type="application/json" id="meta">{"view":"calendar"}</script>
  <script>window.calendarData = { ready: true };</script>
  <script>document.querySelector('#app')!.textContent = window.calendarData.ready ? 'Ready' : 'No';</script>
</body>
</html>
''';

LiveArtifactsDataSource _source(List<http.Request> requests) {
  var visibility = 'private';
  final collaborators = <int>{8};
  return LiveArtifactsDataSource(
    baseUrl: 'http://localhost',
    client: MockClient((request) async {
      requests.add(request);
      if (request.url.path.endsWith('/render')) return http.Response('', 200);
      if (request.url.path == '/users') {
        return http.Response(
            jsonEncode([
              {'id': 8, 'name': 'Alex Smith', 'email': 'alex@example.com'},
              {'id': 9, 'name': 'Jordan Lee', 'email': 'jordan@example.com'},
            ]),
            200);
      }
      if (request.url.path.endsWith('/collaborators')) {
        if (request.method == 'POST') {
          final userId = jsonDecode(request.body)['userId'] as int;
          collaborators.add(userId);
          return http.Response(jsonEncode({'userId': userId}), 201);
        }
        return http.Response(
            jsonEncode(collaborators.map((id) => {'userId': id}).toList()),
            200);
      }
      if (request.method == 'DELETE') {
        collaborators.remove(int.parse(request.url.pathSegments.last));
        return http.Response('', 204);
      }
      if (request.method == 'PATCH') {
        visibility = jsonDecode(request.body)['visibility'] as String;
        return http.Response(
            jsonEncode({..._artifactJson, 'visibility': visibility}), 200);
      }
      return http.Response(
          jsonEncode({..._artifactJson, 'visibility': visibility}),
          request.method == 'GET' ? 200 : 201);
    }),
  );
}

Widget _viewer(LiveArtifactsDataSource source, {int currentUserId = 7}) =>
    MaterialApp(
      home: Scaffold(
        body: LiveArtifactView(
          artifact: LiveArtifact(
            id: 'stable-artifact-id',
            title: 'Imported calendar',
            updatedAt: DateTime(2026, 8, 10),
            ownerUserId: 7,
            workspaceId: 2,
          ),
          source: source,
          enableNativeRuntime: false,
          currentUserId: currentUserId,
        ),
      ),
    );

class _Preferences extends UserPreferencesDataSource {
  _Preferences() : super(baseUrl: 'http://localhost');
  List<String>? saved;
  @override
  Future<Map<String, dynamic>> updateArtifactTabIds(List<String> ids) async {
    saved = ids;
    return {};
  }
}

void main() {
  testWidgets('import contract: picker starts an HTML import journey',
      (tester) async {
    // Regression: the dashboard offers only pre-existing artifacts.
    final controller =
        LiveArtifactsController(_source(<http.Request>[]), _Preferences());
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(body: DashboardArtifactTabs(controller: controller))));
    await tester.tap(find.byTooltip('Open live artifact'));
    await tester.pump();
    expect(find.text('Import HTML'), findsOneWidget);
  });

  test('import contract: create explicitly makes the stable artifact private',
      () async {
    // Regression: server defaults can drift and publish an imported artifact.
    final requests = <http.Request>[];
    final created = await _source(requests).create(
        workspaceId: 2,
        title: 'Edited calendar title',
        html: '<main>Imported</main>',
        css: ':root { --brand: purple; }',
        js: 'window.ready = true;');
    expect(created.id, 'stable-artifact-id');
    expect(jsonDecode(requests.single.body)['visibility'], 'private');
    expect(jsonDecode(requests.single.body)['bundle'], {
      'html': '<main>Imported</main>',
      'css': ':root { --brand: purple; }',
      'js': 'window.ready = true;',
    });
  });

  test('import contract: rejects invalid input and parses preview metadata',
      () {
    // Regression: filename-only import accepts bad bytes and hides runtime limits.
    expect(
        () => HtmlImportPreview.parse(
            filename: 'calendar.txt', bytes: utf8.encode('<title>x</title>')),
        throwsFormatException);
    expect(
        () => HtmlImportPreview.parse(
            filename: 'calendar.html',
            bytes: List.filled(maxHtmlImportBytes + 1, 0)),
        throwsFormatException);
    final preview = HtmlImportPreview.parse(
      filename: 'fallback.html',
      bytes: utf8.encode(
          '<TITLE>Calendar <b>Draft</b></TITLE><script src="https://x"></script><iframe></iframe>fetch("x")'),
    );
    expect(preview.title, 'Calendar Draft');
    expect(
        preview.warnings,
        containsAll([
          'external scripts',
          'embedded frames or media',
          'network requests'
        ]));
    expect(
        HtmlImportPreview.parse(
                filename: 'fallback.htm', bytes: utf8.encode('<p>no title</p>'))
            .title,
        'fallback');
  });

  test('import contract: standalone document POST preserves every source byte',
      () async {
    // Regression: import decomposes a standalone document and loses its head or scripts.
    final requests = <http.Request>[];
    final preview = HtmlImportPreview.parse(
        filename: 'calendar.html', bytes: utf8.encode(_standaloneArtifact));
    await _source(requests)
        .create(workspaceId: 2, title: preview.title, html: preview.html);
    expect(jsonDecode(requests.single.body)['bundle'], {
      'html': _standaloneArtifact,
      'css': '',
      'js': '',
    });
  });

  test('import contract: analyzer warns only for blocked external resources',
      () {
    // Regression: preview warns about allowed font/CDN resources or rewrites input.
    const source = '''<!doctype html><head>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
      <script src="https://cdn.jsdelivr.net/npm/dayjs"></script>
      <script src="https://evil.example/app.js"></script>
      </head><body><script>fetch('https://evil.example/data')</script></body>''';
    final report = HtmlImportPreview.parse(
        filename: 'calendar.html', bytes: utf8.encode(source));
    expect(
        report.warnings, contains('external resources outside allowed hosts'));
    expect(report.warnings, contains('network requests'));
    expect(report.warnings.join(' '), isNot(contains('Google Fonts')));
    expect(report.warnings.join(' '), isNot(contains('jsdelivr')));
  });

  test('import contract: HTML fragments remain complete bundle documents', () {
    // Regression: import strips inline styles or scripts from a body-less fragment.
    const fragment =
        '<main>Calendar</main><style>main { color: purple; }</style><script>window.ready = true;</script>';
    final preview = HtmlImportPreview.parse(
        filename: 'calendar.htm', bytes: utf8.encode(fragment));
    expect(preview.html, fragment);
    expect(preview.bundle.css, isEmpty);
    expect(preview.bundle.js, isEmpty);
  });

  test('import contract: malformed UTF-8 is rejected', () {
    // Regression: lossy decoding stores a bundle different from the picked file.
    expect(
        () => HtmlImportPreview.parse(
            filename: 'calendar.html', bytes: const [0xc3, 0x28]),
        throwsFormatException);
  });

  testWidgets(
      'import contract: dialog shows invalid-file errors and editable preview',
      (tester) async {
    // Regression: picker filtering alone accepts a bad selection or locks title.
    final files = <HtmlImportFile>[
      HtmlImportFile(name: 'not-html.txt', bytes: utf8.encode('nope')),
      HtmlImportFile(
          name: 'calendar.html',
          bytes: utf8.encode(
              '<title>Calendar</title><script src="https://x"></script>')),
    ];
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: HtmlImportDialog(pickFile: () async => files.removeAt(0)))));
    await tester.tap(find.text('Choose HTML file'));
    await tester.pump();
    expect(find.text('Choose an HTML (.html or .htm) file.'), findsOneWidget);
    expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Import'))
            .onPressed,
        isNull);
    await tester.tap(find.text('Choose HTML file'));
    await tester.pump();
    expect(find.byType(TextField), findsOneWidget);
    expect(
        find.textContaining(
            'Some features may be limited: external resources outside allowed hosts'),
        findsOneWidget);
    await tester.enterText(find.byType(TextField), 'Edited title');
    expect(find.text('Edited title'), findsOneWidget);
  });

  test('import contract: opening stable ID pins it and persists the selection',
      () async {
    // Regression: create succeeds but leaves its stable result invisible after restart.
    final requests = <http.Request>[];
    final preferences = _Preferences();
    final controller = LiveArtifactsController(_source(requests), preferences);
    await controller.restore(7, const []);
    final artifact = await _source(requests).create(
        workspaceId: 2, title: 'Calendar', html: '<title>Calendar</title>');
    await controller.open(artifact);
    await Future<void>.delayed(Duration.zero);
    expect(controller.selectedId, 'stable-artifact-id');
    expect(controller.tabs.single.id, 'stable-artifact-id');
    expect(preferences.saved, ['stable-artifact-id']);
  });

  testWidgets('sharing contract: viewer publishes human sharing status',
      (tester) async {
    // Regression: a static Share button hides the artifact's actual access.
    final requests = <http.Request>[];
    await tester.pumpWidget(_viewer(_source(requests)));
    expect(find.textContaining('Private'), findsOneWidget);
  });

  testWidgets('sharing contract: only the owner can mutate sharing',
      (tester) async {
    // Regression: a collaborator receives an owner-only access-management UI.
    final requests = <http.Request>[];
    await tester.pumpWidget(_viewer(_source(requests), currentUserId: 8));
    expect(find.textContaining('Private'), findsOneWidget);
    expect(find.bySemanticsLabel('Share artifact'), findsNothing);
  });

  testWidgets('sharing contract: visibility selection is an enabled mutation',
      (tester) async {
    // Regression: disabled radios create a dialog but no share journey.
    final requests = <http.Request>[];
    await tester.pumpWidget(_viewer(_source(requests)));
    await tester.tap(find.bySemanticsLabel('Share artifact'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Shared'));
    await tester.pumpAndSettle();
    expect(
        requests.any((request) =>
            request.method == 'PATCH' &&
            request.url.path.endsWith('/live-artifacts/stable-artifact-id')),
        isTrue);
    expect(find.textContaining('Shared'), findsWidgets);
  });

  testWidgets('sharing contract: filters identities and mutates collaborators',
      (tester) async {
    // Regression: a visual list leaks IDs or cannot complete add/remove.
    final requests = <http.Request>[];
    await tester.pumpWidget(_viewer(_source(requests)));
    await tester.tap(find.bySemanticsLabel('Share artifact'));
    await tester.pumpAndSettle();
    expect(find.text('Alex Smith'), findsOneWidget);
    expect(find.text('8'), findsNothing);
    await tester.enterText(
        find.bySemanticsLabel('Search workspace users'), 'jordan@');
    await tester.pump();
    expect(find.text('Jordan Lee'), findsOneWidget);
    await tester.tap(find.text('Add'));
    await tester.pumpAndSettle();
    await tester.enterText(find.bySemanticsLabel('Search workspace users'), '');
    await tester.pump();
    await tester.tap(find.bySemanticsLabel('Remove Alex Smith'));
    await tester.pumpAndSettle();
    expect(find.textContaining('revokes access but does not delete'),
        findsOneWidget);
    expect(
        requests.where((request) =>
            request.method == 'POST' &&
            request.url.path.endsWith('/collaborators')),
        isNotEmpty);
    expect(
        requests.where((request) =>
            request.method == 'DELETE' &&
            request.url.path.endsWith('/collaborators/8')),
        isNotEmpty);
    expect(
        requests
            .where((request) =>
                request.method == 'GET' && request.url.path == '/users')
            .length,
        1);
    expect(
        requests
            .where((request) =>
                request.method == 'GET' &&
                request.url.path == '/live-artifacts/stable-artifact-id')
            .length,
        greaterThanOrEqualTo(4));
  });
}
