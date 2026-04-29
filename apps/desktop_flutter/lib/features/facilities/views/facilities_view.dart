import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../../app/core/widgets/error_banner.dart';
import '../controllers/facilities_controller.dart';
import '../models/facility.dart';
import '../models/reservation.dart';
import '../models/reservation_series.dart';

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
          color: context.rhythm.canvas,
          child: Stack(
            children: [
              Positioned(
                top: -90,
                right: -90,
                child:
                    _AmbientOrb(color: context.rhythm.accentMuted, size: 220),
              ),
              Positioned(
                bottom: -110,
                left: -70,
                child:
                    _AmbientOrb(color: context.rhythm.accentMuted, size: 180),
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
    BuildContext context,
    FacilitiesController controller,
  ) async {
    await showDialog<void>(
      context: context,
      builder: (_) => _ReservationDialog(
        controller: controller,
        facilities: controller.facilities,
      ),
    );
  }

  Future<void> _showCreateFacilityDialog(
    BuildContext context,
    FacilitiesController controller,
  ) async {
    await showDialog<void>(
      context: context,
      builder: (_) => _FacilityDialog(controller: controller),
    );
  }

  Future<void> _showEditFacilityDialog(
    BuildContext context,
    FacilitiesController controller,
    Facility facility,
  ) async {
    await showDialog<void>(
      context: context,
      builder: (_) =>
          _FacilityDialog(controller: controller, existingFacility: facility),
    );
  }

  Future<void> _deleteFacilityWithConfirmation(
    BuildContext context,
    FacilitiesController controller,
    Facility facility,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Delete space?'),
        content: Text(
          'This will remove ${facility.name} and its room schedule from the app.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFB42318),
            ),
            child: Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await controller.deleteFacility(facility.id);
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
  final parsed = DateTime.tryParse(normalized);
  if (parsed == null) return null;
  return parsed.isUtc ? parsed.toLocal() : parsed;
}

const List<String> _kWeekdayNames = <String>[
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

const List<String> _kMonthNames = <String>[
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

String _formatFriendlyDate(BuildContext context, DateTime date) {
  return '${_kWeekdayNames[date.weekday - 1]}, ${_kMonthNames[date.month - 1]} ${date.day}, ${date.year}';
}

String _formatFriendlyDateTime(BuildContext context, DateTime dateTime) {
  final localizations = MaterialLocalizations.of(context);
  final time = localizations.formatTimeOfDay(
    TimeOfDay.fromDateTime(dateTime),
    alwaysUse24HourFormat: false,
  );
  return '${_formatFriendlyDate(context, dateTime)} at $time';
}

String _formatRecurringConflictMessage(
  BuildContext context,
  ReservationSeriesConflict conflict,
) {
  final date = _parseReservationDateTime(conflict.date);
  final header =
      date == null ? conflict.date : _formatFriendlyDate(context, date);
  final match = RegExp(
    r'^Conflicts with "(.*)" from ([^ ]+) to ([^.]*)\. Choose a different room or time\.$',
  ).firstMatch(conflict.reason);
  if (match == null) {
    return '$header: ${conflict.reason}';
  }

  final reservationTitle = match.group(1) ?? 'Existing reservation';
  final start = _parseReservationDateTime(match.group(2));
  final end = _parseReservationDateTime(match.group(3));

  if (start == null || end == null) {
    return '$header: ${conflict.reason}';
  }

  return '$header: Conflicts with "$reservationTitle" from ${_formatFriendlyDateTime(context, start)} to ${MaterialLocalizations.of(context).formatTimeOfDay(TimeOfDay.fromDateTime(end), alwaysUse24HourFormat: false)}. Choose a different room or time.';
}

int _compareReservationStartTimes(Reservation a, Reservation b) {
  final aStart = _parseReservationDateTime(a.startTime);
  final bStart = _parseReservationDateTime(b.startTime);
  if (aStart == null && bStart == null) return 0;
  if (aStart == null) return 1;
  if (bStart == null) return -1;
  return aStart.compareTo(bStart);
}

String _reservationGroupKey(Reservation reservation) {
  final explicitGroupId = reservation.reservationGroupId?.trim();
  if (explicitGroupId != null && explicitGroupId.isNotEmpty) {
    return 'group:$explicitGroupId';
  }
  final start = _parseReservationDateTime(reservation.startTime);
  final end = _parseReservationDateTime(reservation.endTime);
  return [
    start?.toIso8601String() ?? reservation.startTime?.trim() ?? '',
    end?.toIso8601String() ?? reservation.endTime?.trim() ?? '',
    reservation.title.trim().toLowerCase(),
    reservation.requesterName.trim().toLowerCase(),
    reservation.createdByUserId?.toString() ??
        reservation.createdByName?.trim().toLowerCase() ??
        '',
    reservation.notes?.trim().toLowerCase() ?? '',
    reservation.externalEventId?.trim().toLowerCase() ?? '',
  ].join('|');
}

List<String> _roomNamesForReservations(
  FacilitiesController controller,
  Iterable<Reservation> reservations, {
  int maxNames = 3,
}) {
  final names = <String>[];
  for (final reservation in reservations) {
    final facility = _facilityForReservation(controller, reservation);
    final roomName = facility?.name ?? 'Room #${reservation.facilityId}';
    if (!names.contains(roomName)) {
      names.add(roomName);
    }
  }
  if (names.length <= maxNames) return names;
  return [
    ...names.take(maxNames - 1),
    '${names[maxNames - 1]} +${names.length - maxNames}',
  ];
}

class _ReservationCluster {
  _ReservationCluster(Iterable<Reservation> reservations)
      : reservations = List<Reservation>.from(reservations)
          ..sort(_compareReservationStartTimes);

  final List<Reservation> reservations;

  Reservation get representative => reservations.first;

  DateTime? get start => _parseReservationDateTime(representative.startTime);

  DateTime? get end => _parseReservationDateTime(representative.endTime);

  String get key => _reservationGroupKey(representative);

  bool get isMultiRoom => reservations.length > 1;

  bool get hasRecurringSeries =>
      reservations.any((reservation) => reservation.seriesId != null);

  bool get isConflicted =>
      reservations.any((reservation) => reservation.isConflicted);

  bool get isPartiallyConflicted =>
      isConflicted &&
      reservations.any((reservation) => !reservation.isConflicted);

  bool get createdByRhythm =>
      reservations.every((reservation) => reservation.createdByRhythm);

  String get title => representative.title;

  String get requesterName => representative.requesterName;

  String? get notes => representative.notes;

  String? get createdByName => representative.createdByName;

  String? get conflictReason => representative.conflictReason;

  List<String> roomNames(FacilitiesController controller) =>
      _roomNamesForReservations(controller, reservations);
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

_ReservationCluster _reservationClusterForReservation(
  FacilitiesController controller,
  Reservation reservation,
) {
  final matchingReservations = <Reservation>[];
  for (final reservations in controller.reservationsByFacility.values) {
    matchingReservations.addAll(
      reservations.where(
        (item) =>
            _reservationGroupKey(item) == _reservationGroupKey(reservation),
      ),
    );
  }
  if (matchingReservations.isEmpty) {
    matchingReservations.add(reservation);
  }
  return _ReservationCluster(matchingReservations);
}

Future<void> _deleteReservationCluster(
  FacilitiesController controller,
  Iterable<Reservation> reservations,
) async {
  final list = reservations.toList();
  final groupedReservation = list.cast<Reservation?>().firstWhere(
        (reservation) =>
            reservation?.reservationGroupId != null &&
            reservation!.reservationGroupId!.isNotEmpty,
        orElse: () => null,
      );
  if (groupedReservation != null) {
    await controller.deleteReservation(
      groupedReservation.facilityId,
      groupedReservation.id,
    );
    return;
  }
  final seenSeries = <String>{};
  for (final reservation in list) {
    final seriesId = reservation.seriesId;
    if (seriesId != null && seriesId.isNotEmpty) {
      final key = '${reservation.facilityId}:$seriesId';
      if (seenSeries.add(key)) {
        await controller.deleteReservationSeries(
          reservation.facilityId,
          seriesId,
        );
      }
      continue;
    }
    await controller.deleteReservation(reservation.facilityId, reservation.id);
  }
}

bool _canManageReservation(
  FacilitiesController controller,
  Reservation reservation,
) {
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
  Reservation reservation, {
  List<Reservation>? groupReservations,
}) async {
  final facility = _facilityForReservation(controller, reservation);
  if (facility == null) return;
  await showDialog<bool>(
    context: context,
    builder: (_) => _ReservationDialog(
      controller: controller,
      facilities: controller.facilities,
      preselectedFacility: facility,
      existingReservation: reservation,
      existingGroupReservations: groupReservations,
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
  Reservation reservation, {
  List<Reservation>? groupReservations,
}) async {
  final group = groupReservations == null
      ? _reservationClusterForReservation(controller, reservation)
      : _ReservationCluster(groupReservations);
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(
        group.isMultiRoom ? 'Delete reservation group?' : 'Delete reservation?',
      ),
      content: Text(
        group.isMultiRoom
            ? 'This will remove the linked reservations from every selected room.'
            : 'This will remove this reservation from the room schedule.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          style: FilledButton.styleFrom(
            backgroundColor: const Color(0xFFB42318),
          ),
          child: Text('Delete'),
        ),
      ],
    ),
  );
  if (confirmed != true) return;
  if (group.isMultiRoom) {
    await _deleteReservationCluster(controller, group.reservations);
  } else {
    await controller.deleteReservation(reservation.facilityId, reservation.id);
  }
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
      title: Text('Delete recurring series?'),
      content: Text(
        'This will delete the entire recurring series and all generated reservations.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          style: FilledButton.styleFrom(
            backgroundColor: const Color(0xFFB42318),
          ),
          child: Text('Delete series'),
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
          color: context.rhythm.surfaceRaised.withValues(alpha: 0.92),
          borderRadius: BorderRadius.circular(RhythmRadius.xl),
          border: Border.all(color: context.rhythm.borderSubtle),
          boxShadow: RhythmElevation.panel,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Facilities',
                    style: TextStyle(
                      fontSize: 28,
                      height: 1.05,
                      fontWeight: FontWeight.w700,
                      color: context.rhythm.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Reserve shared spaces, equipment, and rooms from one quiet workspace.',
                    style: TextStyle(
                      fontSize: 13,
                      height: 1.45,
                      color: context.rhythm.textSecondary,
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
              icon: Icon(Icons.add, size: 18),
              label: Text('Reserve Space'),
            ),
          ],
        ),
      ),
    );
  }
}

