import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/widgets/error_banner.dart';
import '../../../app/theme/rhythm_tokens.dart';
import '../controllers/facilities_controller.dart';
import '../models/facility.dart';
import '../models/reservation.dart';
import '../models/reservation_series.dart';

const _kCanvas = RhythmTokens.background;
const _kCanvasAccent = RhythmTokens.backgroundAccent;
const _kSurface = RhythmTokens.surfaceStrong;
const _kBorder = RhythmTokens.borderSoft;
const _kTextPrimary = RhythmTokens.textPrimary;
const _kTextSecondary = RhythmTokens.textSecondary;
const _kSurfaceMuted = RhythmTokens.surfaceMuted;

enum _FacilitiesMode { book, overview }

enum _OverviewRange { day, week, month }

enum _RecurrenceType { weekly, biweekly, monthly, custom }

class FacilitiesView extends StatefulWidget {
  const FacilitiesView({super.key});

  @override
  State<FacilitiesView> createState() => _FacilitiesViewState();
}

class _FacilitiesViewState extends State<FacilitiesView> {
  _FacilitiesMode _mode = _FacilitiesMode.overview;
  _OverviewRange _overviewRange = _OverviewRange.week;
  DateTime _rangeStart = _startOfWeek(DateTime.now());
  DateTime _rangeEnd = _endOfWeek(DateTime.now());
  String? _selectedBuilding;
  int? _selectedFacilityId;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadInitialData();
    });
  }

  Future<void> _loadInitialData() async {
    final controller = context.read<FacilitiesController>();
    await controller.loadFacilities();
    if (!mounted) return;
    await _loadOverview(controller: controller);
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
                  Padding(
                    padding: const EdgeInsets.fromLTRB(24, 16, 24, 0),
                    child: _ModeSwitcher(
                      mode: _mode,
                      onChanged: (mode) => setState(() => _mode = mode),
                    ),
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
                  Expanded(
                    child: _mode == _FacilitiesMode.book
                        ? _FacilitiesGrid(controller: controller)
                        : _FacilitiesOverview(
                            controller: controller,
                            range: _overviewRange,
                            rangeStart: _rangeStart,
                            rangeEnd: _rangeEnd,
                            selectedBuilding: _selectedBuilding,
                            selectedFacilityId: _selectedFacilityId,
                            onRangeChanged: _handleRangeChanged,
                            onShiftRange: _shiftOverviewRange,
                            onPickStartDate: _pickStartDate,
                            onPickEndDate: _pickEndDate,
                            onBuildingChanged: (building) async {
                              setState(() {
                                _selectedBuilding = building;
                                final facilityMatchesBuilding = controller
                                    .facilities
                                    .where(
                                      (facility) =>
                                          building == null ||
                                          facility.building == building,
                                    )
                                    .any(
                                      (facility) =>
                                          facility.id == _selectedFacilityId,
                                    );
                                if (!facilityMatchesBuilding) {
                                  _selectedFacilityId = null;
                                }
                              });
                              await _loadOverview(controller: controller);
                            },
                            onFacilityChanged: (facilityId) async {
                              setState(() => _selectedFacilityId = facilityId);
                              await _loadOverview(controller: controller);
                            },
                          ),
                  ),
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

  Future<void> _handleRangeChanged(_OverviewRange range) async {
    final now = DateTime.now();
    setState(() {
      _overviewRange = range;
      switch (range) {
        case _OverviewRange.day:
          _rangeStart = _startOfDay(now);
          _rangeEnd = _endOfDay(now);
          break;
        case _OverviewRange.week:
          _rangeStart = _startOfWeek(now);
          _rangeEnd = _endOfWeek(now);
          break;
        case _OverviewRange.month:
          _rangeStart = _startOfMonth(now);
          _rangeEnd = _endOfMonth(now);
          break;
      }
    });
    await _loadOverview();
  }

  Future<void> _shiftOverviewRange(int offset) async {
    setState(() {
      switch (_overviewRange) {
        case _OverviewRange.day:
          _rangeStart = _rangeStart.add(Duration(days: offset));
          _rangeEnd = _endOfDay(_rangeStart);
          break;
        case _OverviewRange.week:
          _rangeStart = _rangeStart.add(Duration(days: 7 * offset));
          _rangeEnd = _endOfWeek(_rangeStart);
          break;
        case _OverviewRange.month:
          final shifted = DateTime(
            _rangeStart.year,
            _rangeStart.month + offset,
            1,
          );
          _rangeStart = _startOfMonth(shifted);
          _rangeEnd = _endOfMonth(shifted);
          break;
      }
    });
    await _loadOverview();
  }

  Future<void> _pickStartDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _rangeStart,
      firstDate: DateTime.now().subtract(const Duration(days: 365)),
      lastDate: DateTime.now().add(const Duration(days: 365 * 3)),
    );
    if (picked == null) return;
    setState(() {
      _rangeStart = _startOfDay(picked);
      if (_rangeEnd.isBefore(_rangeStart)) {
        _rangeEnd = _endOfDay(picked);
      }
    });
    await _loadOverview();
  }

  Future<void> _pickEndDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _rangeEnd,
      firstDate: _rangeStart,
      lastDate: DateTime.now().add(const Duration(days: 365 * 3)),
    );
    if (picked == null) return;
    setState(() {
      _rangeEnd = _endOfDay(picked);
    });
    await _loadOverview();
  }

  Future<void> _loadOverview({FacilitiesController? controller}) async {
    final facilitiesController =
        controller ?? context.read<FacilitiesController>();
    await facilitiesController.loadReservationOverview(
      start: _rangeStart.toIso8601String(),
      end: _rangeEnd.toIso8601String(),
      facilityId: _selectedFacilityId,
      building: _selectedBuilding,
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

String _formatDatePickerValue(DateTime date) {
  return '${_formatDateShort(date)}, ${date.year}';
}

String _formatTimeOfDay(TimeOfDay time) {
  final hour = time.hourOfPeriod == 0 ? 12 : time.hourOfPeriod;
  final minute = time.minute.toString().padLeft(2, '0');
  final period = time.period == DayPeriod.am ? 'AM' : 'PM';
  return '$hour:$minute $period';
}

String _formatRangeLabel(DateTime start, DateTime end) {
  if (start.year == end.year &&
      start.month == end.month &&
      start.day == end.day) {
    return '${_formatDateShort(start)}, ${start.year}';
  }
  if (start.year == end.year) {
    return '${_formatDateShort(start)} - ${_formatDateShort(end)}, ${start.year}';
  }
  return '${_formatDateShort(start)}, ${start.year} - ${_formatDateShort(end)}, ${end.year}';
}

String _dateOnly(DateTime date) =>
    '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

String _recurrenceTypeLabel(_RecurrenceType type) {
  switch (type) {
    case _RecurrenceType.weekly:
      return 'Weekly';
    case _RecurrenceType.biweekly:
      return 'Bi-weekly';
    case _RecurrenceType.monthly:
      return 'Monthly';
    case _RecurrenceType.custom:
      return 'Custom dates';
  }
}

String _recurrenceTypeApiValue(_RecurrenceType type) {
  switch (type) {
    case _RecurrenceType.weekly:
      return 'weekly';
    case _RecurrenceType.biweekly:
      return 'biweekly';
    case _RecurrenceType.monthly:
      return 'monthly';
    case _RecurrenceType.custom:
      return 'custom';
  }
}

DateTime _startOfDay(DateTime date) =>
    DateTime(date.year, date.month, date.day);

DateTime _endOfDay(DateTime date) =>
    DateTime(date.year, date.month, date.day, 23, 59, 59, 999);

DateTime _startOfWeek(DateTime date) {
  final normalized = _startOfDay(date);
  return normalized.subtract(Duration(days: normalized.weekday - 1));
}

DateTime _endOfWeek(DateTime date) {
  final start = _startOfWeek(date);
  return _endOfDay(start.add(const Duration(days: 6)));
}

DateTime _startOfMonth(DateTime date) => DateTime(date.year, date.month, 1);

DateTime _endOfMonth(DateTime date) =>
    DateTime(date.year, date.month + 1, 0, 23, 59, 59, 999);

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

class _ModeSwitcher extends StatelessWidget {
  const _ModeSwitcher({
    required this.mode,
    required this.onChanged,
  });

  final _FacilitiesMode mode;
  final ValueChanged<_FacilitiesMode> onChanged;

  @override
  Widget build(BuildContext context) {
    return SegmentedButton<_FacilitiesMode>(
      segments: const [
        ButtonSegment(
          value: _FacilitiesMode.overview,
          icon: Icon(Icons.calendar_view_week_outlined),
          label: Text('Overview'),
        ),
        ButtonSegment(
          value: _FacilitiesMode.book,
          icon: Icon(Icons.dashboard_outlined),
          label: Text('Rooms'),
        ),
      ],
      selected: {mode},
      onSelectionChanged: (selection) {
        if (selection.isEmpty) return;
        onChanged(selection.first);
      },
      showSelectedIcon: false,
    );
  }
}

// ---------------------------------------------------------------------------
// Facility Card Grid
// ---------------------------------------------------------------------------

class _FacilitiesOverview extends StatelessWidget {
  const _FacilitiesOverview({
    required this.controller,
    required this.range,
    required this.rangeStart,
    required this.rangeEnd,
    required this.selectedBuilding,
    required this.selectedFacilityId,
    required this.onRangeChanged,
    required this.onShiftRange,
    required this.onPickStartDate,
    required this.onPickEndDate,
    required this.onBuildingChanged,
    required this.onFacilityChanged,
  });

  final FacilitiesController controller;
  final _OverviewRange range;
  final DateTime rangeStart;
  final DateTime rangeEnd;
  final String? selectedBuilding;
  final int? selectedFacilityId;
  final Future<void> Function(_OverviewRange range) onRangeChanged;
  final Future<void> Function(int offset) onShiftRange;
  final Future<void> Function() onPickStartDate;
  final Future<void> Function() onPickEndDate;
  final Future<void> Function(String? building) onBuildingChanged;
  final Future<void> Function(int? facilityId) onFacilityChanged;

  @override
  Widget build(BuildContext context) {
    final facilities = selectedBuilding == null
        ? controller.facilities
        : controller.facilities
            .where((facility) => facility.building == selectedBuilding)
            .toList();
    final reservations = controller.overviewReservations;
    final groupedReservations = <String, List<Reservation>>{};
    for (final reservation in reservations) {
      final start = _parseReservationDateTime(reservation.startTime);
      final key = start == null
          ? 'No Date'
          : '${_formatDateShort(start)}, ${start.year}';
      groupedReservations.putIfAbsent(key, () => []).add(reservation);
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 24),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: _kSurface.withValues(alpha: 0.96),
              borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
              border: Border.all(color: _kBorder),
              boxShadow: RhythmTokens.shadow,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Facilities overview',
                            style: TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w700,
                              color: _kTextPrimary,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            _formatRangeLabel(rangeStart, rangeEnd),
                            style: const TextStyle(
                              fontSize: 13,
                              color: _kTextSecondary,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Wrap(
                      spacing: 10,
                      runSpacing: 10,
                      children: [
                        _HeaderPill(
                          icon: Icons.event_note_outlined,
                          label:
                              '${reservations.length} ${reservations.length == 1 ? 'reservation' : 'reservations'}',
                        ),
                        _HeaderPill(
                          icon: Icons.warning_amber_outlined,
                          label:
                              '${reservations.where((item) => item.isConflicted).length} conflicts',
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    SegmentedButton<_OverviewRange>(
                      segments: const [
                        ButtonSegment(
                          value: _OverviewRange.day,
                          label: Text('Day'),
                        ),
                        ButtonSegment(
                          value: _OverviewRange.week,
                          label: Text('Week'),
                        ),
                        ButtonSegment(
                          value: _OverviewRange.month,
                          label: Text('Month'),
                        ),
                      ],
                      selected: {range},
                      onSelectionChanged: (selection) {
                        if (selection.isEmpty) return;
                        onRangeChanged(selection.first);
                      },
                      showSelectedIcon: false,
                    ),
                    OutlinedButton.icon(
                      onPressed: () => onShiftRange(-1),
                      icon: const Icon(Icons.chevron_left),
                      label: const Text('Back'),
                    ),
                    OutlinedButton.icon(
                      onPressed: () => onShiftRange(1),
                      icon: const Icon(Icons.chevron_right),
                      label: const Text('Forward'),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: [
                    SizedBox(
                      width: 190,
                      child: DropdownButtonFormField<String?>(
                        value: selectedBuilding,
                        decoration: _overviewDecoration('Building'),
                        dropdownColor: _kSurface,
                        items: [
                          const DropdownMenuItem<String?>(
                            value: null,
                            child: Text('All buildings'),
                          ),
                          ...controller.buildings.map(
                            (building) => DropdownMenuItem<String?>(
                              value: building,
                              child: Text(building),
                            ),
                          ),
                        ],
                        onChanged: (value) => onBuildingChanged(value),
                      ),
                    ),
                    SizedBox(
                      width: 220,
                      child: DropdownButtonFormField<int?>(
                        value: selectedFacilityId,
                        decoration: _overviewDecoration('Room'),
                        dropdownColor: _kSurface,
                        items: [
                          const DropdownMenuItem<int?>(
                            value: null,
                            child: Text('All rooms'),
                          ),
                          ...facilities.map(
                            (facility) => DropdownMenuItem<int?>(
                              value: facility.id,
                              child: Text(facility.name),
                            ),
                          ),
                        ],
                        onChanged: (value) => onFacilityChanged(value),
                      ),
                    ),
                    SizedBox(
                      width: 180,
                      child: _OverviewDateField(
                        label: 'Start',
                        value: _formatDatePickerValue(rangeStart),
                        onTap: onPickStartDate,
                      ),
                    ),
                    SizedBox(
                      width: 180,
                      child: _OverviewDateField(
                        label: 'End',
                        value: _formatDatePickerValue(rangeEnd),
                        onTap: onPickEndDate,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          if (controller.overviewErrorMessage != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: ErrorBanner(
                message: controller.overviewErrorMessage!,
                onRetry: controller.reloadReservationOverview,
              ),
            ),
          Expanded(
            child: controller.isLoadingOverview && reservations.isEmpty
                ? const _LoadingState()
                : reservations.isEmpty
                    ? const _EmptyFacilitiesState(
                        title: 'No reservations in this range',
                        body:
                            'Try another date range, room, or building to review upcoming facility usage.',
                      )
                    : ListView(
                        children: groupedReservations.entries.map((entry) {
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 16),
                            child: _OverviewGroup(
                              title: entry.key,
                              reservations: entry.value,
                              facilities: controller.facilities,
                            ),
                          );
                        }).toList(),
                      ),
          ),
        ],
      ),
    );
  }
}

InputDecoration _overviewDecoration(String label) {
  return InputDecoration(
    labelText: label,
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
    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
  );
}

class _OverviewDateField extends StatelessWidget {
  const _OverviewDateField({
    required this.label,
    required this.value,
    required this.onTap,
  });

  final String label;
  final String value;
  final Future<void> Function() onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => onTap(),
      borderRadius: BorderRadius.circular(16),
      child: InputDecorator(
        decoration: _overviewDecoration(label),
        child: Text(
          value,
          style: const TextStyle(
            fontSize: 14,
            color: _kTextPrimary,
          ),
        ),
      ),
    );
  }
}

class _RecurringInfoCard extends StatelessWidget {
  const _RecurringInfoCard({
    required this.title,
    required this.body,
  });

  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: _kCanvas.withValues(alpha: 0.45),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _kBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: _kTextPrimary,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            body,
            style: const TextStyle(
              fontSize: 12,
              height: 1.4,
              color: _kTextSecondary,
            ),
          ),
        ],
      ),
    );
  }
}

