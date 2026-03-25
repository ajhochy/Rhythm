import 'package:flutter/material.dart';

import 'app/core/layout/app_shell.dart';

void main() {
  // TODO: Initialize app bootstrap sequence.
  // TODO: Initialize dependency injection container.
  // TODO: Configure desktop window sizing/constraints for macOS first.
  runApp(const RhythmApp());
}

class RhythmApp extends StatelessWidget {
  const RhythmApp({super.key});

  @override
  Widget build(BuildContext context) {
    // TODO: Wire named routes / router configuration.
    return MaterialApp(
      title: 'Rhythm',
      debugShowCheckedModeBanner: false,
      home: const AppShell(),
    );
  }
}