class _FacilityDialog extends StatefulWidget {
  const _FacilityDialog({required this.controller, this.existingFacility});

  final FacilitiesController controller;
  final Facility? existingFacility;

  @override
  State<_FacilityDialog> createState() => _FacilityDialogState();
}

class _FacilityDialogState extends State<_FacilityDialog> {
  static const _newBuildingValue = '__new_building__';

  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _buildingController = TextEditingController();
  final _descriptionController = TextEditingController();
  bool _saving = false;
  bool _addingNewBuilding = false;

  @override
  void initState() {
    super.initState();
    final existing = widget.existingFacility;
    if (existing == null) return;
    _nameController.text = existing.name;
    _buildingController.text = existing.building ?? '';
    _descriptionController.text = existing.description ?? '';
  }

  @override
  void dispose() {
    _nameController.dispose();
    _buildingController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isEditing = widget.existingFacility != null;
    final existingBuildings = widget.controller.buildings;
    final currentBuilding = _buildingController.text.trim();
    final buildingOptions = <String>[
      ...existingBuildings,
      if (currentBuilding.isNotEmpty &&
          !existingBuildings.contains(currentBuilding))
        currentBuilding,
    ];

    return Dialog(
      insetPadding: const EdgeInsets.all(24),
      backgroundColor: Colors.transparent,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 520),
        decoration: BoxDecoration(
          color: context.rhythm.surfaceRaised,
          borderRadius: BorderRadius.circular(RhythmRadius.xl),
          border: Border.all(color: context.rhythm.borderSubtle),
          boxShadow: RhythmElevation.panel,
        ),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isEditing ? 'Edit space' : 'Add space',
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                    color: context.rhythm.textPrimary,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  isEditing
                      ? 'Update the room details used for scheduling and overview filters.'
                      : 'Create a room or facility so reservations can be scheduled against it.',
                  style: TextStyle(
                    fontSize: 13,
                    height: 1.45,
                    color: context.rhythm.textSecondary,
                  ),
                ),
                const SizedBox(height: 20),
                TextFormField(
                  controller: _nameController,
                  decoration: _overviewDecoration(context, 'Room name *'),
                  validator: (value) => value == null || value.trim().isEmpty
                      ? 'Room name is required'
                      : null,
                ),
                const SizedBox(height: 14),
                DropdownButtonFormField<String>(
                  initialValue: _addingNewBuilding
                      ? _newBuildingValue
                      : (currentBuilding.isEmpty ? null : currentBuilding),
                  decoration: _overviewDecoration(context, 'Building'),
                  items: [
                    const DropdownMenuItem<String>(
                      value: null,
                      child: Text('No building'),
                    ),
                    ...buildingOptions.map(
                      (building) => DropdownMenuItem<String>(
                        value: building,
                        child: Text(building),
                      ),
                    ),
                    const DropdownMenuItem<String>(
                      value: _newBuildingValue,
                      child: Text('Add new building'),
                    ),
                  ],
                  onChanged: (value) {
                    setState(() {
                      if (value == _newBuildingValue) {
                        _addingNewBuilding = true;
                        _buildingController.clear();
                      } else {
                        _addingNewBuilding = false;
                        _buildingController.text = value ?? '';
                      }
                    });
                  },
                ),
                if (_addingNewBuilding) ...[
                  const SizedBox(height: 14),
                  TextFormField(
                    controller: _buildingController,
                    decoration:
                        _overviewDecoration(context, 'New building name'),
                    validator: (value) {
                      if (!_addingNewBuilding) return null;
                      return value == null || value.trim().isEmpty
                          ? 'Building name is required'
                          : null;
                    },
                  ),
                ],
                const SizedBox(height: 14),
                TextFormField(
                  controller: _descriptionController,
                  decoration: _overviewDecoration(context, 'Description'),
                  maxLines: 3,
                ),
                const SizedBox(height: 20),
                Row(
                  children: [
                    TextButton(
                      onPressed:
                          _saving ? null : () => Navigator.of(context).pop(),
                      child: Text('Cancel'),
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
                          : Text(isEditing ? 'Save changes' : 'Create space'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _saving = true);
    try {
      final name = _nameController.text.trim();
      final building = _buildingController.text.trim();
      final description = _descriptionController.text.trim();
      final existing = widget.existingFacility;
      if (existing == null) {
        await widget.controller.createFacility(
          name: name,
          building: building,
          description: description,
        );
      } else {
        await widget.controller.updateFacility(
          existing.id,
          name: name,
          building: building,
          description: description,
        );
      }
      if (!mounted) return;
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(existing == null ? 'Space created' : 'Space updated'),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Error: $error')));
    }
  }
}

class _ModeSwitcher extends StatelessWidget {
  const _ModeSwitcher({required this.mode, required this.onChanged});

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
    final groupedReservations = <String, Map<String, List<Reservation>>>{};
    for (final reservation in reservations) {
      final start = _parseReservationDateTime(reservation.startTime);
      final key = start == null
          ? 'No Date'
          : '${_formatDateShort(start)}, ${start.year}';
      final roomGroups = groupedReservations.putIfAbsent(key, () => {});
      roomGroups
          .putIfAbsent(_reservationGroupKey(reservation), () => [])
          .add(reservation);
    }
    final setupReservations = reservations
        .where((reservation) => reservation.notes?.trim().isNotEmpty == true)
        .toList();
    final conflictedReservations =
        reservations.where((reservation) => reservation.isConflicted).toList();
    final externallyManagedReservations = reservations
        .where((reservation) => !reservation.createdByRhythm)
        .toList();

    final bodyChildren = <Widget>[
      Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: context.rhythm.surfaceRaised.withValues(alpha: 0.96),
          borderRadius: BorderRadius.circular(RhythmRadius.xl),
          border: Border.all(color: context.rhythm.borderSubtle),
          boxShadow: RhythmElevation.panel,
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
                      Text(
                        'Facilities overview',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          color: context.rhythm.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _formatRangeLabel(rangeStart, rangeEnd),
                        style: TextStyle(
                          fontSize: 13,
                          color: context.rhythm.textSecondary,
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
                  icon: Icon(Icons.chevron_left),
                  label: Text('Back'),
                ),
                OutlinedButton.icon(
                  onPressed: () => onShiftRange(1),
                  icon: Icon(Icons.chevron_right),
                  label: Text('Forward'),
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
                    isExpanded: true,
                    value: selectedBuilding,
                    decoration: _overviewDecoration(context, 'Building'),
                    dropdownColor: context.rhythm.surfaceRaised,
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
                    isExpanded: true,
                    value: selectedFacilityId,
                    decoration: _overviewDecoration(context, 'Room'),
                    dropdownColor: context.rhythm.surfaceRaised,
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
    ];

    if (controller.isLoadingOverview && reservations.isEmpty) {
      bodyChildren.add(
        const Padding(
          padding: EdgeInsets.only(top: 24),
          child: SizedBox(height: 320, child: _LoadingState()),
        ),
      );
    } else if (reservations.isEmpty) {
      bodyChildren.add(
        const Padding(
          padding: EdgeInsets.only(top: 24),
          child: _EmptyFacilitiesState(
            title: 'No reservations in this range',
            body:
                'Try another date range, room, or building to review upcoming facility usage.',
          ),
        ),
      );
    } else {
      bodyChildren.addAll(
        groupedReservations.entries.map((entry) {
          final clusters =
              entry.value.values.map(_ReservationCluster.new).toList()
                ..sort((a, b) {
                  final aStart = a.start;
                  final bStart = b.start;
                  if (aStart == null && bStart == null) return 0;
                  if (aStart == null) return 1;
                  if (bStart == null) return -1;
                  return aStart.compareTo(bStart);
                });
          return Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: _OverviewDayGroup(
              title: entry.key,
              clusters: clusters,
              facilities: controller.facilities,
              controller: controller,
            ),
          );
        }),
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 24),
      children: bodyChildren,
    );
  }
}

InputDecoration _overviewDecoration(BuildContext context, String label) {
  return InputDecoration(
    labelText: label,
    filled: true,
    fillColor: context.rhythm.canvas.withValues(alpha: 0.45),
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: BorderSide(color: context.rhythm.borderSubtle),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: BorderSide(color: context.rhythm.borderSubtle),
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
        decoration: _overviewDecoration(context, label),
        child: Text(
          value,
          style: TextStyle(fontSize: 14, color: context.rhythm.textPrimary),
        ),
      ),
    );
  }
}

