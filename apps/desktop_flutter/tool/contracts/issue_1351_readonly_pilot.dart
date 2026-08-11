import 'dart:convert';
import 'dart:io';

import 'package:rhythm_desktop/features/agents/mcp_apps/mcp_app_readonly_host.dart';

Never _fail(String message) => throw StateError('CONTRACT FAILURE: $message');
void _expect(bool value, String message) {
  if (!value) _fail(message);
}

Future<void> main() async {
  var reads = 0;
  var mutations = 0;
  final host = McpAppReadOnlyHost(
    mode: 'readonly',
    sessionId: 'session-local',
    callId: 'call-open-design',
    fallbackText: 'Open Design result remains readable',
    structuredFallback: const {'document': 'demo'},
    fetchResource: ({required sessionId, required callId}) async {
      reads++;
      _expect(sessionId == 'session-local' && callId == 'call-open-design',
          'caller authority crossed resource boundary');
      return const McpAppHtmlResource(
          mimeType: 'text/html;profile=mcp-app', text: '<main>generic</main>');
    },
    onMutation: (_) async {
      mutations++;
    },
  );
  _expect(host.snapshot.fallbackVisible && !host.snapshot.htmlVisible,
      'fallback not visible before load');
  await host.load();
  _expect(reads == 1 && host.snapshot.htmlVisible,
      'descriptor-driven resource did not load');
  _expect(
      host.snapshot.fallbackVisible, 'fallback disappeared after HTML load');
  for (final method in [
    'tools/call',
    'open-link',
    'context/update',
    'unknown'
  ]) {
    final result = await host.handleAppMessage(
        jsonEncode({'id': 'x', 'method': method, 'nonce': host.bootNonce}));
    _expect(result.reason == 'unsupported_method',
        '$method did not deny deterministically');
  }
  _expect(mutations == 0, 'readonly denial mutated state');
  host.teardown();
  _expect(!host.snapshot.htmlVisible, 'teardown retained HTML view');

  final failed = McpAppReadOnlyHost(
      mode: 'readonly',
      sessionId: 's',
      callId: 'c',
      fallbackText: 'usable',
      fetchResource: ({required sessionId, required callId}) async =>
          throw StateError('offline'));
  await failed.load();
  _expect(
      failed.snapshot.fallbackVisible &&
          !failed.snapshot.htmlVisible &&
          failed.snapshot.errorCode == 'resource_unavailable',
      'resource failure lost fallback');

  var offReads = 0;
  final off = McpAppReadOnlyHost(
      mode: 'off',
      sessionId: 's',
      callId: 'c',
      fallbackText: 'generic',
      fetchResource: ({required sessionId, required callId}) async {
        offReads++;
        return const McpAppHtmlResource(
            mimeType: 'text/html;profile=mcp-app', text: 'bad');
      });
  await off.load();
  _expect(
      offReads == 0 &&
          off.snapshot.isGenericToolCard &&
          !off.snapshot.htmlVisible,
      'off mode was not inert');

  final source = File('lib/features/agents/mcp_apps/mcp_app_readonly_host.dart')
      .readAsStringSync();
  _expect(!source.toLowerCase().contains('open design'),
      'generic host contains pilot-specific branch');
  final viewSource =
      File('lib/features/agents/mcp_apps/mcp_app_readonly_view.dart')
          .readAsStringSync();
  _expect(!viewSource.contains('{...event.data, nonce}'),
      'trusted shell forged the current nonce onto child messages');
  for (final lifecycle in [
    'initialize(',
    'deliverInput(',
    'deliverResult(',
    'updateSize(',
    'ping('
  ]) {
    _expect(viewSource.contains(lifecycle),
        'missing post-load lifecycle delivery: $lifecycle');
  }
  stdout.writeln('issue-1351 contract PASS');
}
