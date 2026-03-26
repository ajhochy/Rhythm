import 'package:flutter/material.dart';

class PlaceholderCard extends StatelessWidget {
  const PlaceholderCard({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Card(
        child: Padding(padding: const EdgeInsets.all(12), child: Text(label)));
  }
}