class _RecurringInfoCard extends StatelessWidget {
  const _RecurringInfoCard({required this.title, required this.body});

  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: context.rhythm.canvas.withValues(alpha: 0.45),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: context.rhythm.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: context.rhythm.textPrimary,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            body,
            style: TextStyle(
              fontSize: 12,
              height: 1.4,
              color: context.rhythm.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}

class _GroupedReservationSummaryDialog extends StatelessWidget {
  const _GroupedReservationSummaryDialog({
    required this.title,
    required this.createdRooms,
    required this.updatedRooms,
    required this.removedRooms,
    required this.conflictMessages,
  });

  final String title;
  final List<String> createdRooms;
  final List<String> updatedRooms;
  final List<String> removedRooms;
  final List<String> conflictMessages;

  @override
  Widget build(BuildContext context) {
    final hasChanges = createdRooms.isNotEmpty ||
        updatedRooms.isNotEmpty ||
        removedRooms.isNotEmpty ||
        conflictMessages.isNotEmpty;
    return AlertDialog(
      title: Text(title),
      content: SizedBox(
        width: 440,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (createdRooms.isNotEmpty) ...[
                Text('Created in: ${createdRooms.join(', ')}'),
                const SizedBox(height: 8),
              ],
              if (updatedRooms.isNotEmpty) ...[
                Text('Updated in: ${updatedRooms.join(', ')}'),
                const SizedBox(height: 8),
              ],
              if (removedRooms.isNotEmpty) ...[
                Text('Removed from: ${removedRooms.join(', ')}'),
                const SizedBox(height: 8),
              ],
              if (conflictMessages.isNotEmpty) ...[
                Text(
                  'Conflicts',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 8),
                ...conflictMessages.map(
                  (message) => Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Text(
                      message,
                      style: TextStyle(
                        fontSize: 12,
                        color: context.rhythm.textSecondary,
                      ),
                    ),
                  ),
                ),
              ],
              if (!hasChanges)
                Text(
                  'No changes were applied.',
                  style: TextStyle(
                      fontSize: 12, color: context.rhythm.textSecondary),
                ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text('Close'),
        ),
      ],
    );
  }
}

class _RecurringSummaryDialog extends StatelessWidget {
  const _RecurringSummaryDialog({required this.result});

  final ReservationSeriesCreationResult result;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('Recurring reservation created'),
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
              Text(
                'Conflicted dates',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              ...result.conflicts.map(
                (conflict) => Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text(
                    _formatRecurringConflictMessage(context, conflict),
                    style: TextStyle(
                      fontSize: 12,
                      color: context.rhythm.textSecondary,
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
          child: Text('Close'),
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
          .where(
            (reservation) => !conflictedReservations.any(
              (item) => item.id == reservation.id,
            ),
          )
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
            color: context.rhythm.surfaceRaised.withValues(alpha: 0.96),
            borderRadius: BorderRadius.circular(RhythmRadius.xl),
            border: Border.all(color: context.rhythm.borderSubtle),
            boxShadow: RhythmElevation.panel,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Attention needed',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: context.rhythm.textPrimary,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                controller.isFacilitiesManager
                    ? 'Use this queue to catch conflicts, setup notes, and imported calendar changes quickly.'
                    : 'High-signal reservations are surfaced here for easier scanning.',
                style: TextStyle(
                  fontSize: 12,
                  color: context.rhythm.textSecondary,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 14),
              if (highlightReservations.isEmpty &&
                  externallyManagedReservations.isEmpty)
                Text(
                  'No conflicts, setup notes, or imported external changes in this range.',
                  style: TextStyle(
                      fontSize: 12, color: context.rhythm.textSecondary),
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
                    .where(
                      (reservation) => !highlightReservations.any(
                        (item) => item.id == reservation.id,
                      ),
                    )
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
        background = context.rhythm.surfaceRaised.withValues(alpha: 0.96);
        border = context.rhythm.borderSubtle;
        accent = context.rhythm.accent;
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
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: context.rhythm.textSecondary,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w700,
              color: context.rhythm.textPrimary,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            subtitle,
            style: TextStyle(
              fontSize: 11,
              height: 1.4,
              color: context.rhythm.textSecondary,
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
          color: context.rhythm.canvas.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: context.rhythm.borderSubtle),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    reservation.title,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: context.rhythm.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${facility?.name ?? 'Room #${reservation.facilityId}'} · ${parts.join(' · ')}',
                    style: TextStyle(
                      fontSize: 12,
                      color: context.rhythm.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right, color: context.rhythm.textSecondary),
          ],
        ),
      ),
    );
  }
}

class _OverviewDayGroup extends StatelessWidget {
  const _OverviewDayGroup({
    required this.title,
    required this.clusters,
    required this.facilities,
    required this.controller,
  });

