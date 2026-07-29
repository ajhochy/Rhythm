import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/notifications/controllers/agent_approvals_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/agent_approvals_data_source.dart';
import 'package:rhythm_desktop/features/notifications/models/agent_approval.dart';

class _FakeAgentApprovalsDataSource implements AgentApprovalsDataSource {
  List<AgentApproval> pending = [];
  final List<String> decided = [];

  @override
  Future<List<AgentApproval>> listPending() async => pending;

  @override
  Future<void> decide(AgentApproval approval, {required bool approve}) async {
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
        final fake = _FakeAgentApprovalsDataSource()
          ..pending = [_approval('a1')];
        final controller = AgentApprovalsController(fake);
        controller.startPolling();
        await Future<void>.delayed(Duration.zero);

        await controller.approve('a1');

        expect(controller.pending, isEmpty);
        expect(fake.decided, contains('a1:approved'));
        controller.stopPolling();
      },
    );

    test(
      'reject removes the card from pending and calls decide(approve: false)',
      () async {
        final fake = _FakeAgentApprovalsDataSource()
          ..pending = [_approval('a1')];
        final controller = AgentApprovalsController(fake);
        controller.startPolling();
        await Future<void>.delayed(Duration.zero);

        await controller.reject('a1');

        expect(controller.pending, isEmpty);
        expect(fake.decided, contains('a1:rejected'));
        controller.stopPolling();
      },
    );
  });
}
