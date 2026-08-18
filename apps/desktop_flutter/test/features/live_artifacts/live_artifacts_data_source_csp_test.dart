import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:rhythm_desktop/features/live_artifacts/data/live_artifacts_data_source.dart';

const _oldCloudPolicy =
    "default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; style-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'";

String _document(String policy) =>
    '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="$policy"></head><body>artifact</body></html>';

void main() {
  test('upgrades the known cloud policy for in-memory bundle assets only', () {
    final result = normalizeLiveArtifactRenderCsp(_document(_oldCloudPolicy));

    expect(result, contains("script-src 'unsafe-inline' blob: https://"));
    expect(result, contains('connect-src blob:'));
    expect(result, contains("default-src 'none'"));
    expect(result, contains("form-action 'none'"));
    expect(result, contains("frame-src 'none'"));
    expect(result, isNot(contains(RegExp(r'connect-src [^;]*https?:'))));
  });

  test('leaves an already compatible cloud policy unchanged', () {
    final compatible = _oldCloudPolicy
        .replaceFirst(
            "script-src 'unsafe-inline'", "script-src 'unsafe-inline' blob:")
        .replaceFirst("connect-src 'none'", 'connect-src blob:');
    final document = _document(compatible);

    expect(normalizeLiveArtifactRenderCsp(document), document);
  });

  test('leaves unrelated broader policies fail-closed', () {
    final unrelated = _document(_oldCloudPolicy.replaceFirst(
      "connect-src 'none'",
      'connect-src https://api.example.test',
    ));

    expect(normalizeLiveArtifactRenderCsp(unrelated), unrelated);
  });

  test('leaves malformed or ambiguous CSP metadata unchanged', () {
    final duplicateDirective = _document(
      "$_oldCloudPolicy; connect-src 'none'",
    );
    final duplicateMeta =
        '${_document(_oldCloudPolicy)}<meta http-equiv="Content-Security-Policy" content="$_oldCloudPolicy">';

    expect(
        normalizeLiveArtifactRenderCsp(duplicateDirective), duplicateDirective);
    expect(normalizeLiveArtifactRenderCsp(duplicateMeta), duplicateMeta);
    expect(
        normalizeLiveArtifactRenderCsp(
            '<meta http-equiv="Content-Security-Policy">'),
        '<meta http-equiv="Content-Security-Policy">');
  });

  test('render applies the compatibility transform to fetched cloud HTML',
      () async {
    final source = LiveArtifactsDataSource(
      baseUrl: 'https://cloud.example.test',
      client: MockClient((request) async => http.Response(
            _document(_oldCloudPolicy),
            200,
            headers: {'content-type': 'text/html'},
          )),
    );

    final result = await source.render('artifact-id');

    expect(result, contains("script-src 'unsafe-inline' blob:"));
    expect(result, contains('connect-src blob:'));
  });
}