  final String title;
  final List<_ReservationCluster> clusters;
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
        color: context.rhythm.surfaceRaised.withValues(alpha: 0.96),
        borderRadius: BorderRadius.circular(RhythmRadius.xl),
        border: Border.all(color: context.rhythm.borderSubtle),
        boxShadow: RhythmElevation.panel,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: context.rhythm.textPrimary,
            ),
          ),
          const SizedBox(height: 12),
          ...clusters.map(
            (cluster) => Padding(
              padding: const EdgeInsets.only(bottom: 14),
              child: _OverviewReservationClusterRow(
                cluster: cluster,
                controller: controller,
                facilitiesById: facilitiesById,
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
        background = context.rhythm.surfaceRaised.withValues(alpha: 0.6);
        border = context.rhythm.borderSubtle;
        foreground = context.rhythm.textSecondary;
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

class _OverviewReservationClusterRow extends StatelessWidget {
  const _OverviewReservationClusterRow({
    required this.cluster,
    required this.controller,
    required this.facilitiesById,
  });

  final _ReservationCluster cluster;
  final FacilitiesController controller;
  final Map<int, Facility> facilitiesById;

  @override
  Widget build(BuildContext context) {
    final start = cluster.start;
    final end = cluster.end;
    final representative = cluster.representative;
    final canManage = _canManageReservation(controller, representative);
    final series = cluster.hasRecurringSeries && !cluster.isMultiRoom
        ? _seriesForReservation(controller, representative)
        : null;
    final roomNames = cluster.roomNames(controller);
    final roomLabel = roomNames.join(', ');
    final buildingNames = cluster.reservations
        .map(
          (reservation) => facilitiesById[reservation.facilityId]?.building,
        )
        .whereType<String>()
        .where((building) => building.isNotEmpty)
        .toSet()
        .toList()
      ..sort();
    final facilityLabel = buildingNames.isEmpty
        ? roomLabel
        : '$roomLabel · ${buildingNames.join(', ')}';
    final conflictCount =
        cluster.reservations.where((item) => item.isConflicted).length;
    final noteCount = cluster.reservations
        .where((item) => item.notes?.trim().isNotEmpty == true)
        .length;

    return InkWell(
      onTap: () => _showReservationDetails(context, controller, representative),
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: context.rhythm.canvas.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: context.rhythm.borderSubtle),
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
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: context.rhythm.textPrimary,
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
                          cluster.title,
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: context.rhythm.textPrimary,
                          ),
                        ),
                      ),
                      if (cluster.isMultiRoom) ...[
                        const SizedBox(width: 8),
                        _InlineInfoPill(
                          label: '${cluster.reservations.length} rooms',
                        ),
                      ],
                      if (series != null) ...[
                        const SizedBox(width: 8),
                        _SeriesBadge(series: series),
                      ],
                      if (cluster.isPartiallyConflicted) ...[
                        const SizedBox(width: 8),
                        const _InlineInfoPill(
                          label: 'Partial conflict',
                          tone: _OverviewMetricTone.danger,
                        ),
                      ] else if (cluster.isConflicted) ...[
                        const SizedBox(width: 8),
                        const _InlineInfoPill(
                          label: 'Conflict',
                          tone: _OverviewMetricTone.danger,
                        ),
                      ],
                      if (!cluster.createdByRhythm) ...[
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
                    style: TextStyle(
                      fontSize: 12,
                      color: context.rhythm.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Requester: ${cluster.requesterName}',
                    style: TextStyle(
                      fontSize: 12,
                      color: context.rhythm.textSecondary,
                    ),
                  ),
                  if (cluster.createdByName != null &&
                      cluster.createdByName != cluster.requesterName)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        'Booked by ${cluster.createdByName}',
                        style: TextStyle(
                          fontSize: 12,
                          color: context.rhythm.textSecondary,
                        ),
                      ),
                    ),
                  if (cluster.notes != null && cluster.notes!.isNotEmpty)
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
                          cluster.notes!,
                          style: TextStyle(
                            fontSize: 12,
                            color: context.rhythm.textSecondary,
                          ),
                        ),
                      ),
                    ),
                  if (cluster.isMultiRoom || noteCount > 1 || conflictCount > 1)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        'Rooms: $roomLabel',
                        style: TextStyle(
                          fontSize: 12,
                          color: context.rhythm.textSecondary,
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
                if (cluster.isConflicted)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFDECEC),
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(color: const Color(0xFFF4C7C7)),
                    ),
                    child: Text(
                      cluster.isPartiallyConflicted ? 'Partial' : 'Conflict',
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
                          representative,
                        );
                        break;
                      case _OverviewAction.edit:
                        if (cluster.isMultiRoom) {
                          await _showEditReservationDialog(
                            context,
                            controller,
                            representative,
                            groupReservations: cluster.reservations,
                          );
                        } else if (series != null) {
                          await _showEditSeriesDialog(
                            context,
                            controller,
                            representative,
                            series,
                          );
                        } else {
                          await _showEditReservationDialog(
                            context,
                            controller,
                            representative,
                          );
                        }
                        break;
                      case _OverviewAction.delete:
                        if (cluster.isMultiRoom) {
                          await _deleteReservationWithConfirmation(
                            context,
                            controller,
                            representative,
                            groupReservations: cluster.reservations,
                          );
                        } else if (series != null) {
                          await _deleteSeriesWithConfirmation(
                            context,
                            controller,
                            representative,
                          );
                        } else {
                          await _deleteReservationWithConfirmation(
                            context,
                            controller,
                            representative,
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
                          cluster.isMultiRoom
                              ? 'Edit reservation group'
                              : series != null
                                  ? 'Edit series'
                                  : 'Edit reservation',
                        ),
                      ),
                    if (canManage)
                      PopupMenuItem(
                        value: _OverviewAction.delete,
                        child: Text(
                          cluster.isMultiRoom
                              ? 'Delete reservation group'
                              : series != null
                                  ? 'Delete series'
                                  : 'Delete reservation',
                        ),
                      ),
                  ],
                  child: Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color:
                          context.rhythm.surfaceRaised.withValues(alpha: 0.6),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: context.rhythm.borderSubtle),
                    ),
                    child: Icon(
                      Icons.more_horiz,
                      size: 18,
                      color: context.rhythm.textSecondary,
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
          color: context.rhythm.accentMuted,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: context.rhythm.accent.withValues(alpha: 0.16),
          ),
        ),
        child: Text(
          'Series',
          style: TextStyle(
            fontSize: 10,
            fontWeight: FontWeight.w700,
            color: context.rhythm.accent.withValues(alpha: 0.9),
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

    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 24),
      children: [
        if (controller.isFacilitiesManager) ...[
          _RoomsManagerBar(controller: controller),
          const SizedBox(height: 16),
        ],
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
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
      ],
    );
  }
}

class _RoomsManagerBar extends StatelessWidget {
  const _RoomsManagerBar({required this.controller});

