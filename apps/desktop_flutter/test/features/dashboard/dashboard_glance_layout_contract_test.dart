import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:step_progress_indicator/step_progress_indicator.dart';
import 'package:rhythm_desktop/app/core/auth/auth_data_source.dart';
import 'package:rhythm_desktop/app/core/auth/auth_session_service.dart';
import 'package:rhythm_desktop/app/core/ui/focus_business_widgets.dart';
import 'package:rhythm_desktop/app/core/workspace/workspace_controller.dart';
import 'package:rhythm_desktop/app/core/workspace/workspace_data_source.dart';
import 'package:rhythm_desktop/app/core/workspace/workspace_repository.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/dashboard/controllers/dashboard_controller.dart';
import 'package:rhythm_desktop/features/dashboard/data/dashboard_data_source.dart';
import 'package:rhythm_desktop/features/dashboard/models/dashboard_overview_models.dart';
import 'package:rhythm_desktop/features/dashboard/repositories/dashboard_repository.dart';
import 'package:rhythm_desktop/features/dashboard/views/dashboard_view.dart';
import 'package:rhythm_desktop/features/projects/models/project_instance.dart';
import 'package:rhythm_desktop/features/tasks/models/task.dart';

void main() {
  testWidgets(
    'ui-dashboard-glance-c1: 1024px dashboard keeps Today and This Week paired',
    (tester) async {
      await _pumpDashboard(tester, const Size(1024, 700));
      _expectPairedGlanceCards(tester, expectedCardWidth: 464);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'ui-dashboard-glance-c2: 1440px dashboard uses balanced paired cards',
    (tester) async {
      await _pumpDashboard(tester, const Size(1440, 900));
      _expectPairedGlanceCards(tester, expectedCardWidth: 600);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'ui-dashboard-glance-c1: compact dial stacks above its 2x2 metric grid',
    (tester) async {
      await _pumpDashboard(tester, const Size(1024, 700));
      final cards =
          find.byType(FocusBusinessProjectProgress).evaluate().take(2);
      final today = find.byWidget(cards.first.widget);
      final dial = find.descendant(
        of: today,
        matching: find.byType(CircularStepProgressIndicator),
      );
      final complete =
          find.descendant(of: today, matching: find.text('COMPLETE'));
      final open = find.descendant(of: today, matching: find.text('OPEN'));
      final next = find.descendant(of: today, matching: find.text('NEXT'));
      final progress =
          find.descendant(of: today, matching: find.text('PROGRESS'));

      final dialRect = tester.getRect(dial);
      final completeRect = tester.getRect(complete);
      final openRect = tester.getRect(open);
      final nextRect = tester.getRect(next);
      final progressRect = tester.getRect(progress);
      // REGRESSION: putting the ring beside the metrics steals the grid width
      // and makes the compact dashboard read as a horizontal summary.
      expect(dialRect.top, lessThan(completeRect.top));
      expect(completeRect.top - dialRect.bottom, inInclusiveRange(8, 10));
      expect(completeRect.left, closeTo(dialRect.left, 2));
      expect(openRect.left, greaterThan(completeRect.left));
      expect(nextRect.top, greaterThan(completeRect.top));
      expect(progressRect.left, greaterThan(nextRect.left));
    },
  );

  testWidgets(
    'ui-dashboard-glance-c2: compact task lists occupy the right body region',
    (tester) async {
      await _pumpDashboard(tester, const Size(1024, 700));
      // REGRESSION: rendering this list after the summary wastes the card's
      // reclaimed right side instead of making a true left/right body split.
      _expectCompactBodySplit(tester);
      expect(find.text('On Deck'), findsNothing);
      expect(find.text('On Deck This Week'), findsNothing);
    },
  );

  testWidgets(
    'ui-dashboard-glance-c2: wide compact cards give reclaimed width to lists',
    (tester) async {
      await _pumpDashboard(tester, const Size(1440, 900));
      _expectCompactBodySplit(tester, minimumListWidth: 300);
    },
  );

  testWidgets(
    'ui-dashboard-glance-c3: six period tasks remain reachable in scrollable lists',
    (tester) async {
      await _pumpDashboard(tester, const Size(1024, 700));
      for (final title in _allTaskTitles) {
        expect(find.text(title), findsWidgets);
      }
      final cards =
          find.byType(FocusBusinessProjectProgress).evaluate().take(2);
      for (final card in cards) {
        final scrollable = find.descendant(
          of: find.byWidget(card.widget),
          matching: find.byType(SingleChildScrollView),
        );
        expect(scrollable, findsOneWidget);
        await tester.drag(scrollable, const Offset(0, -120));
        await tester.pump();
      }
    },
  );

  testWidgets(
    'ui-dashboard-glance-c4: an empty compact list keeps its completion description without a heading',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.light(),
          home: const Scaffold(
            body: SizedBox(
              width: 464,
              child: FocusBusinessProjectProgress(
                panelTitle: 'TODAY',
                title: "Today's Tasks",
                description: 'You are done.',
                progress: 1,
                metrics: [
                  FocusBusinessMetric(label: 'COMPLETE', value: '1/1'),
                  FocusBusinessMetric(label: 'OPEN', value: '0'),
                  FocusBusinessMetric(label: 'NEXT', value: 'Clear'),
                  FocusBusinessMetric(label: 'PROGRESS', value: '100%'),
                ],
                compact: true,
                showDescriptionTitle: false,
              ),
            ),
          ),
        ),
      );
      expect(find.text('You are done.'), findsOneWidget);
      expect(find.text('Project Description'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'ui-dashboard-glance-c5: 200% compact card subtree has no overflow',
    (tester) async {
      tester.binding.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(
        tester.binding.platformDispatcher.clearTextScaleFactorTestValue,
      );
      await tester.binding.setSurfaceSize(const Size(1024, 700));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.light(),
          home: Scaffold(
            body: SingleChildScrollView(
              child: Row(
                children: [
                  for (var index = 0; index < 2; index++)
                    const Expanded(child: _CompactCardSubtree()),
                ],
              ),
            ),
          ),
        ),
      );
      expect(find.byType(SingleChildScrollView), findsNWidgets(3));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'ui-dashboard-glance-c6: below 900px the glance cards may stack',
    (tester) async {
      await _pumpDashboard(tester, const Size(899, 700));
      final cards =
          find.byType(FocusBusinessProjectProgress).evaluate().take(2);
      final today = tester.getRect(find.byWidget(cards.first.widget));
      final thisWeek = tester.getRect(find.byWidget(cards.last.widget));
      expect(thisWeek.top, greaterThan(today.bottom));
    },
  );

  testWidgets(
    'ui-dashboard-glance-c3: default project progress remains full layout',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.light(),
          home: const Scaffold(
            body: SizedBox(
              width: 760,
              child: FocusBusinessProjectProgress(
                panelTitle: 'PROJECT',
                title: 'Default project card',
                description: 'No layout override is supplied.',
                progress: .5,
                metrics: [
                  FocusBusinessMetric(label: 'COMPLETE', value: '1/2'),
                  FocusBusinessMetric(label: 'OPEN', value: '1'),
                  FocusBusinessMetric(label: 'NEXT', value: 'Review'),
                  FocusBusinessMetric(label: 'PROGRESS', value: '50%'),
                ],
              ),
            ),
          ),
        ),
      );
      expect(find.text('Default project card'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'ui-dashboard-glance-c10: laptop compact cards keep every metric label on one line with a tight panel inset',
    (tester) async {
      await _pumpDashboard(tester, const Size(1024, 700));
      final cards =
          find.byType(FocusBusinessProjectProgress).evaluate().take(2);

      for (final card in cards) {
        final cardFinder = find.byWidget(card.widget);
        final cardRect = tester.getRect(cardFinder);
        final dialRect = tester.getRect(
          find.descendant(
            of: cardFinder,
            matching: find.byType(CircularStepProgressIndicator),
          ),
        );
        expect(dialRect.left - cardRect.left, inInclusiveRange(8, 12));
        expect(dialRect.width, inInclusiveRange(150, 166));
      }

      // REGRESSION: a narrow 2x2 metrics column wraps COMPLETE, TOMORROW, or
      // PROGRESS into a second line even though the labels must stay readable.
      for (final label in const [
        'COMPLETE',
        'OPEN',
        'NEXT',
        'PROGRESS',
        'TOMORROW',
      ]) {
        for (final element in find
            .descendant(
              of: find.byType(FocusBusinessProjectProgress),
              matching: find.text(label),
            )
            .evaluate()) {
          expect(
            element.renderObject!.paintBounds.height,
            lessThanOrEqualTo(22),
            reason:
                '$label must remain a one-line metric label (width: ${element.renderObject!.paintBounds.width})',
          );
        }
      }
      _expectCompactBodySplit(tester);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'ui-dashboard-glance-c11: screenshot-width compact card gives metrics room without sacrificing its list',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.light(),
          home: const Scaffold(
            body: SizedBox(width: 464, child: _CompactCardSubtree()),
          ),
        ),
      );
      final card = find.byType(FocusBusinessProjectProgress);
      final dial = find.descendant(
        of: card,
        matching: find.byType(CircularStepProgressIndicator),
      );
      final complete =
          find.descendant(of: card, matching: find.text('COMPLETE'));
      final progress =
          find.descendant(of: card, matching: find.text('PROGRESS'));
      final list = find.descendant(
        of: card,
        matching: find.byType(SingleChildScrollView),
      );
      final cardRect = tester.getRect(card);
      final dialRect = tester.getRect(dial);
      final completeRect = tester.getRect(complete);
      final progressRect = tester.getRect(progress);
      final listRect = tester.getRect(list);

      expect(dialRect.left - cardRect.left, inInclusiveRange(8, 12));
      expect(dialRect.width, inInclusiveRange(150, 166));
      expect(
          progressRect.right - completeRect.left, closeTo(dialRect.width, 2));
      expect(listRect.width, greaterThanOrEqualTo(150));
      expect(listRect.top, closeTo(dialRect.top, 4));
      expect(tester.takeException(), isNull);
    },
  );
}

