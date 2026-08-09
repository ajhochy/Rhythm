/// Contract coverage for the desktop workspace header navigation.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/layout/navigation_sidebar.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/messages/controllers/messages_controller.dart';
import 'package:rhythm_desktop/features/messages/data/messages_data_source.dart';
import 'package:rhythm_desktop/features/messages/repositories/messages_repository.dart';

class _MessagesWithUnread extends MessagesController {
  _MessagesWithUnread(this.unread)
      : super(
          MessagesRepository(MessagesDataSource()),
          notifications: LocalNotificationService(),
        );

  final int unread;

  @override
  int get totalUnreadCount => unread;
}

Widget _navigation({
  required int selectedIndex,
  required ValueChanged<int> onItemSelected,
  required MessagesController messages,
  bool completeHeader = false,
}) =>
    MultiProvider(
      providers: [
        ChangeNotifierProvider<MessagesController>.value(value: messages)
      ],
      child: MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(
          body: SizedBox(
            height: 52,
            child: Row(
              children: [
                Flexible(
                  child: NavigationSidebar(
                    selectedIndex: selectedIndex,
                    collapsed: false,
                    onItemSelected: onItemSelected,
                  ),
                ),
                if (completeHeader) ...[
                  const SizedBox(width: 180),
                ],
              ],
            ),
          ),
        ),
      ),
    );

