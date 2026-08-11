import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/agents/mcp_apps/mcp_app_host_policy.dart';

void main() {
  test('issue-1350-c5: bounds and lifecycle teardown are fail closed', () {
    final policy = McpAppHostPolicy(now: () => DateTime.utc(2026, 8, 10));
    final view = policy.openView(
      viewId: 'view-1',
      bootNonce: 'nonce-1',
      contentBytes: 1024,
      width: 800,
      height: 600,
    );
    expect(view.isOpen, isTrue);
    expect(policy.openViewCount, 1);
    expect(
      policy.validateMessage(
        viewId: 'view-1',
        origin: 'null',
        encodedMessage: jsonEncode({
          'id': 'request-1',
          'method': 'host.ping',
          'nonce': 'nonce-1',
        }),
      ),
      const McpAppHostDecision.allow('request-1', 'host.ping'),
    );

    expect(
      () => policy.openView(
        viewId: 'oversized',
        bootNonce: 'n',
        contentBytes: McpAppHostLimits.maxContentBytes + 1,
        width: 800,
        height: 600,
      ),
      throwsA(isA<McpAppHostDenied>()
          .having((e) => e.reason, 'reason', 'content_too_large')),
    );
    expect(
      policy.validateMessage(
        viewId: 'view-1',
        origin: 'null',
        encodedMessage: 'x' * (McpAppHostLimits.maxMessageBytes + 1),
      ),
      const McpAppHostDecision.deny('message_too_large'),
    );
    expect(policy.view('view-1')?.isOpen, isFalse);

    for (var i = 0; i < McpAppHostLimits.maxViews; i++) {
      policy.openView(
        viewId: 'bounded-$i',
        bootNonce: 'nonce-$i',
        contentBytes: 1,
        width: 1,
        height: 1,
      );
    }
    expect(
      () => policy.openView(
          viewId: 'too-many',
          bootNonce: 'n',
          contentBytes: 1,
          width: 1,
          height: 1),
      throwsA(isA<McpAppHostDenied>()
          .having((e) => e.reason, 'reason', 'too_many_views')),
    );
    policy.teardownAll();
    expect(policy.openViewCount, 0);
  });

  test(
      'issue-1350-c2/c6: stale nonce, origin, malformed and unknown methods deny deterministically',
      () {
    final policy = McpAppHostPolicy(now: DateTime.now);
    policy.openView(
        viewId: 'view',
        bootNonce: 'current',
        contentBytes: 1,
        width: 100,
        height: 100);

    McpAppHostDecision send(Map<String, Object?> message,
            {String origin = 'null'}) =>
        policy.validateMessage(
            viewId: 'view',
            origin: origin,
            encodedMessage: jsonEncode(message));

    expect(send({'id': '1', 'method': 'host.ping', 'nonce': 'stale'}),
        const McpAppHostDecision.deny('invalid_nonce'));
    expect(
        send({'id': '2', 'method': 'host.ping', 'nonce': 'current'},
            origin: 'https://evil.invalid'),
        const McpAppHostDecision.deny('invalid_origin'));
    expect(send({'id': '3', 'method': 'host.unknown', 'nonce': 'current'}),
        const McpAppHostDecision.deny('unsupported_method'));
    expect(send({'method': 'host.ping', 'nonce': 'current'}),
        const McpAppHostDecision.deny('malformed_message'));
    expect(policy.view('view')?.isOpen, isTrue);
  });
}