class _RecurringSummaryDialog extends StatelessWidget {
  const _RecurringSummaryDialog({required this.result});

  final ReservationSeriesCreationResult result;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Recurring reservation created'),
      content: SizedBox(
        width: 420,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${result.createdReservations.length} occurrence${result.createdReservations.length == 1 ? '' : 's'} created for ${result.series.title}.',
            ),
            if (result.conflicts.isNotEmpty) ...[
              const SizedBox(height: 16),
              const Text(
                'Conflicted dates',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              ...result.conflicts.map(
                (conflict) => Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text(
                    '${conflict.date}: ${conflict.reason}',
                    style: const TextStyle(
                      fontSize: 12,
                      color: _kTextSecondary,
                    ),
                  ),
                ),
              ),
            ],
          ],
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

class _OverviewGroup extends StatelessWidget {
  const _OverviewGroup({
    required this.title,
    required this.reservations,
    required this.facilities,
  });

  final String title;
  final List<Reservation> reservations;
  final List<Facility> facilities;

  @override
  Widget build(BuildContext context) {
    final facilitiesById = {
      for (final facility in facilities) facility.id: facility,
    };
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: _kSurface.withValues(alpha: 0.96),
        borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
        border: Border.all(color: _kBorder),
        boxShadow: RhythmTokens.shadow,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: _kTextPrimary,
            ),
          ),
          const SizedBox(height: 12),
          ...reservations.map((reservation) {
            final facility = facilitiesById[reservation.facilityId];
            return Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _OverviewReservationRow(
                reservation: reservation,
                facility: facility,
              ),
            );
          }),
        ],
      ),
    );
  }
}

