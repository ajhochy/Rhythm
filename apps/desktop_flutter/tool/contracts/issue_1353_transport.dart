// ignore_for_file: avoid_print

import 'dart:async';
import 'dart:convert';
import 'package:rhythm_desktop/features/agents/mcp_apps/mcp_app_host_policy.dart';
import 'package:rhythm_desktop/features/agents/mcp_apps/mcp_app_transport.dart';

Never fail(String m) => throw StateError('CONTRACT FAILURE: $m');
void expectTrue(bool v, String m) {
  if (!v) fail(m);
}

Future<void> expectFails(Future<dynamic> future, String message) async {
  try {
    await future;
  } on Object {
    return;
  }
  fail(message);
}

Future<void> main() async {
  final now = DateTime.utc(2026, 8, 10);
  final policy = McpAppHostPolicy(now: () => now);
  policy.openView(
    viewId: 'view',
    bootNonce: 'boot',
    contentBytes: 1,
    width: 800,
    height: 360,
    mode: McpAppHostMode.interactive,
  );
  final valid = policy.validateMessage(
    viewId: 'view',
    origin: 'null',
    encodedMessage: jsonEncode({
      'id': 'frame-1',
      'method': 'host.next-gate',
      'nonce': 'boot',
      'params': {'value': 1},
    }),
  );
  expectTrue(valid.isAllowed, 'trusted shell rejected valid bound message');
  for (final denied in [
    policy.validateMessage(
      viewId: 'view',
      origin: 'https://attacker.invalid',
      encodedMessage: '{}',
    ),
    policy.validateMessage(
      viewId: 'view',
      origin: 'null',
      encodedMessage: jsonEncode({
        'id': 'frame-2',
        'method': 'host.next-gate',
        'nonce': 'wrong',
        'params': {},
      }),
    ),
    policy.validateMessage(
      viewId: 'view',
      origin: 'null',
      encodedMessage: jsonEncode({
        'id': 'frame-3',
        'method': 'host.next-gate',
        'nonce': 'boot',
        'params': 'malformed',
      }),
    ),
  ]) {
    expectTrue(!denied.isAllowed, 'untrusted iframe message was brokered');
  }

  final outbound = <String>[];
  final events = <Object?>[];
  final transport = McpAppTransport(
    viewCapability: 'opaque-view-cap',
    send: (message) async => outbound.add(message),
    onEvent: events.add,
    timeout: const Duration(milliseconds: 20),
  );
  final pending = transport.request('host.next-gate', {'value': 1});
  final sent = jsonDecode(outbound.single) as Map<String, dynamic>;
  expectTrue(sent['capability'] == 'opaque-view-cap' && sent['id'] is String,
      'missing opaque correlation');
  final encoded = jsonEncode(sent);
  for (final secret in [
    'Bearer ',
    'localhost:4001',
    'serverName',
    'resourceUri',
    'ui://',
    'mcp'
  ]) {
    expectTrue(!encoded.contains(secret), 'raw authority leaked: $secret');
  }
  transport.receive(jsonEncode({
    'kind': 'response',
    'id': sent['id'],
    'result': {'ok': true}
  }));
  expectTrue((await pending as Map)['ok'] == true, 'response not correlated');
  transport.receive(jsonEncode({
    'kind': 'event',
    'event': {'type': 'theme', 'value': 'dark'}
  }));
  expectTrue(events.length == 1, 'async event not delivered');

  final timedOut = transport.request('host.next-gate', {});
  await expectFails(timedOut, 'timeout allowed');
  final disconnected = transport.request('host.next-gate', {});
  transport.disconnect();
  await expectFails(disconnected, 'disconnect allowed');
  expectTrue(
      transport.pendingCount == 0, 'disconnect retained pending requests');
  transport.teardown();
  expectTrue(!transport.receive('{"kind":"event","event":{}}'),
      'teardown accepted event');
  print('issue-1353 transport PASS');
}
