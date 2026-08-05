// Transcript ordering regression test.
//
// Reported live 2026-08-05: a session's chat pane "went back up to" an older
// message after navigating away and back, and would not show the newest turns.
// The data was intact — the api_server had the newer messages — so this was
// purely a client ordering defect.
//
// Cause: `createdAt` has one-second granularity and an input/output pair
// routinely shares the same second. The tiebreaker string-compared ChatMessage.id,
// a heterogeneous mix of engine ids (whose embedded timestamp is DESCENDING, so
// lexical order runs backwards), async-wake ids and numeric db-id fallbacks. Every
// same-second pair could invert, pushing the newest turns away from the tail.
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';

ChatMessage msg(String id, String iso, {int? seq, String role = 'output'}) =>
    ChatMessage(
      id: id,
      sessionId: 's1',
      role: role,
      createdAt: DateTime.parse(iso),
      seq: seq,
    );

void main() {
  group('compareChatMessages', () {
    test('orders by time when the timestamps differ', () {
      final list = [
        msg('msg_b', '2026-08-05T21:28:39Z', seq: 3),
        msg('msg_a', '2026-08-05T21:25:36Z', seq: 1),
      ]..sort(compareChatMessages);
      expect(list.map((m) => m.id), ['msg_a', 'msg_b']);
    });

    test('a same-second input/output pair keeps insertion order', () {
      // The exact shape from the reported session: question and answer stamped
      // identically. Engine ids are descending, so the ANSWER sorts first
      // lexically — which is what broke it.
      final question = msg('msg_fd38124f7001z', '2026-08-05T21:25:36Z',
          seq: 188, role: 'input');
      final answer = msg('msg_fd38113cc001a', '2026-08-05T21:25:36Z', seq: 189);
      expect(answer.id.compareTo(question.id), lessThan(0),
          reason: 'precondition: lexical id order is REVERSED vs real order');

      final list = [answer, question]..sort(compareChatMessages);
      expect(list.map((m) => m.seq), [188, 189],
          reason: 'row id must decide, not the id string');
      expect(list.first.role, 'input');
    });

    test('the newest turns end up at the tail, not buried mid-transcript', () {
      // Three consecutive same-second exchanges, shuffled.
      final list = [
        msg('msg_z', '2026-08-05T21:28:39Z', seq: 194),
        msg('msg_m', '2026-08-05T21:25:36Z', seq: 189),
        msg('msg_y', '2026-08-05T21:28:39Z', seq: 193, role: 'input'),
        msg('msg_n', '2026-08-05T21:26:27Z', seq: 191),
        msg('msg_l', '2026-08-05T21:25:36Z', seq: 188, role: 'input'),
        msg('msg_o', '2026-08-05T21:26:27Z', seq: 190, role: 'input'),
      ]..sort(compareChatMessages);
      expect(list.map((m) => m.seq), [188, 189, 190, 191, 193, 194]);
      expect(list.last.seq, 194, reason: 'newest must be last');
    });

    test('a live message with no row id yet sorts last', () {
      // Optimistic send / mid-stream: no REST row, therefore newest.
      final live = msg('optimistic-1', '2026-08-05T21:28:39Z');
      final persisted = msg('msg_fd38999', '2026-08-05T21:28:39Z', seq: 194);
      final list = [live, persisted]..sort(compareChatMessages);
      expect(list.map((m) => m.id), ['msg_fd38999', 'optimistic-1']);
    });

    test('two live messages compare equal rather than flapping', () {
      final a = msg('live-a', '2026-08-05T21:28:39Z');
      final b = msg('live-b', '2026-08-05T21:28:39Z');
      expect(compareChatMessages(a, b), 0);
      expect(compareChatMessages(b, a), 0);
    });

    test('an older backfilled page cannot jump ahead of newer turns', () {
      // The "load older" path rehydrates through the same store. Before the fix
      // these could land at the tail; row ids keep them in place.
      final older = msg('msg_old', '2026-08-05T20:00:00Z', seq: 10);
      final newer = msg('msg_new', '2026-08-05T21:28:39Z', seq: 194);
      final list = [newer, older]..sort(compareChatMessages);
      expect(list.map((m) => m.seq), [10, 194]);
    });
  });

  partsWeightTests();
}

// ---------------------------------------------------------------------------
// Parts completeness (separate defect from ordering).
//
// Reported live 2026-08-05, AFTER the ordering fix shipped: transcripts still
// missing content when navigating back to an ACTIVE session. Different cause —
// content, not order. Rehydrate used to skip the REST parts whenever ANY local
// part existed ("avoid overwriting live streaming state"), which protected
// in-flight streams and permanently stranded interrupted ones identically: a
// partial delta left behind by navigating away mid-stream blocked the finished
// REST text forever.
// ---------------------------------------------------------------------------

ChatPart part(String id, String text) =>
    ChatPart(id: id, messageId: 'm1', type: 'text', text: text);

void partsWeightTests() {
  group('partsWeight / completeness', () {
    test('an empty or null set weighs nothing', () {
      expect(partsWeight(null), 0);
      expect(partsWeight(<ChatPart>[]), 0);
    });

    test('REST beats a truncated local fragment', () {
      final localFragment = [part('p1', 'Verification pas')];
      final restFinished = [
        part('p1', 'Verification passed at 439cc06 and the branch was pushed.'),
      ];
      expect(
          partsWeight(restFinished), greaterThan(partsWeight(localFragment)));
    });

    test('a live stream ahead of the DB is NOT clobbered', () {
      // Same part count, but local has more text than the DB has persisted.
      final liveAhead = [part('p1', 'a much longer in-flight streamed body')];
      final restBehind = [part('p1', 'a much long')];
      expect(partsWeight(restBehind), lessThan(partsWeight(liveAhead)));
    });

    test('counts part COUNT too, so equal text but more parts wins', () {
      final one = [part('p1', 'abc')];
      final two = [part('p1', 'ab'), part('p2', 'c')];
      expect(partsWeight(two), greaterThan(partsWeight(one)));
    });

    test('ties adopt REST, so a finished message converges on the server copy',
        () {
      final a = [part('p1', 'same')];
      final b = [part('p1', 'same')];
      expect(partsWeight(a) >= partsWeight(b), isTrue);
    });
  });
}
