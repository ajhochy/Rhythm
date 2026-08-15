import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/live_artifact.dart';

const _cloudArtifactScriptSources = {
  "'unsafe-inline'",
  'https://cdnjs.cloudflare.com',
  'https://cdn.jsdelivr.net',
  'https://unpkg.com',
};

/// Adds only the in-memory URL capabilities required by Rhythm's standalone
/// artifact bundles. Any unfamiliar or malformed policy is returned unchanged
/// so the cloud policy remains fail-closed.
String normalizeLiveArtifactRenderCsp(String html) {
  final metaPattern = RegExp(r'<meta\b[^>]*>', caseSensitive: false);
  final httpEquivPattern = RegExp(
    r'''http-equiv\s*=\s*(["'])\s*Content-Security-Policy\s*\1''',
    caseSensitive: false,
  );
  final contentPattern = RegExp(
    r'''content\s*=\s*(["'])(.*?)\1''',
    caseSensitive: false,
    dotAll: true,
  );
  final cspMetas = metaPattern
      .allMatches(html)
      .where((match) => httpEquivPattern.hasMatch(match.group(0)!))
      .toList(growable: false);
  if (cspMetas.length != 1) return html;

  final meta = cspMetas.single;
  final tag = meta.group(0)!;
  final content = contentPattern.firstMatch(tag);
  if (content == null) return html;

  final directives = content
      .group(2)!
      .split(';')
      .map((directive) => directive.trim())
      .where((directive) => directive.isNotEmpty)
      .toList(growable: true);
  final parsed = <String, List<String>>{};
  final indexes = <String, int>{};
  for (var index = 0; index < directives.length; index++) {
    final tokens = directives[index]
        .split(RegExp(r'\s+'))
        .where((token) => token.isNotEmpty)
        .toList(growable: false);
    if (tokens.isEmpty) return html;
    final name = tokens.first.toLowerCase();
    if (parsed.containsKey(name)) return html;
    parsed[name] = tokens.skip(1).map((token) => token.toLowerCase()).toList();
    indexes[name] = index;
  }

  if (!_sameSources(parsed['default-src'], const {"'none'"})) return html;
  final scriptSources = parsed['script-src'];
  final connectSources = parsed['connect-src'];
  if (scriptSources == null || connectSources == null) return html;
  final oldScripts = _sameSources(scriptSources, _cloudArtifactScriptSources);
  final blobScripts =
      _sameSources(scriptSources, {..._cloudArtifactScriptSources, 'blob:'});
  final blockedConnect = _sameSources(connectSources, const {"'none'"});
  final blobConnect = _sameSources(connectSources, const {'blob:'});
  if ((!oldScripts && !blobScripts) || (!blockedConnect && !blobConnect)) {
    return html;
  }
  if (blobScripts && blobConnect) return html;

  if (oldScripts) {
    final index = indexes['script-src']!;
    directives[index] = directives[index].replaceFirst(
      RegExp(r"^script-src\s+'unsafe-inline'", caseSensitive: false),
      "script-src 'unsafe-inline' blob:",
    );
    if (!directives[index].toLowerCase().contains('blob:')) return html;
  }
  if (blockedConnect) {
    directives[indexes['connect-src']!] = 'connect-src blob:';
  }

  final policy = '${directives.join('; ')};';
  final originalPolicy = content.group(2)!;
  final valueOffset = content.group(0)!.indexOf(originalPolicy);
  if (valueOffset < 0) return html;
  final valueStart = content.start + valueOffset;
  final updatedTag =
      tag.replaceRange(valueStart, valueStart + originalPolicy.length, policy);
  return html.replaceRange(meta.start, meta.end, updatedTag);
}

bool _sameSources(List<String>? actual, Set<String> expected) =>
    actual != null &&
    actual.length == expected.length &&
    actual.toSet().containsAll(expected);

class LiveArtifactsDataSource {
  LiveArtifactsDataSource(
      {String? baseUrl, http.Client? client, this.debugOnRequest})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl,
        _client = client;

  final String _baseUrl;
  final http.Client? _client;
  final void Function(String operation)? debugOnRequest;

