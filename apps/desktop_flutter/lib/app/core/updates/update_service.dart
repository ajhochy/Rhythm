import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import 'app_update_info.dart';

class UpdateService {
  UpdateService({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;

  static final Uri _releasesUri = Uri.parse(
    'https://api.github.com/repos/ajhochy/Rhythm/releases?per_page=10',
  );

  Future<String> getCurrentVersion() async {
    final info = await PackageInfo.fromPlatform();
    if (info.buildNumber.trim().isEmpty || info.buildNumber == '0') {
      return info.version;
    }
    return '${info.version}+${info.buildNumber}';
  }

  Future<AppUpdateInfo?> fetchAvailableUpdate() async {
    final currentVersion = _normalizeVersion(await getCurrentVersion());
    final response = await _client.get(
      _releasesUri,
      headers: const {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Rhythm-Desktop',
      },
    );

    if (response.statusCode >= 400) {
      throw Exception('Failed to check releases (${response.statusCode}).');
    }

    final releases = jsonDecode(response.body) as List<dynamic>;
    for (final item in releases.cast<Map<String, dynamic>>()) {
      if (item['draft'] == true) continue;
      final version = _normalizeVersion(
        (item['tag_name'] as String?) ?? (item['name'] as String? ?? ''),
      );
      if (_compareVersions(version, currentVersion) <= 0) continue;

      final assets = (item['assets'] as List<dynamic>? ?? [])
          .cast<Map<String, dynamic>>();
      final preferredAsset = _pickPreferredAsset(assets);
      final htmlUrl = item['html_url'] as String?;
      if (htmlUrl == null) continue;

      return AppUpdateInfo(
        version: version,
        name: (item['name'] as String?)?.trim().isNotEmpty == true
            ? item['name'] as String
            : version,
        htmlUrl: htmlUrl,
        downloadUrl:
            preferredAsset?['browser_download_url'] as String? ?? htmlUrl,
        publishedAt:
            DateTime.tryParse(item['published_at'] as String? ?? '') ??
            DateTime.now(),
        prerelease: item['prerelease'] == true,
        notes: item['body'] as String?,
      );
    }

    return null;
  }

  Future<void> openDownload(AppUpdateInfo update) async {
    final uri = Uri.parse(update.downloadUrl);
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      throw Exception('Unable to open download URL.');
    }
  }

  Future<void> openReleaseNotes(AppUpdateInfo update) async {
    final uri = Uri.parse(update.htmlUrl);
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      throw Exception('Unable to open release notes URL.');
    }
  }

  static Map<String, dynamic>? _pickPreferredAsset(
    List<Map<String, dynamic>> assets,
  ) {
    for (final suffix in ['.dmg', '.zip', '.pkg']) {
      for (final asset in assets) {
        final name = (asset['name'] as String?)?.toLowerCase() ?? '';
        if (name.endsWith(suffix)) return asset;
      }
    }
    return assets.isEmpty ? null : assets.first;
  }

  static String _normalizeVersion(String version) {
    final plusIndex = version.indexOf('+');
    final withoutBuild = plusIndex == -1
        ? version.trim()
        : version.substring(0, plusIndex);
    return withoutBuild.replaceFirst(RegExp(r'^[^0-9]*'), '');
  }

  static int _compareVersions(String left, String right) {
    final leftParts = _VersionParts.parse(left);
    final rightParts = _VersionParts.parse(right);

    final maxLength = leftParts.numbers.length > rightParts.numbers.length
        ? leftParts.numbers.length
        : rightParts.numbers.length;
    for (var index = 0; index < maxLength; index++) {
      final leftNumber = index < leftParts.numbers.length
          ? leftParts.numbers[index]
          : 0;
      final rightNumber = index < rightParts.numbers.length
          ? rightParts.numbers[index]
          : 0;
      if (leftNumber != rightNumber) return leftNumber.compareTo(rightNumber);
    }

    if (leftParts.isPrerelease != rightParts.isPrerelease) {
      return leftParts.isPrerelease ? -1 : 1;
    }

    return left.compareTo(right);
  }
}

class _VersionParts {
  const _VersionParts({required this.numbers, required this.isPrerelease});

  final List<int> numbers;
  final bool isPrerelease;

  factory _VersionParts.parse(String raw) {
    final prerelease = raw.contains('-');
    final numericPart = raw.split('-').first;
    final numbers = numericPart
        .split('.')
        .map((part) => int.tryParse(part) ?? 0)
        .toList(growable: false);
    return _VersionParts(numbers: numbers, isPrerelease: prerelease);
  }
}
