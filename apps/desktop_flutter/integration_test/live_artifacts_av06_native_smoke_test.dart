// AV-06 native smoke. Run only against tools/dev/sandbox.sh with the fixture
// variables documented in docs/ai/runs/2026-08-09-live-artifacts-av06.md.
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/app/core/auth/auth_session_store.dart';
import 'package:rhythm_desktop/features/live_artifacts/controllers/live_artifacts_controller.dart';
import 'package:rhythm_desktop/features/live_artifacts/data/live_artifacts_data_source.dart';
import 'package:rhythm_desktop/features/live_artifacts/models/live_artifact.dart';
import 'package:rhythm_desktop/features/live_artifacts/widgets/dashboard_artifact_tabs.dart';
import 'package:rhythm_desktop/features/settings/data/user_preferences_data_source.dart';
import 'package:webview_flutter/webview_flutter.dart';

const _base = String.fromEnvironment('AV06_API_URL', defaultValue: '');
const _token = String.fromEnvironment('AV06_TOKEN', defaultValue: '');
const _workspace =
    String.fromEnvironment('AV06_WORKSPACE_ID', defaultValue: '');
const _evidencePath =
    String.fromEnvironment('AV06_EVIDENCE_PATH', defaultValue: '');
const _securityEvidencePath =
    String.fromEnvironment('AV06_SECURITY_EVIDENCE_PATH', defaultValue: '');
const _pcoCounterUrl =
    String.fromEnvironment('AV06_PCO_COUNTER_URL', defaultValue: '');
const _snapshotChannel = MethodChannel('com.vcrc.rhythm/artifact-snapshot');
final _windowKey = GlobalKey();

bool _isAcceptedBlocked(String raw) {
  try {
    final value = jsonDecode(raw);
    return value is Map<String, dynamic> &&
        value['method'] == 'host.blocked' &&
        value['nonce'] is String &&
        const {'navigation', 'form', 'download', 'file', 'media'}
            .contains(value['params']);
  } catch (_) {
    return false;
  }
}

/// The window image: the real Flutter layer (tab strip, viewer toolbar, theme)
/// with the real WKWebView snapshot drawn into the platform-view rect. A
/// platform view is a hole in `toImage`, and the compositor omits it from an
/// own-window CGWindow capture, so the two halves have to be joined explicitly.
Future<ui.Image> _composeWindow(WidgetTester tester, Rect artifact) async {
  final ratio = tester.view.devicePixelRatio;
  final layer = await tester
      .renderObject<RenderRepaintBoundary>(find.byKey(_windowKey))
      .toImage(pixelRatio: ratio);
  final bytes = await _snapshotChannel.invokeMethod<Uint8List>('capture');
  expect(bytes, isNotNull, reason: 'native WKWebView snapshot is required');
  _expectPng(bytes!);
  final web =
      (await (await ui.instantiateImageCodec(bytes)).getNextFrame()).image;
  final recorder = ui.PictureRecorder();
  Canvas(recorder)
    ..drawImage(layer, Offset.zero, Paint())
    ..drawImageRect(
        web,
        Offset.zero & Size(web.width.toDouble(), web.height.toDouble()),
        Rect.fromLTWH(artifact.left * ratio, artifact.top * ratio,
            artifact.width * ratio, artifact.height * ratio),
        Paint());
  return recorder.endRecording().toImage(layer.width, layer.height);
}

int _colorCount(ByteData pixels, int width, int fromRow, int toRow) {
  final seen = <int>{};
  for (var i = fromRow * width * 4; i < toRow * width * 4; i += 4) {
    seen.add(pixels.getUint32(i));
  }
  return seen.length;
}

/// The `Sync from PCO` button fill in the fixture bundle's CSS. Exact match, not
/// nearest: the chrome's own accent antialiasing gets within 26 of it, and the
/// WebKit snapshot reproduces the declared color byte-for-byte.
const _artifactAccent = 0x6855d8;

bool _hasArtifactAccent(ByteData pixels, int width, int fromRow, int toRow) {
  for (var i = fromRow * width * 4; i < toRow * width * 4; i += 4) {
    if (pixels.getUint32(i) >> 8 == _artifactAccent) return true;
  }
  return false;
}

