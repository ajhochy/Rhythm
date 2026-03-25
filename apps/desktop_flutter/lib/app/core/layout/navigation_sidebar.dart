import 'package:flutter/material.dart';

class NavigationSidebar extends StatelessWidget {
  const NavigationSidebar({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 240,
      color: const Color(0xFF1F1F1F),
      padding: const EdgeInsets.all(16),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Rhythm', style: TextStyle(color: Colors.white, fontSize: 20)),
          SizedBox(height: 24),
          Text('Weekly Planner', style: TextStyle(color: Colors.white70)),
          SizedBox(height: 8),
          Text('Tasks', style: TextStyle(color: Colors.white70)),
          SizedBox(height: 8),
          Text('Projects', style: TextStyle(color: Colors.white70)),
          SizedBox(height: 8),
          Text('Integrations', style: TextStyle(color: Colors.white70)),
        ],
      ),
    );
  }
}
