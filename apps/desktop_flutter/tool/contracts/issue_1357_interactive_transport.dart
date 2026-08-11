// ignore_for_file: avoid_print

import 'dart:convert';
import 'package:rhythm_desktop/features/agents/mcp_apps/mcp_app_host_policy.dart';
import 'package:rhythm_desktop/features/agents/mcp_apps/mcp_app_transport.dart';

Never fail(String message) => throw StateError('CONTRACT FAILURE: $message');

Future<void> main() async {
  final policy = McpAppHostPolicy(now: () => DateTime.utc(2026, 8, 10));
  policy.openView(
    viewId: 'origin-view',
    bootNonce: 'boot-nonce',
    contentBytes: 1,
    width: 800,
    height: 360,
    mode: McpAppHostMode.interactive,
  );
  final message = jsonEncode({
    'id': 'app-call-1',
    'method': 'tools/call',
    'nonce': 'boot-nonce',
    'params': {
      'name': 'origin_do',
      'arguments': {'value': 'safe'},
    },
  });
  if (!policy
      .validateMessage(
          viewId: 'origin-view', origin: 'null', encodedMessage: message)
      .isAllowed) {
    fail('same-origin tools/call was denied');
  }

  final outbound = <String>[];
  final transport = McpAppTransport(
    viewCapability: 'opaque-view-capability',
    send: (encoded) async => outbound.add(encoded),
    onEvent: (_) {},
  );
  final pending = transport.request('tools/call', {
    'name': 'origin_do',
    'arguments': {'value': 'safe'},
  });
  final sent = jsonDecode(outbound.single) as Map<String, dynamic>;
  final wire = jsonEncode(sent);
  if (wire.contains('engineProof') ||
      wire.contains('serverName') ||
      wire.contains('ui://')) {
    fail('trusted engine authority leaked to the iframe transport');
  }
  transport.receive(jsonEncode({
    'kind': 'response',
    'id': sent['id'],
    'result': {
      'structuredContent': {'ok': true},
    },
  }));
  final result = await pending as Map<String, dynamic>;
  if ((result['structuredContent'] as Map<String, dynamic>)['ok'] != true) {
    fail('structured result was not correlated to its originating request');
  }
  transport.teardown();
  print('issue-1357 interactive transport PASS');
}
