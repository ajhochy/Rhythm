import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/widgets/error_banner.dart';
import '../../../app/theme/rhythm_tokens.dart';
import '../controllers/facilities_controller.dart';
import '../models/facility.dart';
import '../models/reservation.dart';

const _kCanvas = RhythmTokens.background;
const _kCanvasAccent = RhythmTokens.backgroundAccent;
const _kSurface = RhythmTokens.surfaceStrong;
const _kBorder = RhythmTokens.borderSoft;
const _kTextPrimary = RhythmTokens.textPrimary;
const _kTextSecondary = RhythmTokens.textSecondary;
const _kSurfaceMuted = RhythmTokens.surfaceMuted;

class FacilitiesView extends StatefulWidget {
  const FacilitiesView({super.key});

  @override
  State<FacilitiesView> createState() => _FacilitiesViewState();
}

class _FacilitiesViewState extends State<FacilitiesView> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<FacilitiesController>().loadFacilities();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<FacilitiesController>(
      builder: (context, controller, _) {
        return Container(
          color: _kCanvas,
          child: Stack(
            children: [
              const Positioned(
                top: -90,
                right: -90,
                child: _AmbientOrb(color: _kCanvasAccent, size: 220),
              ),
              const Positioned(
                bottom: -110,
                left: -70,
                child: _AmbientOrb(color: _kCanvasAccent, size: 180),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _FacilitiesHeader(
                    facilityCount: controller.facilities.length,
                    onReserve: () => _showReserveDialog(context, controller),
                  ),
                  if (controller.status == FacilitiesStatus.error &&
                      controller.errorMessage != null)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(24, 0, 24, 12),
                      child: ErrorBanner(
                        message: controller.errorMessage!,
                        onRetry: controller.loadFacilities,
                      ),
                    ),
                  Expanded(child: _FacilitiesGrid(controller: controller)),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _showReserveDialog(
      BuildContext context, FacilitiesController controller) async {
    await showDialog<void>(
      context: context,
      builder: (_) => _ReservationDialog(
        controller: controller,
        facilities: controller.facilities,
      ),
    );
  }
}

DateTime? _parseReservationDateTime(String? raw) {
  if (raw == null || raw.isEmpty) return null;
  final normalized = raw.contains('T') ? raw : raw.replaceFirst(' ', 'T');
  return DateTime.tryParse(normalized);
}

String _formatDateShort(DateTime date) {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return '${months[date.month - 1]} ${date.day}';
}

String _formatTimeOnly(DateTime date) {
  final hour = date.hour > 12
      ? date.hour - 12
      : date.hour == 0
          ? 12
          : date.hour;
  final minute = date.minute.toString().padLeft(2, '0');
  final period = date.hour >= 12 ? 'PM' : 'AM';
  return '$hour:$minute $period';
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

class _FacilitiesHeader extends StatelessWidget {
  const _FacilitiesHeader({
    required this.onReserve,
    required this.facilityCount,
  });

  final VoidCallback onReserve;
  final int facilityCount;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(22),
        decoration: BoxDecoration(
          color: _kSurface.withValues(alpha: 0.92),
          borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
          border: Border.all(color: _kBorder),
          boxShadow: RhythmTokens.shadow,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Facilities',
                    style: TextStyle(
                      fontSize: 28,
                      height: 1.05,
                      fontWeight: FontWeight.w700,
                      color: _kTextPrimary,
                    ),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Reserve shared spaces, equipment, and rooms from one quiet workspace.',
                    style: TextStyle(
                      fontSize: 13,
                      height: 1.45,
                      color: _kTextSecondary,
                    ),
                  ),
                  const SizedBox(height: 14),
                  Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    children: [
                      _HeaderPill(
                        icon: Icons.meeting_room_outlined,
                        label:
                            '$facilityCount ${facilityCount == 1 ? 'space' : 'spaces'}',
                      ),
                      const _HeaderPill(
                        icon: Icons.schedule_outlined,
                        label: 'Live reservations',
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 16),
            FilledButton.icon(
              onPressed: onReserve,
              icon: const Icon(Icons.add, size: 18),
              label: const Text('Reserve Space'),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Facility Card Grid
// ---------------------------------------------------------------------------

class _FacilitiesGrid extends StatelessWidget {
  const _FacilitiesGrid({required this.controller});

  final FacilitiesController controller;

  @override
  Widget build(BuildContext context) {
    if (controller.status == FacilitiesStatus.loading &&
        controller.facilities.isEmpty) {
      return const _LoadingState();
    }

    if (controller.facilities.isEmpty) {
      return const _EmptyFacilitiesState(
        title: 'No facilities yet',
        body:
            'Facilities will appear here once they are added. You can still reserve a space if the list is populated later.',
      );
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 24),
      child: GridView.builder(
        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
          maxCrossAxisExtent: 380,
          crossAxisSpacing: 16,
          mainAxisSpacing: 16,
          childAspectRatio: 1.18,
        ),
        itemCount: controller.facilities.length,
        itemBuilder: (context, i) {
          final facility = controller.facilities[i];
          final reservations =
              controller.reservationsByFacility[facility.id] ?? [];
          return _FacilityCard(
            facility: facility,
            reservations: reservations,
            controller: controller,
          );
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Facility Card
// ---------------------------------------------------------------------------

class _FacilityCard extends StatelessWidget {
  const _FacilityCard({
    required this.facility,
    required this.reservations,
    required this.controller,
  });

  final Facility facility;
  final List<Reservation> reservations;
  final FacilitiesController controller;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final previewReservation = _currentOrUpcomingReservation();

    return Container(
      decoration: BoxDecoration(
        color: _kSurface.withValues(alpha: 0.96),
        borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
        border: Border.all(color: _kBorder),
        boxShadow: RhythmTokens.shadow,
      ),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    facility.name,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: _kTextPrimary,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: 10),
                _ReservationBadge(count: reservations.length),
              ],
            ),
            const SizedBox(height: 8),
            if (facility.description != null &&
                facility.description!.isNotEmpty) ...[
              Text(
                facility.description!,
                style: const TextStyle(
                  fontSize: 13,
                  height: 1.4,
                  color: _kTextSecondary,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],
            if (facility.location != null && facility.location!.isNotEmpty) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  const Icon(Icons.location_on_outlined,
                      size: 14, color: _kTextSecondary),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      facility.location!,
                      style: const TextStyle(
                        fontSize: 12,
                        color: _kTextSecondary,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 14),
            if (previewReservation == null)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 12,
                ),
                decoration: BoxDecoration(
                  color: _kSurfaceMuted,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: _kBorder),
                ),
                child: const Text(
                  'No upcoming reservations',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 12, color: _kTextSecondary),
                ),
              )
            else
              _ReservationPreviewCard(reservation: previewReservation),
            const Spacer(),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => _showReserveDialog(context),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: cs.primary,
                      side: BorderSide(
                        color: cs.primary.withValues(alpha: 0.2),
                      ),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 10,
                      ),
                      textStyle: const TextStyle(fontSize: 13),
                    ),
                    child: const Text('Reserve'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Reservation? _currentOrUpcomingReservation() {
    final candidates = reservations.where((reservation) {
      final end = _parseReservationDateTime(reservation.endTime);
      if (end == null) return false;
      return !end.isBefore(DateTime.now());
    }).toList()
      ..sort((a, b) {
        final aStart = _parseReservationDateTime(a.startTime);
        final bStart = _parseReservationDateTime(b.startTime);
        if (aStart == null && bStart == null) return 0;
        if (aStart == null) return 1;
        if (bStart == null) return -1;
        return aStart.compareTo(bStart);
      });

    return candidates.isEmpty ? null : candidates.first;
  }

  Future<void> _showReserveDialog(BuildContext context) async {
    await showDialog<void>(
      context: context,
      builder: (_) => _ReservationDialog(
        controller: controller,
        facilities: controller.facilities,
        preselectedFacility: facility,
      ),
    );
  }
}

class _AmbientOrb extends StatelessWidget {
  const _AmbientOrb({required this.color, required this.size});

  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(
            colors: [
              color.withValues(alpha: 0.55),
              color.withValues(alpha: 0.1),
              Colors.transparent,
            ],
            stops: const [0.0, 0.6, 1.0],
          ),
        ),
      ),
    );
  }
}

class _HeaderPill extends StatelessWidget {
  const _HeaderPill({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: _kCanvas.withValues(alpha: 0.7),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: _kBorder),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: _kTextSecondary),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: _kTextSecondary,
            ),
          ),
        ],
      ),
    );
  }
}