void _expectPng(Uint8List bytes) {
  // Regression: a platform view snapshot channel can accidentally return a
  // non-image payload; PNG header and IHDR dimensions make that observable.
  expect(bytes.length, greaterThan(10 * 1024));
  expect(bytes.sublist(0, 8), [137, 80, 78, 71, 13, 10, 26, 10]);
  expect(String.fromCharCodes(bytes.sublist(12, 16)), 'IHDR');
  final dimensions = ByteData.sublistView(bytes.sublist(16, 24));
  expect(dimensions.getUint32(0), greaterThan(1));
  expect(dimensions.getUint32(4), greaterThan(1));
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('AV06 A1-A10 native WKWebView fail-closed smoke', (tester) async {
    expect(_base, isNotEmpty, reason: 'AV06_API_URL is required');
    expect(_token, isNotEmpty, reason: 'AV06_TOKEN is required');
    expect(_workspace, isNotEmpty, reason: 'AV06_WORKSPACE_ID is required');
    expect(_evidencePath, isNotEmpty, reason: 'AV06_EVIDENCE_PATH is required');
    expect(_securityEvidencePath, isNotEmpty,
        reason: 'AV06_SECURITY_EVIDENCE_PATH is required');
    expect(_pcoCounterUrl, isNotEmpty,
        reason: 'AV06_PCO_COUNTER_URL is required for blocked-action counters');
    AuthSessionStore.setSessionToken(_token);
    final headers = {
      'Authorization': 'Bearer $_token',
      'Content-Type': 'application/json'
    };
    final artifactResponse = await http.post(Uri.parse('$_base/live-artifacts'),
        headers: headers,
        body: jsonEncode({
          'type': 'html',
          'title': 'Worship Calendar AV06',
          'workspaceId': int.parse(_workspace),
          'declaredCapabilities': ['pco.services.read'],
          'state': {'revision': 1},
          'bundle': {
            'html':
                '''<main id="rendered"><header><p class="eyebrow">WORSHIP CALENDAR</p><h1>Sunday Service</h1><p class="muted">A focused plan for the people and moments ahead.</p></header><section class="card"><label>Scripture <input id="scripture" value="Psalm 23:1–6"></label><label>Theme <input id="theme" value="The Shepherd's Care"></label><label>Service notes <div id="notes" contenteditable="true">Welcome, worship, prayer, and communion.</div></label><button id="sync" type="button">Sync from PCO</button></section><section class="card tall"><h2>Service flow</h2><p>Gathering · Scripture · Response · Communion</p><p>Prayer · Sending · Fellowship</p><p>Team notes remain available while you scroll.</p></section><div class="blocked-actions"><a id="link" href="https://fixture.invalid/link">Open resource</a><form action="https://fixture.invalid"><button id="submit">Submit</button></form><a id="download" href="data:text/plain,av06" download="av06.txt">Download</a><input id="file" type="file"><button id="media">Use microphone</button></div></main>''',
            'css':
                '''*{box-sizing:border-box}body{margin:0;background:#f6f7fb;color:#1b2030;font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:900px;margin:0 auto;padding:36px 42px 120px}.eyebrow{color:#6855d8;font-size:12px;font-weight:700;letter-spacing:1.5px}h1{font-size:34px;margin:4px 0 8px}.muted{color:#667085}.card{margin-top:24px;padding:22px;border:1px solid #e1e4ec;border-radius:16px;background:#fff;box-shadow:0 4px 14px #1b20300d}label{display:block;font-weight:600;margin:14px 0}input,#notes{display:block;width:100%;margin-top:7px;padding:11px;border:1px solid #cbd1df;border-radius:8px;font:inherit}#notes{min-height:52px;font-weight:400}button{margin-top:8px;padding:10px 15px;border:0;border-radius:8px;background:#6855d8;color:#fff;font:inherit;font-weight:600}.tall{min-height:850px}.blocked-actions{margin-top:28px;opacity:.55}.blocked-actions>*{margin-right:12px}''',
            'js': '''window.av06={};
          window.av06.bridge=async()=>{let step='state.get';try{const before=await rhythm.request('state.get',null);step='state.update';const after=await rhythm.request('state.update',{expectedStateRevision:before.stateRevision,state:{revision:2}});step='pco.services.read';const pco=await rhythm.request('pco.services.read',{operation:'list_service_types'});return {before,after,pco};}catch(e){throw new Error(step+':'+((e&&e.code)||(e&&e.message)||String(e)))}};
          window.av06.hostLocked=()=>{try{window.__rhythmHostResponse=()=>{};return Object.getOwnPropertyDescriptor(window,'__rhythmHostResponse').writable===false}catch(e){return false}};'''
          }
        }));
    expect(artifactResponse.statusCode, 201);
    final artifact = LiveArtifact.fromJson(jsonDecode(artifactResponse.body));
    final source = LiveArtifactsDataSource(baseUrl: _base);
    final workspaceController = LiveArtifactsController(
      source,
      UserPreferencesDataSource(baseUrl: _base),
    );
    workspaceController.debugSetForTest(tabs: [
      LiveArtifactTab(
        id: artifact.id,
        status: LiveArtifactTabStatus.ready,
        artifact: artifact,
      ),
    ]);
    workspaceController.select(artifact.id);
    WebViewController? web;
    var inspectableDisabled = false;
    final hostRequests = <String>[];
    final bridgeMessages = <String>[];
    final downloads = Directory('${Platform.environment['HOME']}/Downloads');
    await downloads.create(recursive: true);
    final beforeDownloads = await downloads.list().map((e) => e.path).toList();
    try {
      await tester.pumpWidget(RepaintBoundary(
          key: _windowKey,
          child: MaterialApp(
              debugShowCheckedModeBanner: false,
              theme: AppTheme.light(),
              home: Scaffold(
                  body: DashboardArtifactWorkspace(
                dashboard:
                    const Center(child: Text('Dashboard content unchanged')),
                controller: workspaceController,
                baseUrl: _base,
                manageAuthLifecycle: false,
                debugOnNativeReady: (controller, disabled) {
                  web = controller;
                  inspectableDisabled = disabled;
                },
                debugOnHostRequest: hostRequests.add,
                debugOnBridgeMessage: bridgeMessages.add,
              )))));
      await tester.pumpAndSettle(const Duration(seconds: 2));
      expect(web, isNotNull);
      expect(inspectableDisabled, isTrue,
          reason: 'A8: native WebKit inspectability was disabled');

      Future<String> js(String value) async =>
          '${await web!.runJavaScriptReturningResult(value)}';
      // WKWebView's evaluateJavaScript (what runJavaScriptReturningResult uses)
      // is not an async context and cannot marshal `undefined`: top-level
      // `await` is a SyntaxError and a returned Promise is an unsupported
      // result type. Statements go through runJavaScript; promise-producing
      // expressions settle onto `window.av06.r` and are polled for.
      Future<void> jsVoid(String code) => web!.runJavaScript(code);
      Future<String> jsAsync(String expr) async {
        await js('window.av06.r=null;(async()=>{try{const v=await ($expr);'
            'window.av06.r=typeof v==="string"?v:JSON.stringify(v)}'
            'catch(e){window.av06.r="ERR:"+JSON.stringify({code:e&&e.code,'
            'message:e&&e.message,raw:String(e)})}})();"started"');
        for (var attempt = 0; attempt < 100; attempt++) {
          await tester.pump(const Duration(milliseconds: 100));
          final settled = await js('window.av06.r===null?"":window.av06.r');
          if (settled.isNotEmpty) return settled;
        }
        fail('timed out awaiting JavaScript: $expr');
      }

      expect(await js('document.getElementById("rendered").textContent'),
          contains('Sunday Service')); // A10
      expect(find.text('Planning'), findsOneWidget);
      expect(find.text('Dashboard'), findsOneWidget);
      expect(find.byTooltip('Reload artifact'), findsOneWidget);
      expect(find.textContaining('Updated'), findsOneWidget);
      final artifactRect = tester.getRect(find.byType(WebViewWidget));
      final window = await _composeWindow(tester, artifactRect);
      final chrome = (artifactRect.top * tester.view.devicePixelRatio).round();
      final pixels =
          (await window.toByteData(format: ui.ImageByteFormat.rawRgba))!;
      // Regression: the snapshot was pasted at the window's top edge instead of
      // the platform-view rect, so it erased the tab strip and viewer toolbar
      // and left the real artifact region blank. The page's own accent lands in
      // the top band under that bug (397 pixels) and nowhere near it when the
      // snapshot is placed correctly, so the two bands pin the placement down.
      expect(chrome, greaterThan(40),
          reason: 'tab strip + viewer toolbar must sit above the artifact');
      expect(_hasArtifactAccent(pixels, window.width, 0, chrome), isFalse,
          reason: 'the artifact snapshot must not cover the window chrome');
      expect(_hasArtifactAccent(pixels, window.width, chrome, window.height),
          isTrue,
          reason: 'rendered artifact must occupy the platform-view rect');
      expect(_colorCount(pixels, window.width, 0, chrome), greaterThan(50),
          reason: 'window chrome must be rasterized, not blank');
      final encoded =
          (await window.toByteData(format: ui.ImageByteFormat.png))!;
      final dashboardPng = encoded.buffer
          .asUint8List(encoded.offsetInBytes, encoded.lengthInBytes);
      _expectPng(dashboardPng);
      final evidence = File(_evidencePath);
      expect(evidence.isAbsolute, isTrue,
          reason: 'AV06_EVIDENCE_PATH must be absolute');
      await evidence.parent.create(recursive: true);
      await evidence.writeAsBytes(dashboardPng, flush: true);
      expect(await js('window.av06.hostLocked()'),
          contains('true')); // A9 overwrite fails
      final bridge = await jsAsync('window.av06.bridge()');
      // The bridge rejects with `{code}` and no `message`, so a rejected leg
      // used to surface as the opaque `ERR:[object Object]` against the
      // state-revision matcher below and got misread as a state failure.
      // Assert the rejection first: the message names the leg and its code.
      expect(bridge, isNot(startsWith('ERR:')),
          reason: 'a bridge leg rejected; step:code is in the message');
      expect(bridge, contains('"stateRevision":2')); // A9 state 1 -> 2
      expect(bridge,
          contains('Live Sunday')); // current-user PCO fixture projection

      final beforeBlockedHostRequests = List<String>.from(hostRequests);
      final beforeBlockedBridgeMessages = bridgeMessages.length;
      final beforeBlockedPcoRequests = await _pcoRequests();

      final originalUrl = await js('location.href');
      final originalText = await js('document.body.innerText');
      await jsVoid('window.open("https://fixture.invalid/popup")'); // A1
      await jsVoid('location.href="https://fixture.invalid/nav"'); // A2
      await tester.pump(const Duration(milliseconds: 400));
      expect(await js('location.href'), originalUrl);
      expect(await js('document.body.innerText'), originalText);
      await jsVoid(
          'document.querySelector("form").requestSubmit()'); // A2 form-action none
      await tester.pump(const Duration(milliseconds: 250));
      expect(await js('location.href'), originalUrl);
      for (final id in ['link', 'submit', 'download', 'file', 'media']) {
        await jsVoid('document.getElementById("$id").click()');
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(
          find.text(
              'Links, downloads, and file access are unavailable in live artifacts.'),
          findsOneWidget); // explicit blocked-feedback is debounced
      await jsVoid('RhythmBridge.postMessage("not-json")');
      await jsVoid(
          'RhythmBridge.postMessage(JSON.stringify({id:"unknown-blocked",method:"host.blocked",params:"unknown",nonce:window.rhythm.nonce}))');
      await tester.pump(const Duration(milliseconds: 100));
      final rawBlocked =
          bridgeMessages.skip(beforeBlockedBridgeMessages).toList();
      final acceptedBlocked = rawBlocked.where(_isAcceptedBlocked).toList();
      expect(acceptedBlocked, hasLength(4),
          reason:
              'only native form, download, and file capture may produce accepted feedback');
      expect(rawBlocked, hasLength(6),
          reason:
              'four valid feedback payloads plus malformed and unknown negatives reach the closed handler');
      final unknown =
          rawBlocked.singleWhere((raw) => raw.contains('unknown-blocked'));
      expect(_isAcceptedBlocked(unknown), isFalse,
          reason:
              'an unknown blocked reason must not become accepted feedback');
      expect(
          find.text(
              'Links, downloads, and file access are unavailable in live artifacts.'),
          findsOneWidget,
          reason:
              'malformed and unknown bridge payloads must not add a snackbar');
      expect(hostRequests, beforeBlockedHostRequests,
          reason:
              'blocked gestures and malformed host.blocked payloads must not call hosted APIs');
      expect(await _pcoRequests(), beforeBlockedPcoRequests,
          reason: 'blocked gestures must not call the PCO fixture');

      expect(
          await jsAsync(
              'fetch("https://fixture.invalid/x").then(()=>"ok",()=>"rejected")'),
          contains('rejected')); // A3
      expect(
          await jsAsync(
              'new Promise(r=>{try{const w=new WebSocket("wss://fixture.invalid/ws");w.onerror=()=>r("rejected")}catch(e){r("rejected")}})'),
          contains('rejected'));
      expect(
          await js(
              'JSON.stringify([(()=>{try{localStorage.setItem("x","y");return false}catch(e){return true}})(),document.cookie])'),
          contains('[true,""')); // A5
      expect(
          await jsAsync(
              'navigator.mediaDevices?.getUserMedia({audio:true}).then(()=>"ok",()=>"rejected") ?? "rejected"'),
          contains('rejected')); // A6
      await jsVoid(
          'document.getElementById("file").click(); window.av06.fileClickReturned=true'); // A7: no modal blocks the app
      await tester.pump(const Duration(milliseconds: 300));
      expect(await js('window.av06.fileClickReturned'), contains('true'));
      await jsVoid(
          'const a=document.createElement("a");a.href="data:text/plain,av06";a.download="av06.txt";a.click()'); // A4
      await tester.pump(const Duration(milliseconds: 500));
      expect(
          await downloads.list().map((e) => e.path).toList(), beforeDownloads);
      expect(await js('location.href'),
          originalUrl); // navigation stays about:blank
      expect(
          await js(
              '''(()=>{const n=document.getElementById('notes');n.focus();document.execCommand('insertText',false,' Updated');const r=document.createRange();r.selectNodeContents(n);const s=getSelection();s.removeAllRanges();s.addRange(r);return [document.activeElement===n,n.textContent,getSelection().toString()]})()'''),
          contains('Updated'));
      expect(await js('getSelection().toString().length'), isNot('0'));
      expect(
          await js(
              'window.scrollTo(0,document.body.scrollHeight);window.scrollY'),
          isNot('0'));
      expect(await js('window.scrollTo(0,0);window.scrollY'), contains('0'));
      expect(
          await jsAsync(
              'window.rhythm.request("unknown",null).then(()=>"ok",e=>e.code)'),
          contains('unsupported_request'));
      expect(
          await jsAsync(
              'window.rhythm.request("state.get",{bad:true}).then(()=>"ok",e=>e.code)'),
          contains('request_failed'));
      expect(await js('RhythmBridge.postMessage("{".repeat(70000)); "sent"'),
          contains('sent')); // oversize fail-closed; no host effect
      final png = await _snapshotChannel.invokeMethod<Uint8List>('capture');
      expect(png, isNotNull, reason: 'native WKWebView snapshot is required');
      _expectPng(png!);
      final securityEvidence = File(_securityEvidencePath);
      expect(securityEvidence.isAbsolute, isTrue,
          reason: 'AV06_SECURITY_EVIDENCE_PATH must be absolute');
      await securityEvidence.parent.create(recursive: true);
      await securityEvidence.writeAsBytes(png, flush: true);
    } finally {
      await http.delete(Uri.parse('$_base/live-artifacts/${artifact.id}'),
          headers: headers);
      AuthSessionStore.setSessionToken(null);
    }
  });
}

Future<int> _pcoRequests() async {
  final response = await http.get(Uri.parse(_pcoCounterUrl));
  expect(response.statusCode, 200);
  return (jsonDecode(response.body) as Map<String, dynamic>)['requests'] as int;
}