  final FacilitiesController controller;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceRaised.withValues(alpha: 0.96),
        borderRadius: BorderRadius.circular(RhythmRadius.xl),
        border: Border.all(color: context.rhythm.borderSubtle),
        boxShadow: RhythmElevation.panel,
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Room management',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: context.rhythm.textPrimary,
                  ),
                ),
                SizedBox(height: 4),
                Text(
                  'Add, edit, or remove rooms used for Facilities reservations.',
                  style: TextStyle(
                      fontSize: 12, color: context.rhythm.textSecondary),
                ),
              ],
            ),
          ),
          const SizedBox(width: 16),
          OutlinedButton.icon(
            onPressed: () =>
                (context.findAncestorStateOfType<_FacilitiesViewState>())
                    ?._showCreateFacilityDialog(context, controller),
            icon: Icon(Icons.meeting_room_outlined, size: 18),
            label: Text('Add Space'),
          ),
        ],
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
        color: context.rhythm.surfaceRaised.withValues(alpha: 0.96),
        borderRadius: BorderRadius.circular(RhythmRadius.xl),
        border: Border.all(color: context.rhythm.borderSubtle),
        boxShadow: RhythmElevation.panel,
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
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: context.rhythm.textPrimary,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: 10),
                _ReservationBadge(count: reservations.length),
                if (controller.isFacilitiesManager) ...[
                  const SizedBox(width: 8),
                  PopupMenuButton<_FacilityAction>(
                    onSelected: (value) async {
                      final viewState = context
                          .findAncestorStateOfType<_FacilitiesViewState>();
                      if (viewState == null) return;
                      switch (value) {
                        case _FacilityAction.edit:
                          await viewState._showEditFacilityDialog(
                            context,
                            controller,
                            facility,
                          );
                          break;
                        case _FacilityAction.delete:
                          await viewState._deleteFacilityWithConfirmation(
                            context,
                            controller,
                            facility,
                          );
                          break;
                      }
                    },
                    itemBuilder: (context) => const [
                      PopupMenuItem(
                        value: _FacilityAction.edit,
                        child: Text('Edit space'),
                      ),
                      PopupMenuItem(
                        value: _FacilityAction.delete,
                        child: Text('Delete space'),
                      ),
                    ],
                    child: Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color:
                            context.rhythm.surfaceRaised.withValues(alpha: 0.6),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: context.rhythm.borderSubtle),
                      ),
                      child: Icon(
                        Icons.more_horiz,
                        size: 18,
                        color: context.rhythm.textSecondary,
                      ),
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 8),
            if (facility.description != null &&
                facility.description!.isNotEmpty) ...[
              Text(
                facility.description!,
                style: TextStyle(
                  fontSize: 13,
                  height: 1.4,
                  color: context.rhythm.textSecondary,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],
            if (facility.location != null && facility.location!.isNotEmpty) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  Icon(
                    Icons.location_on_outlined,
                    size: 14,
                    color: context.rhythm.textSecondary,
                  ),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      facility.location!,
                      style: TextStyle(
                        fontSize: 12,
                        color: context.rhythm.textSecondary,
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
                  Icon(
                    Icons.apartment_outlined,
                    size: 14,
                    color: context.rhythm.textSecondary,
                  ),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      facility.building!,
                      style: TextStyle(
                        fontSize: 12,
                        color: context.rhythm.textSecondary,
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
                  color: context.rhythm.surfaceMuted,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: context.rhythm.borderSubtle),
                ),
                child: Text(
                  'No upcoming reservations',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                      fontSize: 12, color: context.rhythm.textSecondary),
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
                      textStyle: TextStyle(fontSize: 13),
                    ),
                    child: Text('Reserve'),
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

enum _FacilityAction { edit, delete }

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
        color: context.rhythm.canvas.withValues(alpha: 0.7),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: context.rhythm.borderSubtle),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: context.rhythm.textSecondary),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: context.rhythm.textSecondary,
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
          color: context.rhythm.surfaceRaised.withValues(alpha: 0.96),
          borderRadius: BorderRadius.circular(RhythmRadius.xl),
          border: Border.all(color: context.rhythm.borderSubtle),
          boxShadow: RhythmElevation.panel,
        ),
        child: Row(
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
              style:
                  TextStyle(fontSize: 13, color: context.rhythm.textSecondary),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyFacilitiesState extends StatelessWidget {
  const _EmptyFacilitiesState({required this.title, required this.body});

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
            color: context.rhythm.surfaceRaised.withValues(alpha: 0.96),
            borderRadius: BorderRadius.circular(RhythmRadius.xl),
            border: Border.all(color: context.rhythm.borderSubtle),
            boxShadow: RhythmElevation.panel,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 56,
                height: 56,
                decoration: BoxDecoration(
                  color: context.rhythm.accentMuted,
                  borderRadius: BorderRadius.circular(18),
                ),
                child: Icon(
                  Icons.meeting_room_outlined,
                  color: context.rhythm.accent,
                ),
              ),
              const SizedBox(height: 16),
              Text(
                title,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color: context.rhythm.textPrimary,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                body,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 13,
                  height: 1.45,
                  color: context.rhythm.textSecondary,
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
        child: Text(
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
          color: context.rhythm.canvas.withValues(alpha: 0.55),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: context.rhythm.borderSubtle),
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
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: context.rhythm.textPrimary,
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
              style:
                  TextStyle(fontSize: 11, color: context.rhythm.textSecondary),
            ),
            if (reservation.createdByName != null &&
                reservation.createdByName != reservation.requesterName) ...[
              const SizedBox(height: 2),
              Text(
                'Booked by ${reservation.createdByName}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    fontSize: 11, color: context.rhythm.textSecondary),
              ),
            ],
            if (start != null) ...[
              const SizedBox(height: 2),
              Text(
                '${_formatDateShort(start)} · ${_formatTimeOnly(start)}${end != null ? ' - ${_formatTimeOnly(end)}' : ''}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    fontSize: 11, color: context.rhythm.textSecondary),
              ),
            ],
            if (reservation.notes != null && reservation.notes!.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                reservation.notes!,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    fontSize: 11, color: context.rhythm.textSecondary),
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
                  style: TextStyle(
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
    final cluster = _reservationClusterForReservation(
      widget.controller,
      reservation,
    );
    final canManage = _canManageReservation(widget.controller, reservation);
    final roomNames = cluster.roomNames(widget.controller);
    final isGroup = cluster.isMultiRoom;
    final hasRecurringSeries = cluster.hasRecurringSeries;

    return AlertDialog(
      title: Text(
        isGroup ? 'Reservation group details' : 'Reservation details',
      ),
      content: SizedBox(
        width: 480,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              reservation.title,
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Text(
              facility == null
                  ? 'Room #${reservation.facilityId}'
                  : '${facility.name}${facility.building?.isNotEmpty == true ? ' · ${facility.building}' : ''}',
              style:
                  TextStyle(fontSize: 13, color: context.rhythm.textSecondary),
            ),
            if (isGroup) ...[
              const SizedBox(height: 8),
              Text(
                'Rooms: ${roomNames.join(', ')}',
                style: TextStyle(
                    fontSize: 13, color: context.rhythm.textSecondary),
              ),
            ],
            const SizedBox(height: 8),
            if (start != null)
              Text(
                '${_formatDatePickerValue(start)} · ${_formatTimeOnly(start)}${end != null ? ' - ${_formatTimeOnly(end)}' : ''}',
                style: TextStyle(
                    fontSize: 13, color: context.rhythm.textSecondary),
              ),
            const SizedBox(height: 8),
            Text(
              'Requester: ${reservation.requesterName}',
              style:
                  TextStyle(fontSize: 13, color: context.rhythm.textSecondary),
            ),
            if (reservation.createdByName != null &&
                reservation.createdByName != reservation.requesterName)
              Text(
                'Booked by ${reservation.createdByName}',
                style: TextStyle(
                    fontSize: 13, color: context.rhythm.textSecondary),
              ),
            if (reservation.notes != null && reservation.notes!.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(
                reservation.notes!,
                style: TextStyle(
                    fontSize: 13, color: context.rhythm.textSecondary),
              ),
            ],
            const SizedBox(height: 12),
            if (isGroup)
              _GroupedReservationInfoPanel(
                controller: widget.controller,
                reservations: cluster.reservations,
              )
            else if (reservation.seriesId != null)
              _series == null && _loadingSeries
                  ? const LinearProgressIndicator(minHeight: 2)
                  : _series != null
                      ? _SeriesInfoPanel(series: _series!)
                      : Text(
                          'This reservation belongs to a recurring series.',
                          style: TextStyle(
                              fontSize: 13,
                              color: context.rhythm.textSecondary),
                        ),
          ],
        ),
      ),
      actions: [
        if (canManage)
          TextButton(
            onPressed: _editReservation,
            child: Text(
              isGroup
                  ? 'Edit reservation group'
                  : hasRecurringSeries
                      ? 'Edit entire series'
                      : 'Edit reservation',
            ),
          ),
        if (canManage)
          TextButton(
            onPressed: _deleteReservation,
            style: TextButton.styleFrom(
              foregroundColor: const Color(0xFFB42318),
            ),
            child: Text(
              isGroup
                  ? 'Delete reservation group'
                  : hasRecurringSeries
                      ? 'Delete entire series'
                      : 'Delete reservation',
            ),
          ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text('Close'),
        ),
      ],
    );
  }

  Future<void> _editReservation() async {
    final cluster = _reservationClusterForReservation(
      widget.controller,
      widget.reservation,
    );
    final facility = _facilityForReservation(
      widget.controller,
      widget.reservation,
    );
    if (facility == null) return;
    if (cluster.isMultiRoom) {
      final saved = await showDialog<bool>(
        context: context,
        builder: (_) => _ReservationDialog(
          controller: widget.controller,
          facilities: widget.controller.facilities,
          preselectedFacility: facility,
          existingReservation: widget.reservation,
          existingGroupReservations: cluster.reservations,
        ),
      );
      if (saved == true && mounted) {
        Navigator.of(context).pop();
      }
      return;
    }
    if (widget.reservation.seriesId != null) {
      final series = _series ??
          _seriesForReservation(widget.controller, widget.reservation);
      if (series == null) return;
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
      return;
    }
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
    final cluster = _reservationClusterForReservation(
      widget.controller,
      widget.reservation,
    );
    if (cluster.isMultiRoom) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text('Delete reservation group?'),
          content: Text(
            'This will remove the linked reservations from every selected room.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFFB42318),
              ),
              child: Text('Delete'),
            ),
          ],
        ),
      );
      if (confirmed != true) return;
      await _deleteReservationCluster(widget.controller, cluster.reservations);
      if (mounted) {
        Navigator.of(context).pop();
      }
      return;
    }
    if (widget.reservation.seriesId != null) {
      await _deleteEntireSeries();
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Delete reservation?'),
        content: Text(
          'This will remove this reservation from the room schedule.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFB42318),
            ),
            child: Text('Delete'),
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

  Future<void> _deleteEntireSeries() async {
    final cluster = _reservationClusterForReservation(
      widget.controller,
      widget.reservation,
    );
    if (cluster.isMultiRoom) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text('Delete reservation group?'),
          content: Text(
            'This will delete every linked room reservation in the group.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFFB42318),
              ),
              child: Text('Delete group'),
            ),
          ],
        ),
      );
      if (confirmed != true) return;
      await _deleteReservationCluster(widget.controller, cluster.reservations);
      if (mounted) {
        Navigator.of(context).pop();
      }
      return;
    }
    final seriesId = widget.reservation.seriesId;
    if (seriesId == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Delete recurring series?'),
        content: Text(
          'This will delete the entire recurring series and all generated reservations.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFB42318),
            ),
            child: Text('Delete series'),
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
        color: context.rhythm.canvas.withValues(alpha: 0.45),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: context.rhythm.borderSubtle),
      ),
      child: Text(
        'Recurring series: ${series.title} · ${series.recurrenceType}',
        style: TextStyle(fontSize: 12, color: context.rhythm.textSecondary),
      ),
    );
  }
}

