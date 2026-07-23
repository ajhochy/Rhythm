// Regression test: the in-app update checker was offering a stale
// `vbeta.18.43` release instead of the true latest `v0.18.48`.
//
// Rhythm's release tags changed shape partway through its history:
//   - old scheme: `18.NN` / `beta.18.NN` (implied major "0", never written)
//   - new scheme: `0.18.NN` (major written explicitly), starting at v0.18.43
//
// `UpdateService._compareVersions` split each version on `.` and compared
// components positionally, padding a SHORTER list with zeros at the END —
// correct for a missing trailing patch number, wrong here, where the old
// scheme is missing its LEADING major. So `18.43` parsed to `[18, 43]`,
// which reads as far "newer" than `0.18.48`'s `[0, 18, 48]` (18 > 0 in the
// first slot) — every new-scheme release lost to any old-scheme version
// still in the last-10-releases window.
//
// UpdateService's version-comparison internals aren't exported, so this
// drives the real, unexported code path through `fetchAvailableUpdate()`
// with a canned HTTP response shaped exactly like the GitHub Releases API
// response that reproduced the bug (ajhochy/Rhythm's actual last 10
// releases as of the report).
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:rhythm_desktop/app/core/updates/update_service.dart';

/// The real shape of the last 10 `GET /repos/ajhochy/Rhythm/releases` items
/// at the time of the report — newest first, exactly as GitHub returns them.
final _realReleasesResponse = jsonEncode([
  _release('v0.18.48', prerelease: false),
  _release('v0.18.47', prerelease: false),
  _release('v0.18.46', prerelease: false),
  _release('v0.18.45', prerelease: false),
  _release('v0.18.44', prerelease: true),
  _release('v0.18.43', prerelease: true),
  _release('vbeta.18.43', prerelease: false),
  _release('vbeta.18.42', prerelease: false),
  _release('vbeta.18.41', prerelease: false),
  _release('vbeta.18.40', prerelease: false),
]);

Map<String, dynamic> _release(String tag, {required bool prerelease}) => {
  'draft': false,
  'prerelease': prerelease,
  'tag_name': tag,
  'name': 'Rhythm $tag',
  'html_url': 'https://github.com/ajhochy/Rhythm/releases/tag/$tag',
  'published_at': '2026-07-20T00:00:00Z',
  'body': 'notes',
  'assets': [
    {
      'name': 'Rhythm-macOS.dmg',
      'browser_download_url':
          'https://github.com/ajhochy/Rhythm/releases/download/$tag/Rhythm-macOS.dmg',
    },
  ],
};

class _StubClient extends http.BaseClient {
  _StubClient(this.body);
  final String body;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final bytes = utf8.encode(body);
    return http.StreamedResponse(Stream.value(bytes), 200);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  PackageInfo.setMockInitialValues(
    appName: 'Rhythm',
    packageName: 'com.rhythm.desktop',
    version: '0.1.0', // overridden per-test below via a fresh mock value
    buildNumber: '0',
    buildSignature: '',
  );

  Future<String?> latestOfferedVersion(String installedVersion) async {
    PackageInfo.setMockInitialValues(
      appName: 'Rhythm',
      packageName: 'com.rhythm.desktop',
      version: installedVersion,
      buildNumber: '0',
      buildSignature: '',
    );
    final service = UpdateService(client: _StubClient(_realReleasesResponse));
    final update = await service.fetchAvailableUpdate();
    return update?.version;
  }

  group('UpdateService version-scheme comparison (old 2-part vs new 3-part)', () {
    test(
      'an old-scheme install (beta.18.42) is offered the true latest, not a stale beta',
      () async {
        final offered = await latestOfferedVersion('beta.18.42');
        expect(offered, '0.18.48');
      },
    );

    test(
      'an old-scheme install (18.42, no "beta." prefix) is offered the true latest',
      () async {
        final offered = await latestOfferedVersion('18.42');
        expect(offered, '0.18.48');
      },
    );

    test(
      'a new-scheme install one patch behind is offered the true latest',
      () async {
        final offered = await latestOfferedVersion('0.18.47');
        expect(offered, '0.18.48');
      },
    );

    test('an up-to-date new-scheme install is offered nothing', () async {
      final service = UpdateService(client: _StubClient(_realReleasesResponse));
      PackageInfo.setMockInitialValues(
        appName: 'Rhythm',
        packageName: 'com.rhythm.desktop',
        version: '0.18.48',
        buildNumber: '0',
        buildSignature: '',
      );
      final update = await service.fetchAvailableUpdate();
      expect(update, isNull);
    });

    test(
      'an old-scheme install genuinely ahead of every listed release is offered nothing',
      () async {
        // 18.50 means "0.18.50" under this project's historical numbering —
        // ahead of every release in the canned list (max real patch is 48), so
        // this must NOT produce a false-positive "update available".
        final offered = await latestOfferedVersion('18.50');
        expect(offered, isNull);
      },
    );
  });
}
