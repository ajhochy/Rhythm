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

ReservationSeries? _seriesForReservation(
  FacilitiesController controller,
  Reservation reservation,
) {
  final seriesId = reservation.seriesId;
  if (seriesId == null) return null;
  final seriesList =
      controller.reservationSeriesByFacility[reservation.facilityId];
  if (seriesList == null) return null;
  for (final series in seriesList) {
    if (series.id == seriesId) {
      return series;
    }
  }
  return null;
}

Facility? _facilityForReservation(
  FacilitiesController controller,
  Reservation reservation,
) {
  for (final facility in controller.facilities) {
    if (facility.id == reservation.facilityId) {
      return facility;
    }
  }
  return null;
}

bool _canManageReservation(
    FacilitiesController controller, Reservation reservation) {
  final currentUser = controller.currentUser;
  if (controller.isFacilitiesManager) return true;
  if (currentUser == null) return false;
  return reservation.createdByUserId == currentUser.id;
}

Future<void> _showReservationDetails(
  BuildContext context,
  FacilitiesController controller,
  Reservation reservation,
) async {
  await showDialog<void>(
    context: context,
    builder: (_) => _ReservationDetailDialog(
      controller: controller,
      reservation: reservation,
    ),
  );
}

Future<void> _showEditReservationDialog(
  BuildContext context,
  FacilitiesController controller,
  Reservation reservation,
) async {
  final facility = _facilityForReservation(controller, reservation);
  if (facility == null) return;
  await showDialog<bool>(
    context: context,
    builder: (_) => _ReservationDialog(
      controller: controller,
      facilities: controller.facilities,
      preselectedFacility: facility,
      existingReservation: reservation,
    ),
  );
}

Future<void> _showEditSeriesDialog(
  BuildContext context,
  FacilitiesController controller,
  Reservation reservation,
  ReservationSeries series,
) async {
  final facility = _facilityForReservation(controller, reservation);
  if (facility == null) return;
  await showDialog<bool>(
    context: context,
    builder: (_) => _ReservationDialog(
      controller: controller,
      facilities: controller.facilities,
      preselectedFacility: facility,
      existingReservation: reservation,
      existingSeries: series,
      isEditingSeries: true,
    ),
  );
}

Future<void> _deleteReservationWithConfirmation(
  BuildContext context,
  FacilitiesController controller,
  Reservation reservation,
) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Delete reservation?'),
      content: const Text(
        'This will remove this reservation from the room schedule.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          style: FilledButton.styleFrom(
            backgroundColor: const Color(0xFFB42318),
          ),
          child: const Text('Delete'),
        ),
      ],
    ),
  );
  if (confirmed != true) return;
  await controller.deleteReservation(reservation.facilityId, reservation.id);
}

Future<void> _deleteSeriesWithConfirmation(
  BuildContext context,
  FacilitiesController controller,
  Reservation reservation,
) async {
  final seriesId = reservation.seriesId;
  if (seriesId == null) return;
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Delete recurring series?'),
      content: const Text(
        'This will delete the entire recurring series and all generated reservations.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          style: FilledButton.styleFrom(
            backgroundColor: const Color(0xFFB42318),
          ),
          child: const Text('Delete series'),
        ),
      ],
    ),
  );
  if (confirmed != true) return;
  await controller.deleteReservationSeries(reservation.facilityId, seriesId);
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