class _GroupedReservationInfoPanel extends StatelessWidget {
  const _GroupedReservationInfoPanel({
    required this.controller,
    required this.reservations,
  });

  final FacilitiesController controller;
  final List<Reservation> reservations;

  @override
  Widget build(BuildContext context) {
    final roomNames = _roomNamesForReservations(controller, reservations);
    final conflicts =
        reservations.where((reservation) => reservation.isConflicted).length;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: context.rhythm.canvas.withValues(alpha: 0.45),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: context.rhythm.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Grouped reservation',
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 4),
          Text(
            'Rooms: ${roomNames.join(', ')}',
            style: TextStyle(fontSize: 12, color: context.rhythm.textSecondary),
          ),
          if (conflicts > 0) ...[
            const SizedBox(height: 4),
            Text(
              conflicts == reservations.length
                  ? 'All grouped rooms are flagged with conflicts.'
                  : 'Some grouped rooms are flagged with conflicts.',
              style:
                  TextStyle(fontSize: 12, color: context.rhythm.textSecondary),
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
    this.existingReservation,
    this.existingGroupReservations,
    this.existingSeries,
    this.isEditingSeries = false,
  });

  final FacilitiesController controller;
  final List<Facility> facilities;
  final Facility? preselectedFacility;
  final Reservation? existingReservation;
  final List<Reservation>? existingGroupReservations;
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

  final Set<int> _selectedFacilityIds = {};
  DateTime? _selectedDate;
  TimeOfDay? _selectedStartTime;
  TimeOfDay? _selectedEndTime;
  bool _isRecurring = false;
  _RecurrenceType _recurrenceType = _RecurrenceType.weekly;
  DateTime? _recurrenceEndDate;
  final List<DateTime> _customRecurrenceDates = [];
  bool _saving = false;

  bool get _isEditingSingleReservation =>
      widget.existingReservation != null &&
      !widget.isEditingSeries &&
      (widget.existingGroupReservations?.length ?? 0) <= 1;

  bool get _isMultiRoomMode =>
      _selectedFacilityIds.length > 1 ||
      (widget.existingGroupReservations?.length ?? 0) > 1;

  List<Facility> get _selectedFacilities {
    if (_selectedFacilityIds.isEmpty) return const [];
    final facilities = widget.facilities
        .where((facility) => _selectedFacilityIds.contains(facility.id))
        .toList()
      ..sort(
        (a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()),
      );
    return facilities;
  }

  List<Reservation> get _selectedFacilityReservations {
    if (_selectedFacilityIds.isEmpty) return const [];
    final reservations = <Reservation>[];
    for (final facilityId in _selectedFacilityIds) {
      reservations.addAll(
        widget.controller.reservationsByFacility[facilityId] ?? const [],
      );
    }
    return reservations;
  }

