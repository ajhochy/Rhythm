import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/errors/app_error.dart';
import 'package:rhythm_desktop/features/notifications/controllers/agent_approvals_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/agent_approvals_data_source.dart';
import 'package:rhythm_desktop/features/notifications/models/agent_approval.dart';

class _FakeAgentApprovalsDataSource implements AgentApprovalsDataSource {
  List<AgentApproval> pending = [];
  final List<String> decided = [];
  Object? listError;
  Object? decisionError;

  @override
  Future<List<AgentApproval>> listPending() async {
    if (listError case final error?) throw error;
    return pending;
  }

  @override
  Future<void> decide(
    AgentApproval approval, {
    required bool approve,
  }) async {
    if (decisionError case final error?) throw error;
    decided.add('${approval.id}:${approve ? 'approved' : 'rejected'}');
    pending = pending.where((a) => a.id != approval.id).toList();
  }
}

AgentApproval _approval(String id) => AgentApproval(
      id: id,
      action: 'Schedule Jane Doe',
      preview: 'Add to Worship Leader slot',
      consequence: 'Jane gets an email immediately',
      status: 'pending',
      createdAt: DateTime.now(),
      decisionNonce: 'nonce-$id',
      payloadDigest: null,
    );

void main() {
  group('AgentApprovalsController', () {
    test('startPolling fetches pending approvals immediately', () async {
      final fake = _FakeAgentApprovalsDataSource()..pending = [_approval('a1')];
      final controller = AgentApprovalsController(fake);

      controller.startPolling();
      await Future<void>.delayed(Duration.zero);

      expect(controller.pending, hasLength(1));
      expect(controller.pending.first.id, 'a1');
      controller.stopPolling();
    });

    test(
        'approve removes the card from pending and calls decide(approve: true)',
        () async {
      final fake = _FakeAgentApprovalsDataSource()..pending = [_approval('a1')];
      final controller = AgentApprovalsController(fake);
      controller.startPolling();
      await Future<void>.delayed(Duration.zero);

      await controller.approve('a1');

      expect(controller.pending, isEmpty);
      expect(fake.decided, contains('a1:approved'));
      controller.stopPolling();
    });

    test(
        'reject removes the card from pending and calls decide(approve: false)',
        () async {
      final fake = _FakeAgentApprovalsDataSource()..pending = [_approval('a1')];
      final controller = AgentApprovalsController(fake);
      controller.startPolling();
      await Future<void>.delayed(Duration.zero);

      await controller.reject('a1');

      expect(controller.pending, isEmpty);
      expect(fake.decided, contains('a1:rejected'));
      controller.stopPolling();
    });

    test('401 poll exposes re-auth state and preserves the last-known list',
        () async {
      final fake = _FakeAgentApprovalsDataSource()..pending = [_approval('a1')];
      final controller = AgentApprovalsController(fake);
      var notifications = 0;
      controller.addListener(() => notifications++);
      controller.startPolling();
      await Future<void>.delayed(Duration.zero);
      final afterSuccess = notifications;

      fake.listError = AppError('stale session', statusCode: 401);
      controller.startPolling();
      await Future<void>.delayed(Duration.zero);

      expect(controller.authState, AgentApprovalAuthState.needsSignIn);
      expect(controller.pending.map((item) => item.id), ['a1']);
      expect(notifications, greaterThan(afterSuccess));

      fake.listError = null;
      controller.startPolling();
      await Future<void>.delayed(Duration.zero);
      expect(controller.authState, AgentApprovalAuthState.ready);
      expect(controller.pending.map((item) => item.id), ['a1']);
      controller.stopPolling();
    });

    test('403 poll exposes capability-unavailable state with distinct copy',
        () async {
      final fake = _FakeAgentApprovalsDataSource()
        ..listError = AppError('capability rejected', statusCode: 403);
      final controller = AgentApprovalsController(fake);

      controller.startPolling();
      await Future<void>.delayed(Duration.zero);

      expect(
        controller.authState,
        AgentApprovalAuthState.capabilityUnavailable,
      );
      expect(controller.authMessage, contains('approval capability'));
      controller.stopPolling();
    });

    test('decision auth failures stay visible and keep the card retryable',
        () async {
      final fake = _FakeAgentApprovalsDataSource()..pending = [_approval('a1')];
      final controller = AgentApprovalsController(fake);
      controller.startPolling();
      await Future<void>.delayed(Duration.zero);

      fake.decisionError = AppError('stale session', statusCode: 401);
      await controller.approve('a1');
      expect(controller.authState, AgentApprovalAuthState.needsSignIn);
      expect(controller.lastDecisionError, 'stale session');
      expect(controller.pending.map((item) => item.id), ['a1']);

      fake.decisionError = AppError('capability rejected', statusCode: 403);
      await controller.reject('a1');
      expect(
        controller.authState,
        AgentApprovalAuthState.capabilityUnavailable,
      );
      expect(controller.lastDecisionError, 'capability rejected');
      expect(controller.pending.map((item) => item.id), ['a1']);
      controller.stopPolling();
    });

    test(
        'signer StateError (missing Keychain capability/key) surfaces visibly '
        'and keeps the card retryable', () async {
      final fake = _FakeAgentApprovalsDataSource()..pending = [_approval('a1')];
      final controller = AgentApprovalsController(fake);
      controller.startPolling();
      await Future<void>.delayed(Duration.zero);

      fake.decisionError =
          StateError('Human approval signature is unavailable');
      await controller.approve('a1');

      // authState must move off `ready` — both call sites only render the
      // notice when authState != ready (#1382: no silent hangs).
      expect(controller.authState, isNot(AgentApprovalAuthState.ready));
      expect(controller.authMessage, isNotNull);
      expect(controller.lastDecisionError, isNotNull);
      // No raw exception dump leaked to the user-facing string.
      expect(controller.lastDecisionError, isNot(contains('StateError')));
      expect(controller.lastDecisionError, isNot(contains('Bad state')));
      expect(controller.pending.map((item) => item.id), ['a1']);
      controller.stopPolling();
    });

    test('network failure during decide() surfaces visibly and keeps the card',
        () async {
      final fake = _FakeAgentApprovalsDataSource()..pending = [_approval('a1')];
      final controller = AgentApprovalsController(fake);
      controller.startPolling();
      await Future<void>.delayed(Duration.zero);

      fake.decisionError =
          const SocketException('Connection refused', address: null);
      await controller.reject('a1');

      expect(controller.authState, isNot(AgentApprovalAuthState.ready));
      expect(controller.authMessage, isNotNull);
      expect(controller.lastDecisionError, isNotNull);
      expect(
        controller.lastDecisionError,
        isNot(contains('SocketException')),
      );
      expect(controller.pending.map((item) => item.id), ['a1']);
      controller.stopPolling();
    });

    test('decode failure during decide() surfaces visibly and keeps the card',
        () async {
      final fake = _FakeAgentApprovalsDataSource()..pending = [_approval('a1')];
      final controller = AgentApprovalsController(fake);
      controller.startPolling();
      await Future<void>.delayed(Duration.zero);

      fake.decisionError = const FormatException('Unexpected character at 0');
      await controller.approve('a1');

      expect(controller.authState, isNot(AgentApprovalAuthState.ready));
      expect(controller.authMessage, isNotNull);
      expect(controller.lastDecisionError, isNotNull);
      expect(
        controller.lastDecisionError,
        isNot(contains('FormatException')),
      );
      expect(controller.pending.map((item) => item.id), ['a1']);
      controller.stopPolling();
    });
  });
}
