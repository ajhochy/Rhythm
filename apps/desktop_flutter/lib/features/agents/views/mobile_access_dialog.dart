import 'dart:async';

import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../data/mobile_access_data_source.dart';

class MobileAccessDialog extends StatefulWidget {
  const MobileAccessDialog({super.key, this.dataSource});

  final MobileAccessDataSource? dataSource;

  @override
  State<MobileAccessDialog> createState() => _MobileAccessDialogState();
}

class _MobileAccessDialogState extends State<MobileAccessDialog> {
  late final MobileAccessDataSource _dataSource;
  late final bool _ownsDataSource;
  MobileAccessStatus? _status;
  MobilePairingCode? _pairingCode;
  List<MobileDevice> _devices = const [];
  Timer? _timer;
  bool _busy = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _ownsDataSource = widget.dataSource == null;
    _dataSource = widget.dataSource ?? MobileAccessDataSource();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
    unawaited(_refresh(initial: true));
  }

  @override
  void dispose() {
    _timer?.cancel();
    if (_ownsDataSource) _dataSource.close();
    super.dispose();
  }

  bool get _expired =>
      _pairingCode != null &&
      !DateTime.now().toUtc().isBefore(_pairingCode!.expiresAt.toUtc());

  void _tick() {
    if (!mounted) return;
    setState(() {
      if (_expired) _pairingCode = null;
    });
    if (DateTime.now().second % 3 == 0) {
      unawaited(_refreshDevices(clearCodeOnNewDevice: true));
    }
  }

  Future<void> _refresh({bool initial = false}) async {
    if (initial) {
      setState(() {
        _busy = true;
        _error = null;
      });
    }
    try {
      final results = await Future.wait<Object>([
        _dataSource.fetchStatus(),
        _dataSource.fetchDevices(),
      ]);
      if (!mounted) return;
      setState(() {
        _status = results[0] as MobileAccessStatus;
        _devices = results[1] as List<MobileDevice>;
        _busy = false;
        _error = null;
      });
    } on MobileAccessException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.message;
      });
    }
  }

  Future<void> _refreshDevices({bool clearCodeOnNewDevice = false}) async {
    try {
      final devices = await _dataSource.fetchDevices();
      if (!mounted) return;
      final priorActive = _devices
          .where((device) => device.isActive)
          .map((device) => device.id);
      final nextActive =
          devices.where((device) => device.isActive).map((device) => device.id);
      final added = nextActive.any((id) => !priorActive.contains(id));
      setState(() {
        _devices = devices;
        if (clearCodeOnNewDevice && added) _pairingCode = null;
      });
    } catch (_) {
      // Background polling must not hide the primary diagnostic.
    }
  }

  Future<void> _enable() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final status = await _dataSource.enableAccess();
      if (!mounted) return;
      setState(() {
        _status = status;
        _busy = false;
      });
      if (status.state == TailscaleAccessState.healthy) {
        await _generate();
      }
    } on MobileAccessException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.message;
      });
    }
  }

  Future<void> _generate() async {
    final gatewayUrl = _status?.gatewayUrl;
    if (gatewayUrl == null || _status?.state != TailscaleAccessState.healthy) {
      return;
    }
    setState(() {
      _busy = true;
      _pairingCode = null;
      _error = null;
    });
    try {
      final code = await _dataSource.createPairingCode(gatewayUrl);
      if (!mounted) return;
      setState(() {
        _pairingCode = code;
        _busy = false;
      });
    } on MobileAccessException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.message;
      });
    }
  }

  Future<void> _revoke(MobileDevice device) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _dataSource.revokeDevice(device.id);
      await _refreshDevices();
      if (!mounted) return;
      setState(() => _busy = false);
    } on MobileAccessException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = _status;
    final activeDevices =
        _devices.where((device) => device.isActive).toList(growable: false);
    return AlertDialog(
      key: const Key('mobile-access-dialog'),
      title: const Row(
        children: [
          Icon(Icons.phone_iphone_outlined),
          SizedBox(width: 10),
          Text('Mobile Access'),
        ],
      ),
      content: SizedBox(
        width: 520,
        child: SingleChildScrollView(
          child: Semantics(
            liveRegion: true,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Connect Rhythm Agents on your iPhone through your private '
                  'Tailscale network. Nothing is exposed to the public internet.',
                  style: TextStyle(color: context.rhythm.textSecondary),
                ),
                const SizedBox(height: 18),
                if (_busy && status == null)
                  const Center(child: CircularProgressIndicator())
                else if (status != null)
                  _DiagnosticCard(
                    status: status,
                    busy: _busy,
                    onEnable: _enable,
                    onRefresh: _refresh,
                  ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Semantics(
                    container: true,
                    liveRegion: true,
                    label: 'Mobile access error: $_error',
                    child: Container(
                      key: const Key('mobile-access-error'),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: context.rhythm.danger.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(RhythmRadius.md),
                      ),
                      child: Text(
                        _error!,
                        style: TextStyle(color: context.rhythm.danger),
                      ),
                    ),
                  ),
                ],
                if (status?.state == TailscaleAccessState.healthy) ...[
                  const SizedBox(height: 18),
                  if (activeDevices.isNotEmpty)
                    Container(
                      key: const Key('mobile-access-replacement-warning'),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: context.rhythm.warning.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(RhythmRadius.md),
                      ),
                      child: Text(
                        'Pairing another iPhone replaces the currently active '
                        'iPhone credential.',
                        style: TextStyle(color: context.rhythm.textSecondary),
                      ),
                    ),
                  const SizedBox(height: 12),
                  if (_pairingCode == null)
                    FilledButton.icon(
                      key: const Key('generate-mobile-pairing-code'),
                      onPressed: _busy ? null : _generate,
                      icon: const Icon(Icons.qr_code_2),
                      label: const Text('Generate one-time QR code'),
                    )
                  else
                    _PairingCodeCard(
                      pairingCode: _pairingCode!,
                      onRegenerate: _busy ? null : _generate,
                    ),
                ],
                if (activeDevices.isNotEmpty) ...[
                  const SizedBox(height: 20),
                  Text(
                    'PAIRED IPHONE',
                    style: TextStyle(
                      color: context.rhythm.textSecondary,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 0.8,
                    ),
                  ),
                  const SizedBox(height: 8),
                  ...activeDevices.map(
                    (device) => ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.phone_iphone),
                      title: Text(device.name),
                      subtitle: const Text('Private mobile access enabled'),
                      trailing: TextButton(
                        key: Key('revoke-mobile-device-${device.id}'),
                        onPressed: _busy ? null : () => _revoke(device),
                        child: const Text('Revoke'),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Close'),
        ),
      ],
    );
  }
}