  List<Reservation> get _reservationsForSelectedDate {
    final selectedDate = _selectedDate;
    if (selectedDate == null) return const [];
    final reservationId = widget.existingReservation?.id;
    final groupIds = widget.existingGroupReservations
            ?.map((reservation) => reservation.id)
            .toSet() ??
        const <int>{};
    final sameDay = _selectedFacilityReservations.where((reservation) {
      if (reservationId != null && reservation.id == reservationId) {
        return false;
      }
      if (groupIds.contains(reservation.id)) {
        return false;
      }
      final start = _parseReservationDateTime(reservation.startTime);
      return start != null &&
          start.year == selectedDate.year &&
          start.month == selectedDate.month &&
          start.day == selectedDate.day;
    }).toList()
      ..sort(_compareReservationStartTimes);
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
    final existingGroupReservations = widget.existingGroupReservations;
    if (existingGroupReservations != null &&
        existingGroupReservations.isNotEmpty) {
      _selectedFacilityIds.addAll(
        existingGroupReservations.map((reservation) => reservation.facilityId),
      );
    } else if (widget.preselectedFacility != null) {
      _selectedFacilityIds.add(widget.preselectedFacility!.id);
    } else if (widget.facilities.isNotEmpty) {
      _selectedFacilityIds.add(widget.facilities.first.id);
    }
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
    if (widget.existingGroupReservations != null &&
        widget.existingGroupReservations!.any(
          (reservation) => reservation.seriesId != null,
        )) {
      _isRecurring = true;
      final seriesReservation = widget.existingGroupReservations!.firstWhere(
        (reservation) => reservation.seriesId != null,
      );
      final cachedSeries = _seriesForReservation(
        widget.controller,
        seriesReservation,
      );
      if (cachedSeries != null) {
        _recurrenceType = _recurrenceTypeFromApiValue(
          cachedSeries.recurrenceType,
        );
        _recurrenceEndDate = cachedSeries.endDate == null
            ? null
            : DateTime.tryParse(cachedSeries.endDate!);
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
    final selectedRoomCount = _selectedFacilityIds.length;
    final existingGroupCount = widget.existingGroupReservations?.length ?? 0;
    final chipLabel = widget.isEditingSeries
        ? 'Edit series'
        : _isEditingSingleReservation
            ? 'Edit booking'
            : (existingGroupCount > 1 || selectedRoomCount > 1)
                ? '${selectedRoomCount > 1 ? selectedRoomCount : existingGroupCount} rooms'
                : isTopLevel
                    ? 'New booking'
                    : widget.preselectedFacility!.name;

    return Dialog(
      insetPadding: const EdgeInsets.all(24),
      backgroundColor: Colors.transparent,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 560),
        decoration: BoxDecoration(
          color: context.rhythm.surfaceRaised,
          borderRadius: BorderRadius.circular(RhythmRadius.xl),
          border: Border.all(color: context.rhythm.borderSubtle),
          boxShadow: RhythmElevation.panel,
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
                            Text(
                              'Reserve space',
                              style: TextStyle(
                                fontSize: 22,
                                fontWeight: FontWeight.w700,
                                color: context.rhythm.textPrimary,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              isTopLevel
                                  ? 'Choose one or more rooms and capture the booking details in one pass.'
                                  : _selectedFacilityIds.length > 1
                                      ? 'Capture the booking details for ${_selectedFacilityIds.length} selected rooms.'
                                      : 'Capture the booking details for ${widget.preselectedFacility!.name}.',
                              style: TextStyle(
                                fontSize: 13,
                                height: 1.45,
                                color: context.rhythm.textSecondary,
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
                          color: context.rhythm.canvas.withValues(alpha: 0.7),
                          borderRadius: BorderRadius.circular(999),
                          border:
                              Border.all(color: context.rhythm.borderSubtle),
                        ),
                        child: Text(
                          chipLabel,
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: context.rhythm.textSecondary,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  _RoomSelectionSection(
                    facilities: widget.facilities,
                    selectedFacilityIds: _selectedFacilityIds,
                    enabled: widget.existingReservation == null ||
                        ((widget.existingGroupReservations?.length ?? 0) > 1),
                    onChanged: (ids) => setState(() {
                      _selectedFacilityIds
                        ..clear()
                        ..addAll(ids);
                    }),
                  ),
                  const SizedBox(height: 14),
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
                  if (_selectedFacilities.isNotEmpty)
                    FacilitiesAvailabilityPanel(
                      controller: widget.controller,
                      selectedFacilities: _selectedFacilities,
                      selectedDate: _selectedDate,
                      selectedStartTime: _selectedStartTime,
                      selectedEndTime: _selectedEndTime,
                      showRecurringHint:
                          (_isRecurring || widget.isEditingSeries) &&
                              !_isEditingSingleReservation,
                    ),
                  if (_selectedFacilities.isNotEmpty)
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
                  if (!widget.isEditingSeries && !_isEditingSingleReservation)
                    SwitchListTile.adaptive(
                      value: _isRecurring,
                      contentPadding: EdgeInsets.zero,
                      title: Text(
                        'Recurring reservation',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: context.rhythm.textPrimary,
                        ),
                      ),
                      subtitle: Text(
                        'Create a weekly, bi-weekly, monthly, or custom-date series.',
                        style: TextStyle(
                            fontSize: 12, color: context.rhythm.textSecondary),
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
                            avatar: Icon(Icons.add, size: 16),
                            label: Text('Add date'),
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
                        child: Text('Cancel'),
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
    final selectedFacilities = _selectedFacilities;
    if (selectedFacilities.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Select at least one room.')),
      );
      return;
    }
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
        const SnackBar(content: Text('End time must be after the start time.')),
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
      final existingReservations = <Reservation>[
        if (widget.existingReservation != null) widget.existingReservation!,
        if (widget.existingGroupReservations != null)
          ...widget.existingGroupReservations!.where(
            (reservation) =>
                widget.existingReservation == null ||
                reservation.id != widget.existingReservation!.id,
          ),
      ];
      final existingReservationsByFacility = {
        for (final reservation in existingReservations)
          reservation.facilityId: reservation,
      };
      final isRecurring = (_isRecurring ||
              widget.isEditingSeries ||
              existingReservations.any(
                (reservation) => reservation.seriesId != null,
              )) &&
          !_isEditingSingleReservation;
      final isCustomSeries = _recurrenceType == _RecurrenceType.custom;
      final seriesEndDate = isCustomSeries
          ? _dateOnly(_effectiveCustomDates.last)
          : _recurrenceEndDate != null
              ? _dateOnly(_recurrenceEndDate!)
              : null;
      final notes = _notesController.text.trim();
      if (_overlappingReservations.isNotEmpty &&
          !isRecurring &&
          !_isMultiRoomMode) {
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
      final selectedFacilityIds = selectedFacilities.map((f) => f.id).toSet();
      final createdRooms = <String>[];
      final updatedRooms = <String>[];
      final removedRooms = <String>[];
      final conflictMessages = <String>[];

      if (_isMultiRoomMode || existingReservations.length > 1) {
        final selectedIds =
            selectedFacilities.map((facility) => facility.id).toList();
        final existingIds = existingReservationsByFacility.keys.toSet();
        if (isRecurring) {
          final recurringResult =
              widget.isEditingSeries && widget.existingSeries != null
                  ? await widget.controller.updateReservationSeries(
                      selectedFacilities.first.id,
                      widget.existingSeries!.id,
                      title: _titleController.text.trim(),
                      requesterName: trimmedRequester,
                      requesterUserId: requesterUserId,
                      facilityIds: selectedIds,
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
                    )
                  : await widget.controller.createReservationSeries(
                      selectedFacilities.first.id,
                      title: _titleController.text.trim(),
                      requesterName: trimmedRequester,
                      requesterUserId: requesterUserId,
                      facilityIds: selectedIds,
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
            navigator.pop(widget.isEditingSeries ? true : null);
            await showDialog<void>(
              context: navigator.context,
              builder: (_) => _RecurringSummaryDialog(result: recurringResult),
            );
          }
          return;
        }

        final mutationResult = existingReservations.isNotEmpty
            ? await widget.controller.updateReservation(
                selectedFacilities.first.id,
                widget.existingReservation!.id,
                title: _titleController.text.trim(),
                requesterName: trimmedRequester,
                requesterUserId: requesterUserId,
                facilityIds: selectedIds,
                startTime: startAt.toIso8601String(),
                endTime: endAt.toIso8601String(),
                notes: notes,
              )
            : await widget.controller.createReservation(
                selectedFacilities.first.id,
                title: _titleController.text.trim(),
                requesterName: trimmedRequester,
                requesterUserId: requesterUserId,
                facilityIds: selectedIds,
                startTime: startAt.toIso8601String(),
                endTime: endAt.toIso8601String(),
                notes: notes,
              );

        final resultIds = mutationResult.reservations
            .map((reservation) => reservation.facilityId)
            .toSet();
        for (final facility in selectedFacilities) {
          if (!resultIds.contains(facility.id)) continue;
          if (existingIds.contains(facility.id)) {
            updatedRooms.add(facility.name);
          } else {
            createdRooms.add(facility.name);
          }
        }
        for (final existing in existingReservations) {
          if (!selectedFacilityIds.contains(existing.facilityId)) {
            removedRooms.add(
              widget.facilities
                  .firstWhere(
                    (facility) => facility.id == existing.facilityId,
                    orElse: () => Facility(
                      id: existing.facilityId,
                      name: 'Room #${existing.facilityId}',
                    ),
                  )
                  .name,
            );
          }
        }
        conflictMessages.addAll(
          mutationResult.conflicts.map(
            (conflict) =>
                '${conflict.facilityName ?? 'Room #${conflict.facilityId ?? '?'}'}: ${conflict.reason}',
          ),
        );

        if (mounted) {
          navigator.pop(existingReservations.isNotEmpty ? true : null);
          await showDialog<void>(
            context: navigator.context,
            builder: (_) => _GroupedReservationSummaryDialog(
              title: 'Reservation group saved',
              createdRooms: createdRooms,
              updatedRooms: updatedRooms,
              removedRooms: removedRooms,
              conflictMessages: conflictMessages,
            ),
          );
        }
        return;
      }

      if (_isEditingSingleReservation) {
        await widget.controller.updateReservation(
          selectedFacilities.first.id,
          widget.existingReservation!.id,
          title: _titleController.text.trim(),
          requesterName: trimmedRequester,
          requesterUserId: requesterUserId,
          startTime: startAt.toIso8601String(),
          endTime: endAt.toIso8601String(),
          notes: notes,
        );
      } else if (widget.isEditingSeries) {
        final recurringResult = await widget.controller.updateReservationSeries(
          selectedFacilities.first.id,
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
        if (mounted) {
          navigator.pop(true);
          await showDialog<void>(
            context: navigator.context,
            builder: (_) => _RecurringSummaryDialog(result: recurringResult),
          );
        }
        return;
      } else if (isRecurring) {
        final recurringResult = await widget.controller.createReservationSeries(
          selectedFacilities.first.id,
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
          selectedFacilities.first.id,
          title: _titleController.text.trim(),
          requesterName: trimmedRequester,
          requesterUserId: requesterUserId,
          startTime: startAt.toIso8601String(),
          endTime: endAt.toIso8601String(),
          notes: notes,
        );
      }
      if (mounted) {
        navigator.pop(
          widget.isEditingSeries || _isEditingSingleReservation ? true : null,
        );
        if (!widget.isEditingSeries && !_isEditingSingleReservation) {
          ScaffoldMessenger.of(
            navigator.context,
          ).showSnackBar(const SnackBar(content: Text('Reservation created')));
        } else if (_isEditingSingleReservation) {
          ScaffoldMessenger.of(
            navigator.context,
          ).showSnackBar(const SnackBar(content: Text('Reservation updated')));
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Error: $e')));
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
          content: Text('Choose the first reservation date first.'),
        ),
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
          content: Text('Choose the first reservation date first.'),
        ),
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
      initialEntryMode: TimePickerEntryMode.input,
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
      initialEntryMode: TimePickerEntryMode.input,
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
      fillColor: context.rhythm.canvas.withValues(alpha: 0.45),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(color: context.rhythm.borderSubtle),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(color: context.rhythm.borderSubtle),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(color: primary),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
    );
  }
}

class _RoomSelectionSection extends StatelessWidget {
  const _RoomSelectionSection({
    required this.facilities,
    required this.selectedFacilityIds,
    required this.onChanged,
    this.enabled = true,
  });

  final List<Facility> facilities;
  final Set<int> selectedFacilityIds;
  final ValueChanged<Set<int>> onChanged;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    if (facilities.isEmpty) {
      return Text(
        'No rooms are available yet.',
        style: TextStyle(fontSize: 12, color: context.rhythm.textSecondary),
      );
    }

    final grouped = <String, List<Facility>>{};
    for (final facility in facilities) {
      final building = facility.building?.trim();
      final key = (building == null || building.isEmpty)
          ? 'Unassigned building'
          : building;
      grouped.putIfAbsent(key, () => []).add(facility);
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: context.rhythm.canvas.withValues(alpha: 0.45),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: context.rhythm.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Rooms *',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: context.rhythm.textPrimary,
                  ),
                ),
              ),
              Text(
                '${selectedFacilityIds.length} selected',
                style: TextStyle(
                    fontSize: 12, color: context.rhythm.textSecondary),
              ),
              const SizedBox(width: 8),
              TextButton(
                onPressed: enabled
                    ? () => onChanged(facilities.map((f) => f.id).toSet())
                    : null,
                child: Text('Select all'),
              ),
              TextButton(
                onPressed: enabled ? () => onChanged(<int>{}) : null,
                child: Text('Clear'),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Check one room for a normal booking or several rooms for a linked reservation group.',
            style: TextStyle(fontSize: 12, color: context.rhythm.textSecondary),
          ),
          const SizedBox(height: 12),
          ...grouped.entries.map(
            (entry) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: ExpansionTile(
                initiallyExpanded: grouped.length == 1,
                tilePadding: EdgeInsets.zero,
                childrenPadding: const EdgeInsets.only(left: 6, top: 4),
                title: Text(
                  entry.key,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: context.rhythm.textPrimary,
                  ),
                ),
                subtitle: Text(
                  '${entry.value.length} ${entry.value.length == 1 ? 'room' : 'rooms'}',
                  style: TextStyle(
                      fontSize: 11, color: context.rhythm.textSecondary),
                ),
                children: [
                  ...entry.value.map(
                    (facility) => CheckboxListTile(
                      value: selectedFacilityIds.contains(facility.id),
                      onChanged: enabled
                          ? (checked) {
                              final next = Set<int>.from(selectedFacilityIds);
                              if (checked == true) {
                                next.add(facility.id);
                              } else {
                                next.remove(facility.id);
                              }
                              onChanged(next);
                            }
                          : null,
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      controlAffinity: ListTileControlAffinity.leading,
                      title: Text(
                        facility.name,
                        style: TextStyle(
                          fontSize: 12,
                          color: context.rhythm.textPrimary,
                        ),
                      ),
                      subtitle: Text(
                        facility.description?.isNotEmpty == true
                            ? facility.description!
                            : 'Add this room to the reservation group',
                        style: TextStyle(
                          fontSize: 11,
                          color: context.rhythm.textSecondary,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class FacilitiesAvailabilityPanel extends StatelessWidget {
  const FacilitiesAvailabilityPanel({
    super.key,
    required this.controller,
    required this.selectedFacilities,
    required this.selectedDate,
    required this.selectedStartTime,
    required this.selectedEndTime,
    required this.showRecurringHint,
  });

  final FacilitiesController controller;
  final List<Facility> selectedFacilities;
  final DateTime? selectedDate;
  final TimeOfDay? selectedStartTime;
  final TimeOfDay? selectedEndTime;
  final bool showRecurringHint;

  @override
  Widget build(BuildContext context) {
    final hasSelectedSlot = selectedDate != null &&
        selectedStartTime != null &&
        selectedEndTime != null;
    final roomStatuses = selectedFacilities
        .map(
          (facility) => _RoomAvailabilityStatus(
            facility: facility,
            dayReservations: _dayReservationsForFacility(facility),
            conflictingReservations: _conflictingReservationsForFacility(
              facility,
            ),
          ),
        )
        .toList();
    final hasConflict = roomStatuses.any(
      (status) => status.conflictingReservations.isNotEmpty,
    );
    final conflictCount = roomStatuses.fold<int>(
      0,
      (sum, status) => sum + status.conflictingReservations.length,
    );
    final selectedRoomCount = selectedFacilities.length;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: context.rhythm.canvas.withValues(alpha: 0.45),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: hasConflict
              ? const Color(0xFFF4C7C7)
              : context.rhythm.borderSubtle,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            selectedRoomCount == 1
                ? 'Availability for ${selectedFacilities.first.name}'
                : 'Availability for $selectedRoomCount selected rooms',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: context.rhythm.textPrimary,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            selectedDate == null
                ? 'Choose a date to see the room schedule.'
                : selectedRoomCount == 1
                    ? '${_formatDatePickerValue(selectedDate!)} · ${roomStatuses.first.dayReservations.length} existing ${roomStatuses.first.dayReservations.length == 1 ? 'reservation' : 'reservations'}'
                    : '${_formatDatePickerValue(selectedDate!)} · $selectedRoomCount rooms selected',
            style: TextStyle(fontSize: 12, color: context.rhythm.textSecondary),
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
                    ? 'Selected time overlaps $conflictCount existing ${conflictCount == 1 ? 'reservation' : 'reservations'}.'
                    : selectedRoomCount == 1
                        ? 'Selected time is open for this room based on current reservations.'
                        : 'Selected time is open for the selected rooms based on current reservations.',
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
            Text(
              'Recurring conflicts are checked across the full series when you save. This preview only covers the selected date.',
              style:
                  TextStyle(fontSize: 12, color: context.rhythm.textSecondary),
            ),
          ],
          if (roomStatuses.isNotEmpty) ...[
            const SizedBox(height: 12),
            ...roomStatuses.map(
              (status) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: _RoomAvailabilitySummary(status: status),
              ),
            ),
          ],
        ],
      ),
    );
  }

  List<Reservation> _dayReservationsForFacility(Facility facility) {
    final dateFilter = selectedDate;
    if (dateFilter == null) return const [];
    final reservations =
        controller.reservationsByFacility[facility.id] ?? const [];
    return reservations.where((reservation) {
      final start = _parseReservationDateTime(reservation.startTime);
      return start != null &&
          start.year == dateFilter.year &&
          start.month == dateFilter.month &&
          start.day == dateFilter.day;
    }).toList()
      ..sort(_compareReservationStartTimes);
  }

  List<Reservation> _conflictingReservationsForFacility(Facility facility) {
    final selectedDate = this.selectedDate;
    final selectedStartTime = this.selectedStartTime;
    final selectedEndTime = this.selectedEndTime;
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
    if (!selectedEnd.isAfter(selectedStart)) return const [];
    return _dayReservationsForFacility(facility).where((reservation) {
      final start = _parseReservationDateTime(reservation.startTime);
      final end = _parseReservationDateTime(reservation.endTime);
      if (start == null || end == null) return false;
      return start.isBefore(selectedEnd) && end.isAfter(selectedStart);
    }).toList();
  }
}

class _RoomAvailabilityStatus {
  const _RoomAvailabilityStatus({
    required this.facility,
    required this.dayReservations,
    required this.conflictingReservations,
  });

  final Facility facility;
  final List<Reservation> dayReservations;
  final List<Reservation> conflictingReservations;
}

class _RoomAvailabilitySummary extends StatelessWidget {
  const _RoomAvailabilitySummary({required this.status});

  final _RoomAvailabilityStatus status;

  @override
  Widget build(BuildContext context) {
    final facility = status.facility;
    final reservations = status.dayReservations;
    final conflicts = status.conflictingReservations;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceRaised.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: conflicts.isNotEmpty
              ? const Color(0xFFF4C7C7)
              : context.rhythm.borderSubtle,
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.meeting_room_outlined,
            size: 16,
            color: context.rhythm.textSecondary,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  facility.name,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: context.rhythm.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  facility.building?.isNotEmpty == true
                      ? facility.building!
                      : reservations.isEmpty
                          ? 'No reservations on this date'
                          : '${reservations.length} reservation${reservations.length == 1 ? '' : 's'} on this date',
                  style: TextStyle(
                      fontSize: 11, color: context.rhythm.textSecondary),
                ),
                if (reservations.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  ...reservations.map(
                    (reservation) => Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: _AvailabilityReservationRow(
                        reservation: reservation,
                        isConflicting: conflicts.any(
                          (item) => item.id == reservation.id,
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (conflicts.isNotEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: const Color(0xFFFDECEC),
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: const Color(0xFFF4C7C7)),
              ),
              child: Text(
                conflicts.length == reservations.length
                    ? 'Conflict'
                    : 'Partial',
                style: TextStyle(
                  fontSize: 10,
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
            : context.rhythm.surfaceRaised.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isConflicting
              ? const Color(0xFFF4C7C7)
              : context.rhythm.borderSubtle,
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
                color: isConflicting
                    ? const Color(0xFFB42318)
                    : context.rhythm.textPrimary,
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
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: context.rhythm.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  reservation.requesterName,
                  style: TextStyle(
                      fontSize: 11, color: context.rhythm.textSecondary),
                ),
              ],
            ),
          ),
          if (isConflicting)
            Text(
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