  Future<List<LiveArtifact>> list() async {
    debugOnRequest?.call('list');
    final response = await (_client?.get ?? http.get)(
      Uri.parse('$_baseUrl/live-artifacts?type=html'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    return (jsonDecode(response.body) as List<dynamic>)
        .cast<Map<String, dynamic>>()
        .map(LiveArtifact.fromJson)
        .toList();
  }

  Future<LiveArtifact> get(String id) async {
    debugOnRequest?.call('get');
    final response = await (_client?.get ?? http.get)(
      Uri.parse('$_baseUrl/live-artifacts/$id'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    return LiveArtifact.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<LiveArtifact> create({
    required int workspaceId,
    required String title,
    required String html,
    String css = '',
    String js = '',
  }) async {
    debugOnRequest?.call('create');
    final response = await (_client?.post ?? http.post)(
      Uri.parse('$_baseUrl/live-artifacts'),
      headers: {
        ...AuthSessionStore.headers(),
        'Content-Type': 'application/json'
      },
      body: jsonEncode({
        'type': 'html',
        'title': title,
        'workspaceId': workspaceId,
        'visibility': 'private',
        'bundle': {'html': html, 'css': css, 'js': js},
        'state': {},
      }),
    );
    assertOk(response);
    return LiveArtifact.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<LiveArtifact> updateVisibility(
    String id,
    LiveArtifactVisibility visibility,
  ) async {
    debugOnRequest?.call('updateVisibility');
    final response = await (_client?.patch ?? http.patch)(
      Uri.parse('$_baseUrl/live-artifacts/$id'),
      headers: {
        ...AuthSessionStore.headers(),
        'Content-Type': 'application/json'
      },
      body: jsonEncode({'visibility': visibility.wireName}),
    );
    assertOk(response);
    return LiveArtifact.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<List<int>> collaborators(String id) async {
    debugOnRequest?.call('collaborators');
    final response = await (_client?.get ?? http.get)(
      Uri.parse('$_baseUrl/live-artifacts/$id/collaborators'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    return (jsonDecode(response.body) as List<dynamic>)
        .cast<Map<String, dynamic>>()
        .map((json) => json['userId'] as int)
        .toList(growable: false);
  }

  Future<void> addCollaborator(String id, int userId) =>
      _collaboratorMutation('POST', id, userId);

  Future<void> removeCollaborator(String id, int userId) =>
      _collaboratorMutation('DELETE', id, userId);

  Future<void> _collaboratorMutation(
      String method, String id, int userId) async {
    debugOnRequest
        ?.call(method == 'POST' ? 'addCollaborator' : 'removeCollaborator');
    final uri = Uri.parse(method == 'POST'
        ? '$_baseUrl/live-artifacts/$id/collaborators'
        : '$_baseUrl/live-artifacts/$id/collaborators/$userId');
    final headers = {
      ...AuthSessionStore.headers(),
      'Content-Type': 'application/json'
    };
    final response = method == 'POST'
        ? await (_client?.post ?? http.post)(uri,
            headers: headers, body: jsonEncode({'userId': userId}))
        : await (_client?.delete ?? http.delete)(uri, headers: headers);
    assertOk(response);
  }

  Future<List<LiveArtifactUser>> users() async {
    debugOnRequest?.call('users');
    final response = await (_client?.get ?? http.get)(
      Uri.parse('$_baseUrl/users'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    return (jsonDecode(response.body) as List<dynamic>)
        .cast<Map<String, dynamic>>()
        .map(LiveArtifactUser.fromJson)
        .toList(growable: false);
  }

  /// This fetch remains in Flutter so the WebView never receives credentials.
  Future<String> render(String id) async {
    debugOnRequest?.call('render');
    final response = await (_client?.get ?? http.get)(
      Uri.parse('$_baseUrl/live-artifacts/$id/render'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    return normalizeLiveArtifactRenderCsp(response.body);
  }

  Future<LiveArtifact> updateState(
    String id, {
    required int expectedStateRevision,
    required Object? state,
  }) async {
    debugOnRequest?.call('updateState');
    final response = await (_client?.put ?? http.put)(
      Uri.parse('$_baseUrl/live-artifacts/$id/state'),
      headers: {
        ...AuthSessionStore.headers(),
        'Content-Type': 'application/json'
      },
      body: jsonEncode({
        'expectedStateRevision': expectedStateRevision,
        'state': state,
      }),
    );
    assertOk(response);
    return LiveArtifact.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<Object?> readPcoServices(String id, Object? request) async {
    debugOnRequest?.call('readPcoServices');
    final response = await (_client?.post ?? http.post)(
      Uri.parse('$_baseUrl/live-artifacts/$id/capabilities/pco.services.read'),
      headers: {
        ...AuthSessionStore.headers(),
        'Content-Type': 'application/json'
      },
      body: jsonEncode(request),
    );
    assertOk(response);
    return jsonDecode(response.body);
  }
}