Future<void> _pumpDashboard(WidgetTester tester, Size size) async {
  await tester.binding.setSurfaceSize(size);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final controller = DashboardController(
    DashboardRepository(_DashboardDataSource()),
  );
  await controller.load();
  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<DashboardController>.value(value: controller),
        ChangeNotifierProvider<AuthSessionService>(
          create: (_) => AuthSessionService(
            AuthDataSource(baseUrl: 'http://127.0.0.1:1'),
          ),
        ),
        ChangeNotifierProvider<WorkspaceController>.value(
          value: _NoopWorkspaceController(),
        ),
      ],
      child: MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(
          body: DashboardView(
            openWeeklyPlanner: () {},
            openRhythms: () {},
            openProjects: () {},
            openMessages: () {},
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void _expectPairedGlanceCards(
  WidgetTester tester, {
  required double expectedCardWidth,
}) {
  // REGRESSION: vertical hero cards waste laptop space or move This Week down.
  final cards = find.byType(FocusBusinessProjectProgress).evaluate().take(2);
  expect(cards, hasLength(2));
  expect(
    find
        .ancestor(
          of: find.text('TODAY'),
          matching: find.byType(FocusBusinessProjectProgress),
        )
        .evaluate()
        .single,
    same(cards.first),
  );
  expect(
    find
        .ancestor(
          of: find.text('THIS WEEK'),
          matching: find.byType(FocusBusinessProjectProgress),
        )
        .evaluate()
        .single,
    same(cards.last),
  );
  final today = tester.getRect(find.byWidget(cards.first.widget));
  final thisWeek = tester.getRect(find.byWidget(cards.last.widget));
  expect(today.top, thisWeek.top);
  expect(today.width, closeTo(expectedCardWidth, 40));
  expect(thisWeek.width, closeTo(expectedCardWidth, 40));
  expect((thisWeek.left - today.right).abs(), inInclusiveRange(12, 16));
}

void _expectCompactBodySplit(
  WidgetTester tester, {
  double minimumListWidth = 150,
}) {
  final cards = find.byType(FocusBusinessProjectProgress).evaluate().take(2);
  final today = find.byWidget(cards.first.widget);
  final dial = find.descendant(
    of: today,
    matching: find.byType(CircularStepProgressIndicator),
  );
  final complete = find.descendant(of: today, matching: find.text('COMPLETE'));
  final progress = find.descendant(of: today, matching: find.text('PROGRESS'));
  final list = find.descendant(
    of: today,
    matching: find.byType(SingleChildScrollView),
  );
  final cardRect = tester.getRect(today);
  final dialRect = tester.getRect(dial);
  final completeRect = tester.getRect(complete);
  final progressRect = tester.getRect(progress);
  final listRect = tester.getRect(list);
  expect(dialRect.top, lessThan(completeRect.top));
  expect(completeRect.left, closeTo(dialRect.left, 2));
  expect(progressRect.right - completeRect.left, closeTo(dialRect.width, 2));
  expect(listRect.left, greaterThan(dialRect.right));
  expect(listRect.left - dialRect.right, inInclusiveRange(8, 10));
  expect(listRect.top, closeTo(dialRect.top, 4));
  expect(listRect.width, greaterThanOrEqualTo(minimumListWidth));
  expect(listRect.bottom, lessThanOrEqualTo(cardRect.bottom));
}

class _DashboardDataSource extends DashboardDataSource {
  _DashboardDataSource() : super(baseUrl: 'http://127.0.0.1:1');

  @override
  Future<DashboardSummary> fetchSummary() async {
    final today = DateTime.now();
    final tomorrow = today.add(const Duration(days: 1));
    Task task(String id, String title, DateTime date) => Task(
          id: id,
          title: title,
          status: TaskStatus.open,
          dueDate: date.toIso8601String(),
          createdAt: '',
          updatedAt: '',
        );
    final todayTasks = [
      task('today-1', 'Today task 1', today),
      task('today-2', 'Today task 2', today),
      task('today-3', 'Today task 3', today),
    ];
    final thisWeekTasks = [
      task('week-1', 'This Week task 1', tomorrow),
      task('week-2', 'This Week task 2', tomorrow),
      task('week-3', 'This Week task 3', tomorrow),
    ];
    return DashboardSummary(
      tasks: DashboardSummaryTaskSlice(
        openCount: 6,
        pastDueCount: 0,
        pastDeadlineCount: 0,
        todayRemainingCount: 3,
        todayTotalCount: 3,
        thisWeekRemainingCount: 3,
        thisWeekTotalCount: 3,
        unscheduledCount: 0,
        recent: [...todayTasks, ...thisWeekTasks],
        pastDue: const [],
        today: todayTasks,
        thisWeek: thisWeekTasks,
        unscheduled: const [],
      ),
      rhythms: const [],
      projects: const [],
      messages: DashboardSummaryMessageSlice(
        threadCount: 0,
        unreadPreviews: const [],
      ),
    );
  }

  @override
  Future<List<ProjectInstance>> fetchProjectInstances() async => const [];
}

const _allTaskTitles = [
  'Today task 1',
  'Today task 2',
  'Today task 3',
  'This Week task 1',
  'This Week task 2',
  'This Week task 3',
];

class _CompactCardSubtree extends StatelessWidget {
  const _CompactCardSubtree();

  @override
  Widget build(BuildContext context) => const FocusBusinessProjectProgress(
        panelTitle: 'TODAY',
        title: "Today's Tasks",
        description: 'You are done.',
        progress: 0,
        metrics: [
          FocusBusinessMetric(label: 'COMPLETE', value: '0/3'),
          FocusBusinessMetric(label: 'OPEN', value: '3'),
          FocusBusinessMetric(label: 'NEXT', value: 'Today task 1'),
          FocusBusinessMetric(label: 'PROGRESS', value: '0%'),
        ],
        descriptionItems: [
          FocusOnDeckItem(title: 'Today task 1'),
          FocusOnDeckItem(title: 'Today task 2'),
        ],
        compact: true,
        showDescriptionTitle: false,
        compactListHeight: 120,
      );
}

class _NoopWorkspaceController extends WorkspaceController {
  _NoopWorkspaceController()
      : super(
          WorkspaceRepository(
            WorkspaceDataSource(baseUrl: 'http://127.0.0.1:1'),
          ),
        );

  @override
  Future<void> loadMembers() async {}
}
