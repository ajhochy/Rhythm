import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';

/// M4-3: fetch the SDK's available slash-commands for the composer popover.
///
/// The api_server exposes `/opencode/commands` only when the SDK build
/// supports `client.command.list`. Older builds return an empty list, which
/// the popover renders as a quiet empty state — better than throwing.
class CommandsDataSource {
  CommandsDataSource({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;

  Future<List<SlashCommand>> list() async {
    try {
      final res = await _client.get(
        Uri.parse('${AppConstants.agentLocalBaseUrl}/opencode/commands'),
      );
      if (res.statusCode != 200) return const [];
      final raw = jsonDecode(res.body) as List<dynamic>;
      return raw
          .map((e) => SlashCommand.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return const [];
    }
  }
}

class SlashCommand {
  const SlashCommand({
    required this.name,
    this.description,
    this.hints = const [],
  });
  final String name;
  final String? description;

  /// OCU-11 (#1052): argument placeholders the engine parsed from the
  /// command's template (e.g. `['$1', '$2']` or `['$ARGUMENTS']`). Empty when
  /// the command takes no arguments.
  final List<String> hints;

  factory SlashCommand.fromJson(Map<String, dynamic> json) => SlashCommand(
    name: json['name'] as String? ?? '',
    description: json['description'] as String?,
    hints: (json['hints'] as List<dynamic>?)?.cast<String>() ?? const [],
  );
}