_RecurrenceType _recurrenceTypeFromApiValue(String value) {
  switch (value.toLowerCase()) {
    case 'biweekly':
      return _RecurrenceType.biweekly;
    case 'monthly':
      return _RecurrenceType.monthly;
    case 'custom':
      return _RecurrenceType.custom;
    case 'weekly':
    default:
      return _RecurrenceType.weekly;
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
    final groupedReservations = <String, Map<int, List<Reservation>>>{};
    for (final reservation in reservations) {
      final start = _parseReservationDateTime(reservation.startTime);
      final key = start == null
          ? 'No Date'
          : '${_formatDateShort(start)}, ${start.year}';
      final roomGroups = groupedReservations.putIfAbsent(key, () => {});
      roomGroups.putIfAbsent(reservation.facilityId, () => []).add(reservation);
    }
    final setupReservations = reservations
        .where((reservation) => reservation.notes?.trim().isNotEmpty == true)
        .toList();
    final conflictedReservations =
        reservations.where((reservation) => reservation.isConflicted).toList();
    final externallyManagedReservations = reservations
        .where((reservation) => !reservation.createdByRhythm)
        .toList();

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
          _OverviewSignalPanel(
            controller: controller,
            reservations: reservations,
            setupReservations: setupReservations,
            conflictedReservations: conflictedReservations,
            externallyManagedReservations: externallyManagedReservations,
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
                            child: _OverviewDayGroup(
                              title: entry.key,
                              reservationsByFacility: entry.value,
                              facilities: controller.facilities,
                              controller: controller,
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

class _OverviewSignalPanel extends StatelessWidget {
  const _OverviewSignalPanel({
    required this.controller,
    required this.reservations,
    required this.setupReservations,
    required this.conflictedReservations,
    required this.externallyManagedReservations,
  });

  final FacilitiesController controller;
  final List<Reservation> reservations;
  final List<Reservation> setupReservations;
  final List<Reservation> conflictedReservations;
  final List<Reservation> externallyManagedReservations;

  @override
  Widget build(BuildContext context) {
    final roomsInUse =
        reservations.map((item) => item.facilityId).toSet().length;
    final highlightReservations = <Reservation>[
      ...conflictedReservations.take(3),
      ...setupReservations
          .where((reservation) =>
              !conflictedReservations.any((item) => item.id == reservation.id))
          .take(3),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            _OverviewMetricCard(
              icon: Icons.meeting_room_outlined,
              title: 'Rooms in use',
              value: '$roomsInUse',
              subtitle: 'Active rooms in this range',
            ),
            _OverviewMetricCard(
              icon: Icons.sticky_note_2_outlined,
              title: 'Setup notes',
              value: '${setupReservations.length}',
              subtitle: 'Reservations with room-prep notes',
              tone: setupReservations.isEmpty
                  ? _OverviewMetricTone.neutral
                  : _OverviewMetricTone.attention,
            ),
            _OverviewMetricCard(
              icon: Icons.warning_amber_outlined,
              title: 'Conflicts',
              value: '${conflictedReservations.length}',
              subtitle: 'Reservations flagged for overlap',
              tone: conflictedReservations.isEmpty
                  ? _OverviewMetricTone.neutral
                  : _OverviewMetricTone.danger,
            ),
            _OverviewMetricCard(
              icon: Icons.sync_outlined,
              title: 'External changes',
              value: '${externallyManagedReservations.length}',
              subtitle: 'Imported from calendar sync',
              tone: externallyManagedReservations.isEmpty
                  ? _OverviewMetricTone.neutral
                  : _OverviewMetricTone.attention,
            ),
          ],
        ),
        const SizedBox(height: 16),
        Container(
          width: double.infinity,
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
              const Text(
                'Attention needed',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: _kTextPrimary,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                controller.isFacilitiesManager
                    ? 'Use this queue to catch conflicts, setup notes, and imported calendar changes quickly.'
                    : 'High-signal reservations are surfaced here for easier scanning.',
                style: const TextStyle(
                  fontSize: 12,
                  color: _kTextSecondary,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 14),
              if (highlightReservations.isEmpty &&
                  externallyManagedReservations.isEmpty)
                const Text(
                  'No conflicts, setup notes, or imported external changes in this range.',
                  style: TextStyle(fontSize: 12, color: _kTextSecondary),
                )
              else ...[
                ...highlightReservations.map(
                  (reservation) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: _AttentionReservationRow(
                      controller: controller,
                      reservation: reservation,
                    ),
                  ),
                ),
                ...externallyManagedReservations
                    .where((reservation) => !highlightReservations
                        .any((item) => item.id == reservation.id))
                    .take(2)
                    .map(
                      (reservation) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: _AttentionReservationRow(
                          controller: controller,
                          reservation: reservation,
                        ),
                      ),
                    ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

enum _OverviewMetricTone { neutral, attention, danger }

class _OverviewMetricCard extends StatelessWidget {
  const _OverviewMetricCard({
    required this.icon,
    required this.title,
    required this.value,
    required this.subtitle,
    this.tone = _OverviewMetricTone.neutral,
  });

  final IconData icon;
  final String title;
  final String value;
  final String subtitle;
  final _OverviewMetricTone tone;

  @override
  Widget build(BuildContext context) {
    final Color background;
    final Color border;
    final Color accent;
    switch (tone) {
      case _OverviewMetricTone.attention:
        background = const Color(0xFFFFF7E8);
        border = const Color(0xFFF4D6A3);
        accent = const Color(0xFFB54708);
        break;
      case _OverviewMetricTone.danger:
        background = const Color(0xFFFDECEC);
        border = const Color(0xFFF4C7C7);
        accent = const Color(0xFFB42318);
        break;
      case _OverviewMetricTone.neutral:
        background = _kSurface.withValues(alpha: 0.96);
        border = _kBorder;
        accent = RhythmTokens.accent;
        break;
    }

    return Container(
      width: 220,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: accent, size: 20),
          const SizedBox(height: 14),
          Text(
            title,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: _kTextSecondary,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: const TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w700,
              color: _kTextPrimary,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            subtitle,
            style: const TextStyle(
              fontSize: 11,
              height: 1.4,
              color: _kTextSecondary,
            ),
          ),
        ],
      ),
    );
  }
}

class _AttentionReservationRow extends StatelessWidget {
  const _AttentionReservationRow({
    required this.controller,
    required this.reservation,
  });

  final FacilitiesController controller;
  final Reservation reservation;

  @override
  Widget build(BuildContext context) {
    final facility = _facilityForReservation(controller, reservation);
    final parts = <String>[];
    if (reservation.isConflicted) {
      parts.add('Conflict');
    }
    if (reservation.notes?.trim().isNotEmpty == true) {
      parts.add('Setup note');
    }
    if (!reservation.createdByRhythm) {
      parts.add('External change');
    }

    return InkWell(
      onTap: () => _showReservationDetails(context, controller, reservation),
      borderRadius: BorderRadius.circular(14),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: _kCanvas.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: _kBorder),
        ),
        child: Row(
          children: [
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
                    '${facility?.name ?? 'Room #${reservation.facilityId}'} · ${parts.join(' · ')}',
                    style: const TextStyle(
                      fontSize: 12,
                      color: _kTextSecondary,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, color: _kTextSecondary),
          ],
        ),
      ),
    );
  }
}

class _OverviewDayGroup extends StatelessWidget {
  const _OverviewDayGroup({
    required this.title,
    required this.reservationsByFacility,
    required this.facilities,
    required this.controller,
  });

  final String title;
  final Map<int, List<Reservation>> reservationsByFacility;
  final List<Facility> facilities;
  final FacilitiesController controller;

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
          ...reservationsByFacility.entries.map((entry) {
            final facility = facilitiesById[entry.key];
            final reservations = entry.value
              ..sort(
                  (a, b) => (a.startTime ?? '').compareTo(b.startTime ?? ''));
            return Padding(
              padding: const EdgeInsets.only(bottom: 14),
              child: _OverviewRoomSection(
                facility: facility,
                reservations: reservations,
                controller: controller,
              ),
            );
          }),
        ],
      ),
    );
  }
}