class _LoadingState extends StatelessWidget {
  const _LoadingState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 20),
        decoration: BoxDecoration(
          color: _kSurface.withValues(alpha: 0.96),
          borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
          border: Border.all(color: _kBorder),
          boxShadow: RhythmTokens.shadow,
        ),
        child: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            SizedBox(width: 12),
            Text(
              'Loading facilities',
              style: TextStyle(
                fontSize: 13,
                color: _kTextSecondary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyFacilitiesState extends StatelessWidget {
  const _EmptyFacilitiesState({
    required this.title,
    required this.body,
  });

  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Container(
          constraints: const BoxConstraints(maxWidth: 460),
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: _kSurface.withValues(alpha: 0.96),
            borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
            border: Border.all(color: _kBorder),
            boxShadow: RhythmTokens.shadow,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 56,
                height: 56,
                decoration: BoxDecoration(
                  color: RhythmTokens.accentSoft,
                  borderRadius: BorderRadius.circular(18),
                ),
                child: const Icon(
                  Icons.meeting_room_outlined,
                  color: RhythmTokens.accent,
                ),
              ),
              const SizedBox(height: 16),
              Text(
                title,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color: _kTextPrimary,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                body,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 13,
                  height: 1.45,
                  color: _kTextSecondary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Reservation count badge
// ---------------------------------------------------------------------------

class _ReservationBadge extends StatelessWidget {
  const _ReservationBadge({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    if (count == 0) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: const Color(0xFFEAF7EF),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: const Color(0xFFD3EEDC)),
        ),
        child: const Text(
          'Available',
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: Color(0xFF15803D),
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: cs.primary.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: cs.primary.withValues(alpha: 0.14)),
      ),
      child: Text(
        '$count ${count == 1 ? 'reservation' : 'reservations'}',
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: cs.primary,
        ),
      ),
    );
  }
}

