import 'package:flutter/material.dart';

import 'navigation_sidebar.dart';
import 'split_view_placeholder.dart';

/// Desktop-first application shell.
class AppShell extends StatelessWidget {
  const AppShell({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Row(
        children: const [
          NavigationSidebar(),
          Expanded(child: SplitViewPlaceholder()),
        ],
      ),
    );
  }
}