class _OverviewRoomSection extends StatelessWidget {
  const _OverviewRoomSection({
    required this.facility,
    required this.reservations,
    required this.controller,
  });

  final Facility? facility;
  final List<Reservation> reservations;
  final FacilitiesController controller;

  @override
  Widget build(BuildContext context) {
    final conflictCount =
        reservations.where((item) => item.isConflicted).length;
    final setupCount = reservations
        .where((item) => item.notes?.trim().isNotEmpty == true)
        .length;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: _kCanvas.withValues(alpha: 0.35),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _kBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      facility?.name ??
                          'Room #${reservations.first.facilityId}',
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: _kTextPrimary,
                      ),
                    ),
                    if (facility?.building?.isNotEmpty == true)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(
                          facility!.building!,
                          style: const TextStyle(
                            fontSize: 12,
                            color: _kTextSecondary,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  _InlineInfoPill(
                    label:
                        '${reservations.length} ${reservations.length == 1 ? 'booking' : 'bookings'}',
                  ),
                  if (setupCount > 0)
                    const _InlineInfoPill(
                      label: 'Setup notes',
                      tone: _OverviewMetricTone.attention,
                    ),
                  if (conflictCount > 0)
                    _InlineInfoPill(
                      label:
                          '$conflictCount ${conflictCount == 1 ? 'conflict' : 'conflicts'}',
                      tone: _OverviewMetricTone.danger,
                    ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 12),
          ...reservations.map(
            (reservation) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _OverviewReservationRow(
                reservation: reservation,
                facility: facility,
                controller: controller,
                onTap: () =>
                    _showReservationDetails(context, controller, reservation),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _InlineInfoPill extends StatelessWidget {
  const _InlineInfoPill({
    required this.label,
    this.tone = _OverviewMetricTone.neutral,
  });

  final String label;
  final _OverviewMetricTone tone;

  @override
  Widget build(BuildContext context) {
    final Color background;
    final Color border;
    final Color foreground;
    switch (tone) {
      case _OverviewMetricTone.attention:
        background = const Color(0xFFFFF7E8);
        border = const Color(0xFFF4D6A3);
        foreground = const Color(0xFFB54708);
        break;
      case _OverviewMetricTone.danger:
        background = const Color(0xFFFDECEC);
        border = const Color(0xFFF4C7C7);
        foreground = const Color(0xFFB42318);
        break;
      case _OverviewMetricTone.neutral:
        background = _kSurface.withValues(alpha: 0.6);
        border = _kBorder;
        foreground = _kTextSecondary;
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: border),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: foreground,
        ),
      ),
    );
  }
}

class _OverviewReservationRow extends StatelessWidget {
  const _OverviewReservationRow({
    required this.reservation,
    required this.facility,
    required this.controller,
    required this.onTap,
  });

  final Reservation reservation;
  final Facility? facility;
  final FacilitiesController controller;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final start = _parseReservationDateTime(reservation.startTime);
    final end = _parseReservationDateTime(reservation.endTime);
    final currentFacility = facility;
    final series = _seriesForReservation(controller, reservation);
    final canManage = _canManageReservation(controller, reservation);
    final facilityLabel = currentFacility == null
        ? reservation.requesterName
        : '${currentFacility.name}${currentFacility.building?.isNotEmpty == true ? ' · ${currentFacility.building}' : ''}';
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
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
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(
                          reservation.title,
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: _kTextPrimary,
                          ),
                        ),
                      ),
                      if (series != null) ...[
                        const SizedBox(width: 8),
                        _SeriesBadge(series: series),
                      ],
                      if (!reservation.createdByRhythm) ...[
                        const SizedBox(width: 8),
                        const _InlineInfoPill(
                          label: 'External',
                          tone: _OverviewMetricTone.attention,
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    facilityLabel,
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
                  if (reservation.notes != null &&
                      reservation.notes!.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFFF7E8),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: const Color(0xFFF4D6A3)),
                        ),
                        child: Text(
                          reservation.notes!,
                          style: const TextStyle(
                            fontSize: 12,
                            color: _kTextSecondary,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (reservation.isConflicted)
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
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
                const SizedBox(height: 8),
                PopupMenuButton<_OverviewAction>(
                  tooltip: canManage ? 'Manage reservation' : 'View actions',
                  onSelected: (value) async {
                    switch (value) {
                      case _OverviewAction.open:
                        await _showReservationDetails(
                          context,
                          controller,
                          reservation,
                        );
                        break;
                      case _OverviewAction.edit:
                        if (series != null) {
                          await _showEditSeriesDialog(
                            context,
                            controller,
                            reservation,
                            series,
                          );
                        } else {
                          await _showEditReservationDialog(
                            context,
                            controller,
                            reservation,
                          );
                        }
                        break;
                      case _OverviewAction.delete:
                        if (series != null) {
                          await _deleteSeriesWithConfirmation(
                            context,
                            controller,
                            reservation,
                          );
                        } else {
                          await _deleteReservationWithConfirmation(
                            context,
                            controller,
                            reservation,
                          );
                        }
                        break;
                    }
                  },
                  itemBuilder: (context) => [
                    const PopupMenuItem(
                      value: _OverviewAction.open,
                      child: Text('Open details'),
                    ),
                    if (canManage)
                      PopupMenuItem(
                        value: _OverviewAction.edit,
                        child: Text(
                          series != null ? 'Edit series' : 'Edit reservation',
                        ),
                      ),
                    if (canManage)
                      PopupMenuItem(
                        value: _OverviewAction.delete,
                        child: Text(
                          series != null
                              ? 'Delete series'
                              : 'Delete reservation',
                        ),
                      ),
                  ],
                  child: Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: _kSurface.withValues(alpha: 0.6),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: _kBorder),
                    ),
                    child: const Icon(
                      Icons.more_horiz,
                      size: 18,
                      color: _kTextSecondary,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

enum _OverviewAction { open, edit, delete }

class _SeriesBadge extends StatelessWidget {
  const _SeriesBadge({required this.series});

  final ReservationSeries series;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: series.title,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: RhythmTokens.accentSoft,
          borderRadius: BorderRadius.circular(999),
          border:
              Border.all(color: RhythmTokens.accent.withValues(alpha: 0.16)),
        ),
        child: Text(
          'Series',
          style: TextStyle(
            fontSize: 10,
            fontWeight: FontWeight.w700,
            color: RhythmTokens.accent.withValues(alpha: 0.9),
          ),
        ),
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
              _ReservationPreviewCard(
                reservation: previewReservation,
                series: _seriesForReservation(controller, previewReservation),
                onTap: () => _showReservationDetails(
                  context,
                  controller,
                  previewReservation,
                ),
              ),
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
  const _ReservationPreviewCard({
    required this.reservation,
    required this.series,
    required this.onTap,
  });

  final Reservation reservation;
  final ReservationSeries? series;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final start = _parseReservationDateTime(reservation.startTime);
    final end = _parseReservationDateTime(reservation.endTime);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
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
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    reservation.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: _kTextPrimary,
                    ),
                  ),
                ),
                if (series != null) ...[
                  const SizedBox(width: 8),
                  _SeriesBadge(series: series!),
                ],
              ],
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
      ),
    );
  }
}