class _ReservationPreviewCard extends StatelessWidget {
  const _ReservationPreviewCard({required this.reservation});

  final Reservation reservation;

  @override
  Widget build(BuildContext context) {
    final start = _parseReservationDateTime(reservation.startTime);
    final end = _parseReservationDateTime(reservation.endTime);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      decoration: BoxDecoration(
        color: _kCanvas.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _kBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            reservation.title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: _kTextPrimary,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            reservation.reservedBy,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 11, color: _kTextSecondary),
          ),
          if (start != null) ...[
            const SizedBox(height: 2),
            Text(
              '${_formatDateShort(start)} · ${_formatTimeOnly(start)}${end != null ? ' - ${_formatTimeOnly(end)}' : ''}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 11, color: _kTextSecondary),
            ),
          ],
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Reservation Dialog
// ---------------------------------------------------------------------------

class _ReservationDialog extends StatefulWidget {
  const _ReservationDialog({
    required this.controller,
    required this.facilities,
    this.preselectedFacility,
  });

  final FacilitiesController controller;
  final List<Facility> facilities;
  final Facility? preselectedFacility;

  @override
  State<_ReservationDialog> createState() => _ReservationDialogState();
}

class _ReservationDialogState extends State<_ReservationDialog> {
  final _formKey = GlobalKey<FormState>();
  final _titleController = TextEditingController();
  final _reservedByController = TextEditingController();
  final _startTimeController = TextEditingController();
  final _endTimeController = TextEditingController();
  final _notesController = TextEditingController();

  Facility? _selectedFacility;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _selectedFacility = widget.preselectedFacility ??
        (widget.facilities.isNotEmpty ? widget.facilities.first : null);
  }