class _DiagnosticCard extends StatelessWidget {
  const _DiagnosticCard({
    required this.status,
    required this.busy,
    required this.onEnable,
    required this.onRefresh,
  });

  final MobileAccessStatus status;
  final bool busy;
  final VoidCallback onEnable;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    final (icon, label, color) = switch (status.state) {
      TailscaleAccessState.missing => (
          Icons.download_outlined,
          'Tailscale not installed',
          context.rhythm.warning,
        ),
      TailscaleAccessState.loggedOut => (
          Icons.account_circle_outlined,
          'Tailscale sign-in required',
          context.rhythm.warning,
        ),
      TailscaleAccessState.wrongTarget => (
          Icons.tune_outlined,
          'Rhythm access not configured',
          context.rhythm.warning,
        ),
      TailscaleAccessState.healthy => (
          Icons.lock_outline,
          'Private connection ready',
          context.rhythm.success,
        ),
    };
    return Container(
      key: Key('tailscale-status-${status.state.name}'),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        border: Border.all(color: color.withValues(alpha: 0.3)),
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label,
                    style: const TextStyle(fontWeight: FontWeight.w700)),
                const SizedBox(height: 4),
                Text(status.message),
                if (status.gatewayUrl != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    status.gatewayUrl!.replaceFirst('https://', ''),
                    style: TextStyle(color: context.rhythm.textSecondary),
                  ),
                ],
              ],
            ),
          ),
          if (status.canConfigure)
            FilledButton(
              key: const Key('configure-tailscale-serve'),
              onPressed: busy ? null : onEnable,
              child: const Text('Enable'),
            )
          else if (status.state != TailscaleAccessState.healthy)
            IconButton(
              tooltip: 'Refresh Tailscale status',
              onPressed: busy ? null : onRefresh,
              icon: const Icon(Icons.refresh),
            ),
        ],
      ),
    );
  }
}

class _PairingCodeCard extends StatelessWidget {
  const _PairingCodeCard({
    required this.pairingCode,
    required this.onRegenerate,
  });

  final MobilePairingCode pairingCode;
  final VoidCallback? onRegenerate;

  @override
  Widget build(BuildContext context) {
    final remaining =
        pairingCode.expiresAt.toUtc().difference(DateTime.now().toUtc());
    final seconds = remaining.inSeconds.clamp(0, 300);
    final minutesLabel = '${(seconds ~/ 60).toString().padLeft(2, '0')}:'
        '${(seconds % 60).toString().padLeft(2, '0')}';
    return Container(
      key: const Key('mobile-pairing-code-card'),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        border: Border.all(color: context.rhythm.border),
      ),
      child: Column(
        children: [
          Semantics(
            image: true,
            label: 'One-time mobile pairing QR code, expires in $minutesLabel',
            child: QrImageView(
              key: const Key('mobile-pairing-qr'),
              data: pairingCode.qrPayload,
              version: QrVersions.auto,
              size: 220,
              backgroundColor: Colors.white,
              eyeStyle: const QrEyeStyle(color: Colors.black),
              dataModuleStyle: const QrDataModuleStyle(color: Colors.black),
            ),
          ),
          const SizedBox(height: 10),
          Text(
            'Expires in $minutesLabel',
            key: const Key('mobile-pairing-expiry'),
            style: const TextStyle(color: Colors.black87),
          ),
          const SizedBox(height: 8),
          TextButton(
            key: const Key('regenerate-mobile-pairing-code'),
            onPressed: onRegenerate,
            child: const Text('Regenerate'),
          ),
        ],
      ),
    );
  }
}