class _ReservationDetailDialog extends StatefulWidget {
  const _ReservationDetailDialog({
    required this.controller,
    required this.reservation,
  });

  final FacilitiesController controller;
  final Reservation reservation;

  @override
  State<_ReservationDetailDialog> createState() =>
      _ReservationDetailDialogState();
}

class _ReservationDetailDialogState extends State<_ReservationDetailDialog> {
  ReservationSeries? _series;
  bool _loadingSeries = false;

  @override
  void initState() {
    super.initState();
    _loadSeries();
  }

  Future<void> _loadSeries() async {
    final seriesId = widget.reservation.seriesId;
    if (seriesId == null) return;
    final cached = _seriesForReservation(widget.controller, widget.reservation);
    if (cached != null) {
      setState(() => _series = cached);
      return;
    }
    setState(() => _loadingSeries = true);
    try {
      final series = await widget.controller.loadReservationSeriesDetail(
        widget.reservation.facilityId,
        seriesId,
      );
      if (mounted) {
        setState(() => _series = series);
      }
    } finally {
      if (mounted) {
        setState(() => _loadingSeries = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final reservation = widget.reservation;
    final facility = _facilityForReservation(widget.controller, reservation);
    final start = _parseReservationDateTime(reservation.startTime);
    final end = _parseReservationDateTime(reservation.endTime);
    final canManage = _canManageReservation(widget.controller, reservation);

    return AlertDialog(
      title: const Text('Reservation details'),
      content: SizedBox(
        width: 480,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              reservation.title,
              style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              facility == null
                  ? 'Room #${reservation.facilityId}'
                  : '${facility.name}${facility.building?.isNotEmpty == true ? ' · ${facility.building}' : ''}',
              style: const TextStyle(fontSize: 13, color: _kTextSecondary),
            ),
            const SizedBox(height: 8),
            if (start != null)
              Text(
                '${_formatDatePickerValue(start)} · ${_formatTimeOnly(start)}${end != null ? ' - ${_formatTimeOnly(end)}' : ''}',
                style: const TextStyle(fontSize: 13, color: _kTextSecondary),
              ),
            const SizedBox(height: 8),
            Text(
              'Requester: ${reservation.requesterName}',
              style: const TextStyle(fontSize: 13, color: _kTextSecondary),
            ),
            if (reservation.createdByName != null &&
                reservation.createdByName != reservation.requesterName)
              Text(
                'Booked by ${reservation.createdByName}',
                style: const TextStyle(fontSize: 13, color: _kTextSecondary),
              ),
            if (reservation.notes != null && reservation.notes!.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(
                reservation.notes!,
                style: const TextStyle(fontSize: 13, color: _kTextSecondary),
              ),
            ],
            const SizedBox(height: 12),
            if (reservation.seriesId != null)
              _series == null && _loadingSeries
                  ? const LinearProgressIndicator(minHeight: 2)
                  : _series != null
                      ? _SeriesInfoPanel(series: _series!)
                      : const Text(
                          'This reservation belongs to a recurring series.',
                          style:
                              TextStyle(fontSize: 13, color: _kTextSecondary),
                        ),
          ],
        ),
      ),
      actions: [
        if (reservation.seriesId == null && canManage)
          TextButton(
            onPressed: _editReservation,
            child: const Text('Edit reservation'),
          ),
        if (reservation.seriesId == null && canManage)
          TextButton(
            onPressed: _deleteReservation,
            style: TextButton.styleFrom(
              foregroundColor: const Color(0xFFB42318),
            ),
            child: const Text('Delete reservation'),
          ),
        if (reservation.seriesId != null && canManage)
          TextButton(
            onPressed: _loadingSeries ? null : _editEntireSeries,
            child: const Text('Edit entire series'),
          ),
        if (reservation.seriesId != null && canManage)
          TextButton(
            onPressed: _loadingSeries ? null : _deleteEntireSeries,
            style: TextButton.styleFrom(
              foregroundColor: const Color(0xFFB42318),
            ),
            child: const Text('Delete entire series'),
          ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Close'),
        ),
      ],
    );
  }

