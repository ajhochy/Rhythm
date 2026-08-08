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
}) =>
    MultiProvider(
      providers: [
        ChangeNotifierProvider<MessagesController>.value(value: messages)
      ],
      child: MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(
          body: NavigationSidebar(
            selectedIndex: selectedIndex,
            collapsed: false,
            onItemSelected: onItemSelected,
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

  testWidgets('narrow navigation keeps core tabs and sends overflow to More',
      (tester) async {
    final messages = _MessagesWithUnread(0);
    addTearDown(messages.dispose);

    await tester.binding.setSurfaceSize(const Size(720, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _navigation(selectedIndex: 0, onItemSelected: (_) {}, messages: messages),
    );

    for (final label in [
      'Dashboard',
      'Planner',
      'Tasks',
      'Rhythms',
      'Projects',
      'Messages',
      'Agents',
    ]) {
      expect(find.text(label), findsOneWidget);
    }
    expect(find.text('More'), findsOneWidget);
    expect(find.text('Facilities'), findsNothing);
    expect(find.text('Automations'), findsNothing);
    expect(find.text('Integrations'), findsNothing);
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