class _OverviewReservationRow extends StatelessWidget {
  const _OverviewReservationRow({
    required this.reservation,
    required this.facility,
  });

  final Reservation reservation;
  final Facility? facility;

  @override
  Widget build(BuildContext context) {
    final start = _parseReservationDateTime(reservation.startTime);
    final end = _parseReservationDateTime(reservation.endTime);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: _kCanvas.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _kBorder),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 118,
            child: Text(
              start != null
                  ? '${_formatTimeOnly(start)}${end != null ? '\n${_formatTimeOnly(end)}' : ''}'
                  : 'Time TBD',
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: _kTextPrimary,
              ),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  reservation.title,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: _kTextPrimary,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  facility == null
                      ? reservation.requesterName
                      : '${facility.name}${facility.building?.isNotEmpty == true ? ' · ${facility.building}' : ''}',
                  style: const TextStyle(
                    fontSize: 12,
                    color: _kTextSecondary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Requester: ${reservation.requesterName}',
                  style: const TextStyle(
                    fontSize: 12,
                    color: _kTextSecondary,
                  ),
                ),
                if (reservation.createdByName != null &&
                    reservation.createdByName != reservation.requesterName)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      'Booked by ${reservation.createdByName}',
                      style: const TextStyle(
                        fontSize: 12,
                        color: _kTextSecondary,
                      ),
                    ),
                  ),
                if (reservation.notes != null && reservation.notes!.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      reservation.notes!,
                      style: const TextStyle(
                        fontSize: 12,
                        color: _kTextSecondary,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          if (reservation.isConflicted)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: const Color(0xFFFDECEC),
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: const Color(0xFFF4C7C7)),
              ),
              child: const Text(
                'Conflict',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: Color(0xFFB42318),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

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
            if (facility.building != null && facility.building!.isNotEmpty) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  const Icon(Icons.apartment_outlined,
                      size: 14, color: _kTextSecondary),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      facility.building!,
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
            reservation.requesterName,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 11, color: _kTextSecondary),
          ),
          if (reservation.createdByName != null &&
              reservation.createdByName != reservation.requesterName) ...[
            const SizedBox(height: 2),
            Text(
              'Booked by ${reservation.createdByName}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 11, color: _kTextSecondary),
            ),
          ],
          if (start != null) ...[
            const SizedBox(height: 2),
            Text(
              '${_formatDateShort(start)} · ${_formatTimeOnly(start)}${end != null ? ' - ${_formatTimeOnly(end)}' : ''}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 11, color: _kTextSecondary),
            ),
          ],
          if (reservation.notes != null && reservation.notes!.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              reservation.notes!,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 11, color: _kTextSecondary),
            ),
          ],
          if (reservation.isConflicted) ...[
            const SizedBox(height: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: const Color(0xFFFDECEC),
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: const Color(0xFFF4C7C7)),
              ),
              child: Text(
                reservation.conflictReason?.isNotEmpty == true
                    ? reservation.conflictReason!
                    : 'Conflict flagged',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  color: Color(0xFFB42318),
                ),
              ),
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
  final _requesterController = TextEditingController();
  final _dateController = TextEditingController();
  final _startTimeDisplayController = TextEditingController();
  final _endTimeDisplayController = TextEditingController();
  final _notesController = TextEditingController();

  Facility? _selectedFacility;
  DateTime? _selectedDate;
  TimeOfDay? _selectedStartTime;
  TimeOfDay? _selectedEndTime;
  bool _isRecurring = false;
  _RecurrenceType _recurrenceType = _RecurrenceType.weekly;
  DateTime? _recurrenceEndDate;
  final List<DateTime> _customRecurrenceDates = [];
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _selectedFacility = widget.preselectedFacility ??
        (widget.facilities.isNotEmpty ? widget.facilities.first : null);
    _requesterController.text = widget.controller.currentUser?.name ?? '';
  }

  @override
  void dispose() {
    _titleController.dispose();
    _requesterController.dispose();
    _dateController.dispose();
    _startTimeDisplayController.dispose();
    _endTimeDisplayController.dispose();
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
                    controller: _requesterController,
                    readOnly: !widget.controller.isFacilitiesManager,
                    decoration: _fieldDecoration(
                      context,
                      widget.controller.isFacilitiesManager
                          ? 'Requester *'
                          : 'Requester',
                    ).copyWith(
                      helperText: widget.controller.isFacilitiesManager
                          ? 'Facilities managers can book on behalf of someone else.'
                          : 'Reservations are created under your account.',
                    ),
                    validator: (v) => (v == null || v.trim().isEmpty)
                        ? 'Requester is required'
                        : null,
                  ),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: _dateController,
                          readOnly: true,
                          decoration: _fieldDecoration(
                            context,
                            'Date *',
                            hintText: 'Choose a reservation date',
                          ),
                          onTap: _pickDate,
                          validator: (_) =>
                              _selectedDate == null ? 'Date is required' : null,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: _startTimeDisplayController,
                          readOnly: true,
                          decoration: _fieldDecoration(
                            context,
                            'Start Time *',
                            hintText: 'Choose a start time',
                          ),
                          onTap: _pickStartTime,
                          validator: (_) => _selectedStartTime == null
                              ? 'Start time is required'
                              : null,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextFormField(
                          controller: _endTimeDisplayController,
                          readOnly: true,
                          decoration: _fieldDecoration(
                            context,
                            'End Time *',
                            hintText: 'Choose an end time',
                          ),
                          onTap: _pickEndTime,
                          validator: (_) => _selectedEndTime == null
                              ? 'End time is required'
                              : null,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  SwitchListTile.adaptive(
                    value: _isRecurring,
                    contentPadding: EdgeInsets.zero,
                    title: const Text(
                      'Recurring reservation',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: _kTextPrimary,
                      ),
                    ),
                    subtitle: const Text(
                      'Create a weekly, bi-weekly, monthly, or custom-date series.',
                      style: TextStyle(
                        fontSize: 12,
                        color: _kTextSecondary,
                      ),
                    ),
                    onChanged: (value) {
                      setState(() {
                        _isRecurring = value;
                        if (!value) {
                          _customRecurrenceDates.clear();
                          _recurrenceEndDate = null;
                        }
                      });
                    },
                  ),
                  if (_isRecurring) ...[
                    const SizedBox(height: 10),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: _RecurrenceType.values.map((type) {
                        final selected = _recurrenceType == type;
                        return ChoiceChip(
                          selected: selected,
                          label: Text(_recurrenceTypeLabel(type)),
                          onSelected: (_) {
                            setState(() {
                              _recurrenceType = type;
                              if (type != _RecurrenceType.custom) {
                                _customRecurrenceDates.clear();
                              }
                            });
                          },
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 14),
                    if (_recurrenceType == _RecurrenceType.custom) ...[
                      _RecurringInfoCard(
                        title: 'Custom dates',
                        body:
                            'The selected reservation date will be included automatically. Add any extra dates for the same event below.',
                      ),
                      const SizedBox(height: 10),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          ..._effectiveCustomDates.map((date) {
                            final isPrimaryDate = _selectedDate != null &&
                                date.year == _selectedDate!.year &&
                                date.month == _selectedDate!.month &&
                                date.day == _selectedDate!.day;
                            return InputChip(
                              label: Text(_formatDatePickerValue(date)),
                              onDeleted: isPrimaryDate
                                  ? null
                                  : () => setState(
                                        () =>
                                            _customRecurrenceDates.removeWhere(
                                          (item) =>
                                              item.year == date.year &&
                                              item.month == date.month &&
                                              item.day == date.day,
                                        ),
                                      ),
                            );
                          }),
                          ActionChip(
                            avatar: const Icon(Icons.add, size: 16),
                            label: const Text('Add date'),
                            onPressed: _addCustomDate,
                          ),
                        ],
                      ),
                    ] else ...[
                      _RecurringInfoCard(
                        title: 'Series end',
                        body: _recurrenceType == _RecurrenceType.monthly
                            ? 'Monthly reservations repeat on the same weekday pattern as the first date.'
                            : 'Pick the last date the series should create.',
                      ),
                      const SizedBox(height: 10),
                      _OverviewDateField(
                        label: 'Series End',
                        value: _recurrenceEndDate == null
                            ? 'Choose an end date'
                            : _formatDatePickerValue(_recurrenceEndDate!),
                        onTap: _pickRecurrenceEndDate,
                      ),
                    ],
                  ],
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
    if (_selectedDate == null ||
        _selectedStartTime == null ||
        _selectedEndTime == null) {
      return;
    }

    final startAt = DateTime(
      _selectedDate!.year,
      _selectedDate!.month,
      _selectedDate!.day,
      _selectedStartTime!.hour,
      _selectedStartTime!.minute,
    );
    final endAt = DateTime(
      _selectedDate!.year,
      _selectedDate!.month,
      _selectedDate!.day,
      _selectedEndTime!.hour,
      _selectedEndTime!.minute,
    );
    if (!endAt.isAfter(startAt)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('End time must be after the start time.'),
        ),
      );
      return;
    }
    if (_isRecurring &&
        _recurrenceType != _RecurrenceType.custom &&
        _recurrenceEndDate == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Choose a series end date for recurring reservations.'),
        ),
      );
      return;
    }

    setState(() => _saving = true);
    try {
      final navigator = Navigator.of(context);
      final trimmedRequester = _requesterController.text.trim();
      final currentUser = widget.controller.currentUser;
      final requesterUserId =
          currentUser != null && trimmedRequester == currentUser.name
              ? currentUser.id
              : null;
      ReservationSeriesCreationResult? recurringResult;
      if (_isRecurring) {
        recurringResult = await widget.controller.createReservationSeries(
          _selectedFacility!.id,
          title: _titleController.text.trim(),
          requesterName: trimmedRequester,
          requesterUserId: requesterUserId,
          startTime: startAt.toIso8601String(),
          endTime: endAt.toIso8601String(),
          startDate: _dateOnly(_selectedDate!),
          endDate: _recurrenceType == _RecurrenceType.custom
              ? _dateOnly(_effectiveCustomDates.last)
              : _dateOnly(_recurrenceEndDate!),
          customDates: _recurrenceType == _RecurrenceType.custom
              ? _effectiveCustomDates.map(_dateOnly).toList()
              : null,
          recurrenceType: _recurrenceTypeApiValue(_recurrenceType),
          recurrenceInterval:
              _recurrenceType == _RecurrenceType.weekly ? 1 : null,
          notes: _notesController.text.trim(),
        );
      } else {
        await widget.controller.createReservation(
          _selectedFacility!.id,
          title: _titleController.text.trim(),
          requesterName: trimmedRequester,
          requesterUserId: requesterUserId,
          startTime: startAt.toIso8601String(),
          endTime: endAt.toIso8601String(),
          notes: _notesController.text.trim(),
        );
      }
      if (mounted) {
        navigator.pop();
        if (recurringResult == null) {
          ScaffoldMessenger.of(navigator.context).showSnackBar(
            const SnackBar(content: Text('Reservation created')),
          );
        } else {
          await showDialog<void>(
            context: navigator.context,
            builder: (_) => _RecurringSummaryDialog(result: recurringResult!),
          );
        }
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

  List<DateTime> get _effectiveCustomDates {
    final dates = <DateTime>[
      if (_selectedDate != null) _startOfDay(_selectedDate!),
      ..._customRecurrenceDates.map(_startOfDay),
    ];
    dates.sort((a, b) => a.compareTo(b));
    final unique = <DateTime>[];
    for (final date in dates) {
      final exists = unique.any(
        (item) =>
            item.year == date.year &&
            item.month == date.month &&
            item.day == date.day,
      );
      if (!exists) {
        unique.add(date);
      }
    }
    return unique;
  }

  Future<void> _pickDate() async {
    final initialDate = _selectedDate ?? DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: initialDate,
      firstDate: DateTime.now().subtract(const Duration(days: 365)),
      lastDate: DateTime.now().add(const Duration(days: 365 * 3)),
    );
    if (picked == null) return;
    setState(() {
      _selectedDate = picked;
      _dateController.text = _formatDatePickerValue(picked);
    });
  }

  Future<void> _pickRecurrenceEndDate() async {
    if (_selectedDate == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Choose the first reservation date first.')),
      );
      return;
    }
    final picked = await showDatePicker(
      context: context,
      initialDate: _recurrenceEndDate ?? _selectedDate!,
      firstDate: _selectedDate!,
      lastDate: DateTime.now().add(const Duration(days: 365 * 3)),
    );
    if (picked == null) return;
    setState(() {
      _recurrenceEndDate = picked;
    });
  }

  Future<void> _addCustomDate() async {
    if (_selectedDate == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Choose the first reservation date first.')),
      );
      return;
    }
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDate!,
      firstDate: _selectedDate!,
      lastDate: DateTime.now().add(const Duration(days: 365 * 3)),
    );
    if (picked == null) return;
    setState(() {
      _customRecurrenceDates.add(picked);
    });
  }

  Future<void> _pickStartTime() async {
    final picked = await showTimePicker(
      context: context,
      initialTime: _selectedStartTime ?? TimeOfDay.now(),
    );
    if (picked == null) return;
    setState(() {
      _selectedStartTime = picked;
      _startTimeDisplayController.text = _formatTimeOfDay(picked);
    });
  }

  Future<void> _pickEndTime() async {
    final initialTime = _selectedEndTime ??
        _selectedStartTime?.replacing(minute: _selectedStartTime!.minute) ??
        TimeOfDay.now();
    final picked = await showTimePicker(
      context: context,
      initialTime: initialTime,
    );
    if (picked == null) return;
    setState(() {
      _selectedEndTime = picked;
      _endTimeDisplayController.text = _formatTimeOfDay(picked);
    });
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