void main() {
  testWidgets('global navigation is a compact shell-header control',
      (tester) async {
    final messages = _MessagesWithUnread(0);
    addTearDown(messages.dispose);

    await tester.pumpWidget(
      _navigation(selectedIndex: 0, onItemSelected: (_) {}, messages: messages),
    );

    // Regression: restoring the old 260px side rail steals workspace width.
    expect(
        find.byKey(const ValueKey('global-navigation-tabs')), findsOneWidget);
  });

  testWidgets('tabs preserve all workspace indices and the unread badge',
      (tester) async {
    final messages = _MessagesWithUnread(3);
    addTearDown(messages.dispose);
    int? selected;

    await tester.binding.setSurfaceSize(const Size(1600, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _navigation(
        selectedIndex: 5,
        onItemSelected: (index) => selected = index,
        messages: messages,
      ),
    );

    expect(find.bySemanticsLabel('3 unread messages'), findsOneWidget);
    for (final entry in <(String, int)>[
      ('Dashboard', 0),
      ('Planner', 1),
      ('Tasks', 2),
      ('Rhythms', 3),
      ('Projects', 4),
      ('Messages', 5),
      ('Facilities', 6),
      ('Automations', 7),
      ('Integrations', 8),
      ('Agents', 9),
    ]) {
      await tester.tap(find.text(entry.$1));
      expect(selected, entry.$2);
    }
  });

  testWidgets('wide complete header gives navigation all pre-control width',
      (tester) async {
    final messages = _MessagesWithUnread(0);
    addTearDown(messages.dispose);
    await tester.binding.setSurfaceSize(const Size(1600, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    // Regression: a Flexible navigation followed by Spacer allocated only half
    // the pre-control header width, hiding tabs despite a wide desktop shell.
    await tester.pumpWidget(
      _navigation(
        selectedIndex: 0,
        onItemSelected: (_) {},
        messages: messages,
        completeHeader: true,
      ),
    );

    for (final label in [
      'Dashboard',
      'Planner',
      'Tasks',
      'Rhythms',
      'Projects',
      'Messages',
      'Facilities',
      'Automations',
      'Integrations',
      'Agents',
    ]) {
      expect(find.text(label), findsOneWidget);
    }
    expect(find.text('More'), findsNothing);
  });

  testWidgets('selected tab uses an accent underline, not an accent pill',
      (tester) async {
    final messages = _MessagesWithUnread(0);
    addTearDown(messages.dispose);

    await tester.pumpWidget(
      _navigation(selectedIndex: 0, onItemSelected: (_) {}, messages: messages),
    );

    final dashboardButton = tester.widget<TextButton>(
      find.ancestor(
          of: find.text('Dashboard'), matching: find.byType(TextButton)),
    );
    expect(dashboardButton.style?.backgroundColor?.resolve({}),
        anyOf(isNull, Colors.transparent));
    expect(
      dashboardButton.style?.side?.resolve({WidgetState.focused})?.width,
      2,
    );
    expect(
      find.byKey(const ValueKey('global-navigation-active-underline')),
      findsOneWidget,
    );
  });

  testWidgets('narrow navigation keeps core tabs and sends overflow to More',
      (tester) async {
    final messages = _MessagesWithUnread(0);
    addTearDown(messages.dispose);

    await tester.binding.setSurfaceSize(const Size(720, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _navigation(selectedIndex: 0, onItemSelected: (_) {}, messages: messages),
    );

    expect(find.text('Dashboard'), findsOneWidget);
    expect(find.text('More'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('More is selected and exposes the active overflow destination',
      (tester) async {
    final messages = _MessagesWithUnread(0);
    addTearDown(messages.dispose);

    await tester.binding.setSurfaceSize(const Size(720, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _navigation(selectedIndex: 6, onItemSelected: (_) {}, messages: messages),
    );

    expect(
      tester.getSemantics(find.text('More')),
      containsSemantics(isSelected: true, isButton: true),
    );
    await tester.tap(find.text('More'));
    await tester.pumpAndSettle();
    expect(
      tester.getSemantics(find.text('Facilities')),
      containsSemantics(isSelected: true),
    );
    expect(find.text('Automations'), findsOneWidget);
    expect(find.text('Integrations'), findsOneWidget);
  });

  testWidgets('200% text scale uses More without scaling down navigation',
      (tester) async {
    final messages = _MessagesWithUnread(0);
    addTearDown(messages.dispose);
    await tester.binding.setSurfaceSize(const Size(1024, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    // Regression: FittedBox silently shrank 200% labels instead of overflowing
    // destinations into More.
    await tester.pumpWidget(MediaQuery(
      data: const MediaQueryData(textScaler: TextScaler.linear(2)),
      child: _navigation(
        selectedIndex: 0,
        onItemSelected: (_) {},
        messages: messages,
      ),
    ));

    expect(find.byType(FittedBox), findsNothing);
    expect(find.text('More'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('1024px at 200% keeps More on the compact navigation row',
      (tester) async {
    final messages = _MessagesWithUnread(0);
    addTearDown(messages.dispose);
    await tester.binding.setSurfaceSize(const Size(1024, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    // Regression: Wrap placed More alone on a second row, doubling the header.
    await tester.pumpWidget(MediaQuery(
      data: const MediaQueryData(textScaler: TextScaler.linear(2)),
      child: _navigation(
        selectedIndex: 0,
        onItemSelected: (_) {},
        messages: messages,
      ),
    ));

    final navigation =
        tester.getRect(find.byKey(const ValueKey('global-navigation-tabs')));
    final dashboardCenter = tester.getCenter(find.text('Dashboard'));
    final moreCenter = tester.getCenter(find.text('More'));
    final visibleTabs = [
      'Dashboard',
      'Planner',
      'Tasks',
      'Rhythms',
      'Projects',
      'Messages',
      'Facilities',
      'Automations',
      'Integrations',
      'Agents',
    ].where((label) => find.text(label).evaluate().isNotEmpty).length;

    expect(navigation.height, 48);
    expect(moreCenter.dy, dashboardCenter.dy);
    expect(visibleTabs, 4);
  });

  testWidgets('unread count is an accessible indicator, not white danger text',
      (tester) async {
    final messages = _MessagesWithUnread(3);
    addTearDown(messages.dispose);

    await tester.pumpWidget(
      _navigation(selectedIndex: 0, onItemSelected: (_) {}, messages: messages),
    );

    expect(find.bySemanticsLabel('3 unread messages'), findsOneWidget);
    expect(find.text('3'), findsNothing);
  });
}