  @override
  void dispose() {
    _titleController.dispose();
    _reservedByController.dispose();
    _startTimeController.dispose();
    _endTimeController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isTopLevel = widget.preselectedFacility == null;

    return Dialog(
      insetPadding: const EdgeInsets.all(24),
      backgroundColor: Colors.transparent,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 560),
        decoration: BoxDecoration(
          color: _kSurface,
          borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
          border: Border.all(color: _kBorder),
          boxShadow: RhythmTokens.shadow,
        ),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Reserve space',
                              style: TextStyle(
                                fontSize: 22,
                                fontWeight: FontWeight.w700,
                                color: _kTextPrimary,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              isTopLevel
                                  ? 'Choose a facility and capture the booking details in one pass.'
                                  : 'Capture the booking details for ${widget.preselectedFacility!.name}.',
                              style: const TextStyle(
                                fontSize: 13,
                                height: 1.45,
                                color: _kTextSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 12),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 6,
                        ),
                        decoration: BoxDecoration(
                          color: _kCanvas.withValues(alpha: 0.7),
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(color: _kBorder),
                        ),
                        child: Text(
                          isTopLevel
                              ? 'New booking'
                              : widget.preselectedFacility!.name,
                          style: const TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: _kTextSecondary,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  if (isTopLevel && widget.facilities.isNotEmpty) ...[
                    DropdownButtonFormField<Facility>(
                      value: _selectedFacility,
                      decoration: _fieldDecoration(context, 'Facility'),
                      dropdownColor: _kSurface,
                      items: widget.facilities
                          .map(
                            (f) => DropdownMenuItem(
                              value: f,
                              child: Text(f.name),
                            ),
                          )
                          .toList(),
                      onChanged: (v) => setState(() => _selectedFacility = v),
                      validator: (v) =>
                          v == null ? 'Please select a facility' : null,
                    ),
                    const SizedBox(height: 14),
                  ],
                  TextFormField(
                    controller: _titleController,
                    autofocus: !isTopLevel,
                    decoration: _fieldDecoration(context, 'Title *'),
                    validator: (v) => (v == null || v.trim().isEmpty)
                        ? 'Title is required'
                        : null,
                  ),
                  const SizedBox(height: 14),
                  TextFormField(
                    controller: _reservedByController,
                    decoration: _fieldDecoration(context, 'Reserved By *'),
                    validator: (v) => (v == null || v.trim().isEmpty)
                        ? 'Reserved By is required'
                        : null,
                  ),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: _startTimeController,
                          decoration: _fieldDecoration(
                            context,
                            'Start Time',
                            hintText: 'e.g. 2026-04-01 09:00',
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextFormField(
                          controller: _endTimeController,
                          decoration: _fieldDecoration(
                            context,
                            'End Time',
                            hintText: 'e.g. 2026-04-01 11:00',
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  TextFormField(
                    controller: _notesController,
                    decoration: _fieldDecoration(context, 'Notes'),
                    maxLines: 3,
                  ),
                  const SizedBox(height: 20),
                  Row(
                    children: [
                      TextButton(
                        onPressed:
                            _saving ? null : () => Navigator.pop(context),
                        child: const Text('Cancel'),
                      ),
                      const Spacer(),
                      FilledButton(
                        onPressed: _saving ? null : _submit,
                        child: _saving
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Text('Submit'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    if (_selectedFacility == null) return;

    setState(() => _saving = true);
    try {
      await widget.controller.createReservation(
        _selectedFacility!.id,
        title: _titleController.text.trim(),
        reservedBy: _reservedByController.text.trim(),
        startTime: _startTimeController.text.trim(),
        endTime: _endTimeController.text.trim(),
        notes: _notesController.text.trim(),
      );
      if (mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Reservation created')),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    }
  }

  InputDecoration _fieldDecoration(
    BuildContext context,
    String label, {
    String? hintText,
  }) {
    final primary = Theme.of(context).colorScheme.primary;
    return InputDecoration(
      labelText: label,
      hintText: hintText,
      filled: true,
      fillColor: _kCanvas.withValues(alpha: 0.45),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: _kBorder),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: _kBorder),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(color: primary),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
    );
  }
}
