import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:qr_flutter/qr_flutter.dart';

import 'package:rhythm_desktop/features/agents/data/mobile_access_data_source.dart';
import 'package:rhythm_desktop/features/agents/views/mobile_access_dialog.dart';
import 'package:rhythm_desktop/features/notifications/data/human_approval_signer.dart';

class _TestHumanApprovalSigner extends HumanApprovalSigner {
  @override
  Future<String> humanApprovalCapability() async => 'signed-app-capability';
}

class _FakeMobileAccessDataSource extends MobileAccessDataSource {
  _FakeMobileAccessDataSource({
    required this.status,
    this.devices = const [],
    this.codes = const [],
  }) : super(tokenProvider: () => 'test-session');

  MobileAccessStatus status;
  List<MobileDevice> devices;
  List<MobilePairingCode> codes;
  int generated = 0;
  final List<String> revoked = [];

  @override
  Future<MobileAccessStatus> fetchStatus() async => status;

  @override
  Future<MobileAccessStatus> enableAccess() async {
    status = const MobileAccessStatus(
      state: TailscaleAccessState.healthy,
      gatewayUrl: 'https://rhythm-mac.tail1234.ts.net',
      message: 'Mobile access is available on your private tailnet.',
      canConfigure: false,
    );
    return status;
  }

  @override
  Future<List<MobileDevice>> fetchDevices() async => devices;

  @override
  Future<MobilePairingCode> createPairingCode(String gatewayUrl) async {
    final index = generated.clamp(0, codes.length - 1);
    generated += 1;
    return codes[index];
  }

  @override
  Future<void> revokeDevice(String deviceId) async {
    revoked.add(deviceId);
    devices = devices
        .map(
          (device) => device.id == deviceId
              ? MobileDevice(
                  id: device.id,
                  name: device.name,
                  createdAt: device.createdAt,
                  revokedAt: DateTime.now(),
                )
              : device,
        )
        .toList(growable: false);
  }

  @override
  void close() {}
}

const healthy = MobileAccessStatus(
  state: TailscaleAccessState.healthy,
  gatewayUrl: 'https://rhythm-mac.tail1234.ts.net',
  message: 'Mobile access is available on your private tailnet.',
  canConfigure: false,
);

MobilePairingCode code(String value, {DateTime? expiresAt}) =>
    MobilePairingCode(
      id: 'code-$value',
      hostId: 'host-1',
      code: value,
      expiresAt: expiresAt ?? DateTime.now().add(const Duration(minutes: 5)),
      gatewayUrl: 'https://rhythm-mac.tail1234.ts.net',
    );

String repeated(String value) => List.filled(43, value).join();

Widget wrap(MobileAccessDataSource dataSource) => MaterialApp(
  home: Scaffold(body: MobileAccessDialog(dataSource: dataSource)),
);

Future<void> settleInitial(WidgetTester tester) async {
  await tester.pump();
  await tester.pump();
}

Future<void> disposeDialog(WidgetTester tester) async {
  await tester.pumpWidget(const MaterialApp(home: SizedBox()));
}