  Future<void> _editReservation() async {
    final facility =
        _facilityForReservation(widget.controller, widget.reservation);
    if (facility == null) return;
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _ReservationDialog(
        controller: widget.controller,
        facilities: widget.controller.facilities,
        preselectedFacility: facility,
        existingReservation: widget.reservation,
      ),
    );
    if (saved == true && mounted) {
      Navigator.of(context).pop();
    }
  }

  Future<void> _deleteReservation() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete reservation?'),
        content: const Text(
          'This will remove this reservation from the room schedule.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFB42318),
            ),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await widget.controller.deleteReservation(
      widget.reservation.facilityId,
      widget.reservation.id,
    );
    if (mounted) {
      Navigator.of(context).pop();
    }
  }

  Future<void> _editEntireSeries() async {
    final seriesId = widget.reservation.seriesId;
    if (seriesId == null) return;
    final series =
        _series ?? _seriesForReservation(widget.controller, widget.reservation);
    final facility =
        _facilityForReservation(widget.controller, widget.reservation);
    if (series == null || facility == null) return;
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _ReservationDialog(
        controller: widget.controller,
        facilities: widget.controller.facilities,
        preselectedFacility: facility,
        existingReservation: widget.reservation,
        existingSeries: series,
        isEditingSeries: true,
      ),
    );
    if (saved == true && mounted) {
      Navigator.of(context).pop();
    }
  }

  Future<void> _deleteEntireSeries() async {
    final seriesId = widget.reservation.seriesId;
    if (seriesId == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete recurring series?'),
        content: const Text(
          'This will delete the entire recurring series and all generated reservations.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFB42318),
            ),
            child: const Text('Delete series'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await widget.controller.deleteReservationSeries(
      widget.reservation.facilityId,
      seriesId,
    );
    if (mounted) {
      Navigator.of(context).pop();
    }
  }
}

class _SeriesInfoPanel extends StatelessWidget {
  const _SeriesInfoPanel({required this.series});

  final ReservationSeries series;

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
      child: Text(
        'Recurring series: ${series.title} · ${series.recurrenceType}',
        style: const TextStyle(fontSize: 12, color: _kTextSecondary),
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
    this.existingReservation,
    this.existingSeries,
    this.isEditingSeries = false,
  });

  final FacilitiesController controller;
  final List<Facility> facilities;
  final Facility? preselectedFacility;
  final Reservation? existingReservation;
  final ReservationSeries? existingSeries;
  final bool isEditingSeries;

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

  bool get _isEditingSingleReservation =>
      widget.existingReservation != null && !widget.isEditingSeries;

  List<Reservation> get _selectedFacilityReservations =>
      _selectedFacility == null
          ? const []
          : widget.controller.reservationsByFacility[_selectedFacility!.id] ??
              const [];

  List<Reservation> get _reservationsForSelectedDate {
    final selectedDate = _selectedDate;
    if (selectedDate == null) return const [];
    final reservationId = widget.existingReservation?.id;
    final seriesId = widget.existingSeries?.id;
    final sameDay = _selectedFacilityReservations.where((reservation) {
      if (reservationId != null && reservation.id == reservationId) {
        return false;
      }
      if (seriesId != null && reservation.seriesId == seriesId) {
        return false;
      }
      final start = _parseReservationDateTime(reservation.startTime);
      return start != null &&
          start.year == selectedDate.year &&
          start.month == selectedDate.month &&
          start.day == selectedDate.day;
    }).toList()
      ..sort((a, b) => (a.startTime ?? '').compareTo(b.startTime ?? ''));
    return sameDay;
  }

  List<Reservation> get _overlappingReservations {
    final selectedDate = _selectedDate;
    final selectedStartTime = _selectedStartTime;
    final selectedEndTime = _selectedEndTime;
    if (selectedDate == null ||
        selectedStartTime == null ||
        selectedEndTime == null) {
      return const [];
    }

    final selectedStart = DateTime(
      selectedDate.year,
      selectedDate.month,
      selectedDate.day,
      selectedStartTime.hour,
      selectedStartTime.minute,
    );
    final selectedEnd = DateTime(
      selectedDate.year,
      selectedDate.month,
      selectedDate.day,
      selectedEndTime.hour,
      selectedEndTime.minute,
    );
    if (!selectedEnd.isAfter(selectedStart)) {
      return const [];
    }

    return _reservationsForSelectedDate.where((reservation) {
      final start = _parseReservationDateTime(reservation.startTime);
      final end = _parseReservationDateTime(reservation.endTime);
      if (start == null || end == null) return false;
      return start.isBefore(selectedEnd) && end.isAfter(selectedStart);
    }).toList();
  }

  @override
  void initState() {
    super.initState();
    _selectedFacility = widget.preselectedFacility ??
        (widget.facilities.isNotEmpty ? widget.facilities.first : null);
    final reservation = widget.existingReservation;
    final series = widget.existingSeries;
    _titleController.text = reservation?.title ?? series?.title ?? '';
    _requesterController.text = reservation?.requesterName ??
        series?.requesterName ??
        widget.controller.currentUser?.name ??
        '';
    _notesController.text = reservation?.notes ?? series?.notes ?? '';

    final startValue = reservation?.startTime ?? series?.startTime;
    final endValue = reservation?.endTime ?? series?.endTime;
    final startDateTime = _parseReservationDateTime(startValue);
    final endDateTime = _parseReservationDateTime(endValue);
    if (startDateTime != null) {
      _selectedDate = startDateTime;
      _dateController.text = _formatDatePickerValue(startDateTime);
      _selectedStartTime = TimeOfDay.fromDateTime(startDateTime);
      _startTimeDisplayController.text = _formatTimeOfDay(_selectedStartTime!);
    }
    if (endDateTime != null) {
      _selectedEndTime = TimeOfDay.fromDateTime(endDateTime);
      _endTimeDisplayController.text = _formatTimeOfDay(_selectedEndTime!);
    }
    if (widget.isEditingSeries && series != null) {
      _isRecurring = true;
      _recurrenceType = _recurrenceTypeFromApiValue(series.recurrenceType);
      _recurrenceEndDate =
          series.endDate == null ? null : DateTime.tryParse(series.endDate!);
      _customRecurrenceDates.addAll(
        series.customDates
            .map(DateTime.tryParse)
            .whereType<DateTime>()
            .toList(),
      );
      if (_selectedDate == null) {
        final seriesStart = DateTime.tryParse(series.startDate);
        if (seriesStart != null) {
          _selectedDate = seriesStart;
          _dateController.text = _formatDatePickerValue(seriesStart);
        }
      }
    }
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
                          widget.isEditingSeries
                              ? 'Edit series'
                              : _isEditingSingleReservation
                                  ? 'Edit booking'
                                  : isTopLevel
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
                  if (_selectedFacility != null)
                    _AvailabilityPanel(
                      facility: _selectedFacility!,
                      selectedDate: _selectedDate,
                      selectedStartTime: _selectedStartTime,
                      selectedEndTime: _selectedEndTime,
                      dayReservations: _reservationsForSelectedDate,
                      conflictingReservations: _overlappingReservations,
                      showRecurringHint:
                          (_isRecurring || widget.isEditingSeries) &&
                              !_isEditingSingleReservation,
                    ),
                  if (_selectedFacility != null) const SizedBox(height: 14),
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
                  if (!widget.isEditingSeries && !_isEditingSingleReservation)
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
                  if ((_isRecurring || widget.isEditingSeries) &&
                      !_isEditingSingleReservation) ...[
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
                      const _RecurringInfoCard(
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
                            : Text(
                                widget.isEditingSeries
                                    ? 'Save series'
                                    : _isEditingSingleReservation
                                        ? 'Save changes'
                                        : 'Submit',
                              ),
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
      final isRecurring = (_isRecurring || widget.isEditingSeries) &&
          !_isEditingSingleReservation;
      final isCustomSeries = _recurrenceType == _RecurrenceType.custom;
      final seriesEndDate = isCustomSeries
          ? _dateOnly(_effectiveCustomDates.last)
          : _recurrenceEndDate != null
              ? _dateOnly(_recurrenceEndDate!)
              : null;
      final notes = _notesController.text.trim();
      if (_overlappingReservations.isNotEmpty && !isRecurring) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'That time overlaps an existing reservation for this room.',
            ),
          ),
        );
        setState(() => _saving = false);
        return;
      }
      if (_isEditingSingleReservation) {
        await widget.controller.updateReservation(
          _selectedFacility!.id,
          widget.existingReservation!.id,
          title: _titleController.text.trim(),
          requesterName: trimmedRequester,
          requesterUserId: requesterUserId,
          startTime: startAt.toIso8601String(),
          endTime: endAt.toIso8601String(),
          notes: notes,
        );
      } else if (widget.isEditingSeries) {
        await widget.controller.updateReservationSeries(
          _selectedFacility!.id,
          widget.existingSeries!.id,
          title: _titleController.text.trim(),
          requesterName: trimmedRequester,
          requesterUserId: requesterUserId,
          startTime: startAt.toIso8601String(),
          endTime: endAt.toIso8601String(),
          startDate: _dateOnly(_selectedDate!),
          endDate: seriesEndDate,
          customDates: isCustomSeries
              ? _effectiveCustomDates.map(_dateOnly).toList()
              : null,
          recurrenceType: _recurrenceTypeApiValue(_recurrenceType),
          recurrenceInterval:
              _recurrenceType == _RecurrenceType.weekly ? 1 : null,
          notes: notes,
        );
      } else if (isRecurring) {
        final recurringResult = await widget.controller.createReservationSeries(
          _selectedFacility!.id,
          title: _titleController.text.trim(),
          requesterName: trimmedRequester,
          requesterUserId: requesterUserId,
          startTime: startAt.toIso8601String(),
          endTime: endAt.toIso8601String(),
          startDate: _dateOnly(_selectedDate!),
          endDate: seriesEndDate!,
          customDates: isCustomSeries
              ? _effectiveCustomDates.map(_dateOnly).toList()
              : null,
          recurrenceType: _recurrenceTypeApiValue(_recurrenceType),
          recurrenceInterval:
              _recurrenceType == _RecurrenceType.weekly ? 1 : null,
          notes: notes,
        );
        if (mounted) {
          navigator.pop();
          await showDialog<void>(
            context: navigator.context,
            builder: (_) => _RecurringSummaryDialog(result: recurringResult),
          );
        }
        return;
      } else {
        await widget.controller.createReservation(
          _selectedFacility!.id,
          title: _titleController.text.trim(),
          requesterName: trimmedRequester,
          requesterUserId: requesterUserId,
          startTime: startAt.toIso8601String(),
          endTime: endAt.toIso8601String(),
          notes: notes,
        );
      }
      if (mounted) {
        navigator.pop(widget.isEditingSeries || _isEditingSingleReservation
            ? true
            : null);
        if (!widget.isEditingSeries && !_isEditingSingleReservation) {
          ScaffoldMessenger.of(navigator.context).showSnackBar(
            const SnackBar(content: Text('Reservation created')),
          );
        } else if (_isEditingSingleReservation) {
          ScaffoldMessenger.of(navigator.context).showSnackBar(
            const SnackBar(content: Text('Reservation updated')),
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

class _AvailabilityPanel extends StatelessWidget {
  const _AvailabilityPanel({
    required this.facility,
    required this.selectedDate,
    required this.selectedStartTime,
    required this.selectedEndTime,
    required this.dayReservations,
    required this.conflictingReservations,
    required this.showRecurringHint,
  });

  final Facility facility;
  final DateTime? selectedDate;
  final TimeOfDay? selectedStartTime;
  final TimeOfDay? selectedEndTime;
  final List<Reservation> dayReservations;
  final List<Reservation> conflictingReservations;
  final bool showRecurringHint;

  @override
  Widget build(BuildContext context) {
    final hasSelectedSlot = selectedDate != null &&
        selectedStartTime != null &&
        selectedEndTime != null;
    final hasConflict = conflictingReservations.isNotEmpty;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: _kCanvas.withValues(alpha: 0.45),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: hasConflict ? const Color(0xFFF4C7C7) : _kBorder,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Availability for ${facility.name}',
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: _kTextPrimary,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            selectedDate == null
                ? 'Choose a date to see the room schedule.'
                : '${_formatDatePickerValue(selectedDate!)} · ${dayReservations.length} existing ${dayReservations.length == 1 ? 'reservation' : 'reservations'}',
            style: const TextStyle(fontSize: 12, color: _kTextSecondary),
          ),
          if (hasSelectedSlot) ...[
            const SizedBox(height: 10),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: hasConflict
                    ? const Color(0xFFFDECEC)
                    : const Color(0xFFEAF7EF),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: hasConflict
                      ? const Color(0xFFF4C7C7)
                      : const Color(0xFFD3EEDC),
                ),
              ),
              child: Text(
                hasConflict
                    ? 'Selected time overlaps ${conflictingReservations.length} existing ${conflictingReservations.length == 1 ? 'reservation' : 'reservations'}.'
                    : 'Selected time is open for this room based on current reservations.',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: hasConflict
                      ? const Color(0xFFB42318)
                      : const Color(0xFF15803D),
                ),
              ),
            ),
          ],
          if (showRecurringHint) ...[
            const SizedBox(height: 10),
            const Text(
              'Recurring conflicts are checked across the full series when you save. This preview only covers the selected date.',
              style: TextStyle(fontSize: 12, color: _kTextSecondary),
            ),
          ],
          if (dayReservations.isNotEmpty) ...[
            const SizedBox(height: 12),
            ...dayReservations.map(
              (reservation) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _AvailabilityReservationRow(
                  reservation: reservation,
                  isConflicting: conflictingReservations.any(
                    (item) => item.id == reservation.id,
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _AvailabilityReservationRow extends StatelessWidget {
  const _AvailabilityReservationRow({
    required this.reservation,
    required this.isConflicting,
  });

  final Reservation reservation;
  final bool isConflicting;

  @override
  Widget build(BuildContext context) {
    final start = _parseReservationDateTime(reservation.startTime);
    final end = _parseReservationDateTime(reservation.endTime);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: isConflicting
            ? const Color(0xFFFDECEC)
            : _kSurface.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isConflicting ? const Color(0xFFF4C7C7) : _kBorder,
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 112,
            child: Text(
              start == null
                  ? 'Time TBD'
                  : '${_formatTimeOnly(start)}${end != null ? ' - ${_formatTimeOnly(end)}' : ''}',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: isConflicting ? const Color(0xFFB42318) : _kTextPrimary,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  reservation.title,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: _kTextPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  reservation.requesterName,
                  style: const TextStyle(
                    fontSize: 11,
                    color: _kTextSecondary,
                  ),
                ),
              ],
            ),
          ),
          if (isConflicting)
            const Text(
              'Overlap',
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w700,
                color: Color(0xFFB42318),
              ),
            ),
        ],
      ),
    );
  }
}