void main() {
  test(
    'mobile access admin requests include the Keychain capability',
    () async {
      late http.Request observed;
      final client = MockClient((request) async {
        observed = request;
        return http.Response(
          jsonEncode(<String, Object?>{
            'state': 'healthy',
            'gatewayUrl': 'https://rhythm-mac.tail1234.ts.net',
            'message': 'Ready',
            'canConfigure': false,
          }),
          200,
          headers: <String, String>{'content-type': 'application/json'},
        );
      });
      final dataSource = MobileAccessDataSource(
        client: client,
        baseUrl: 'http://127.0.0.1:4001',
        tokenProvider: () => 'desktop-bearer',
        humanApprovalSigner: _TestHumanApprovalSigner(),
      );

      await dataSource.fetchStatus();

      expect(observed.headers['authorization'], 'Bearer desktop-bearer');
      expect(
        observed.headers['x-rhythm-human-approval'],
        'signed-app-capability',
      );
      dataSource.close();
    },
  );

  group('issue-1171-c1: desktop Tailscale diagnostics', () {
    final cases = <(TailscaleAccessState, String)>[
      (TailscaleAccessState.missing, 'Tailscale not installed'),
      (TailscaleAccessState.loggedOut, 'Tailscale sign-in required'),
      (TailscaleAccessState.wrongTarget, 'Rhythm access not configured'),
      (TailscaleAccessState.healthy, 'Private connection ready'),
    ];
    for (final (state, label) in cases) {
      testWidgets('renders actionable ${state.name}', (tester) async {
        final dataSource = _FakeMobileAccessDataSource(
          status: MobileAccessStatus(
            state: state,
            gatewayUrl:
                state == TailscaleAccessState.missing ||
                    state == TailscaleAccessState.loggedOut
                ? null
                : 'https://rhythm-mac.tail1234.ts.net',
            message: 'diagnostic-${state.name}',
            canConfigure: state == TailscaleAccessState.wrongTarget,
          ),
        );
        await tester.pumpWidget(wrap(dataSource));
        await settleInitial(tester);
        expect(
          find.byKey(Key('tailscale-status-${state.name}')),
          findsOneWidget,
        );
        expect(find.text(label), findsOneWidget);
        expect(find.text('diagnostic-${state.name}'), findsOneWidget);
        if (state == TailscaleAccessState.wrongTarget) {
          expect(
            find.byKey(const Key('configure-tailscale-serve')),
            findsOneWidget,
          );
        }
        await disposeDialog(tester);
      });
    }
  });

  testWidgets(
    'issue-1171-c1: configure transitions wrong target to healthy without duplicate setup',
    (tester) async {
      final dataSource = _FakeMobileAccessDataSource(
        status: const MobileAccessStatus(
          state: TailscaleAccessState.wrongTarget,
          gatewayUrl: 'https://rhythm-mac.tail1234.ts.net',
          message: 'Wrong target',
          canConfigure: true,
        ),
        codes: [code(repeated('a'))],
      );
      await tester.pumpWidget(wrap(dataSource));
      await settleInitial(tester);
      await tester.tap(find.byKey(const Key('configure-tailscale-serve')));
      await tester.pump();
      await tester.pump();
      expect(find.text('Private connection ready'), findsOneWidget);
      expect(find.byKey(const Key('mobile-pairing-code-card')), findsOneWidget);
      expect(dataSource.generated, 1);
      await disposeDialog(tester);
    },
  );

  testWidgets(
    'issue-1171-c2: QR payload contains only host binding and one-time pairing material',
    (tester) async {
      final pairingCode = code(repeated('b'));
      final dataSource = _FakeMobileAccessDataSource(
        status: healthy,
        codes: [pairingCode],
      );
      await tester.pumpWidget(wrap(dataSource));
      await settleInitial(tester);
      await tester.tap(find.byKey(const Key('generate-mobile-pairing-code')));
      await tester.pump();
      expect(find.byType(QrImageView), findsOneWidget);
      final payload = jsonDecode(pairingCode.qrPayload) as Map<String, dynamic>;
      expect(payload.keys.toSet(), {'gatewayUrl', 'pairingCode'});
      expect(payload['gatewayUrl'], 'https://rhythm-mac.tail1234.ts.net');
      expect(payload['pairingCode'], repeated('b'));
      expect(pairingCode.qrPayload, isNot(contains('deviceToken')));
      expect(pairingCode.qrPayload, isNot(contains('hostId')));
      await disposeDialog(tester);
    },
  );

  testWidgets('issue-1171-c2: expired QR disappears and can be regenerated', (
    tester,
  ) async {
    final dataSource = _FakeMobileAccessDataSource(
      status: healthy,
      codes: [
        code(
          repeated('c'),
          expiresAt: DateTime.now().subtract(const Duration(seconds: 1)),
        ),
        code(repeated('d')),
      ],
    );
    await tester.pumpWidget(wrap(dataSource));
    await settleInitial(tester);
    await tester.tap(find.byKey(const Key('generate-mobile-pairing-code')));
    await tester.pump();
    expect(find.byKey(const Key('mobile-pairing-qr')), findsOneWidget);
    await tester.pump(const Duration(seconds: 2));
    expect(find.byKey(const Key('mobile-pairing-qr')), findsNothing);
    await tester.tap(find.byKey(const Key('generate-mobile-pairing-code')));
    await tester.pump();
    expect(find.byType(QrImageView), findsOneWidget);
    expect(dataSource.codes.last.qrPayload, contains(repeated('d')));
    expect(dataSource.generated, 2);
    await disposeDialog(tester);
  });

  testWidgets(
    'issue-1171-c4/c6: active device shows replacement warning and accessible revoke',
    (tester) async {
      final dataSource = _FakeMobileAccessDataSource(
        status: healthy,
        devices: [
          MobileDevice(
            id: 'iphone-1',
            name: 'AJ iPhone',
            createdAt: DateTime.now(),
          ),
        ],
      );
      final semantics = tester.ensureSemantics();
      await tester.pumpWidget(wrap(dataSource));
      await settleInitial(tester);
      expect(
        find.byKey(const Key('mobile-access-replacement-warning')),
        findsOneWidget,
      );
      expect(find.text('AJ iPhone'), findsOneWidget);
      expect(
        find.bySemanticsLabel(
          'One-time mobile pairing QR code, expires in 05:00',
        ),
        findsNothing,
      );
      final revokeButton = find.byKey(
        const Key('revoke-mobile-device-iphone-1'),
      );
      await tester.ensureVisible(revokeButton);
      await tester.tap(revokeButton);
      await tester.pump();
      await tester.pump();
      expect(dataSource.revoked, ['iphone-1']);
      semantics.dispose();
      await disposeDialog(tester);
    },
  );
}
