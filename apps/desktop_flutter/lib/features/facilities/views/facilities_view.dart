import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/auth/auth_session_service.dart';
import '../../../app/core/widgets/error_banner.dart';
import '../controllers/facilities_controller.dart';
import '../models/facility.dart';
import '../models/reservation.dart';

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
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _FacilitiesHeader(
              onReserve: () => _showReserveDialog(context, controller),
            ),
            if (controller.status == FacilitiesStatus.error &&
                controller.errorMessage != null)
              ErrorBanner(
                message: controller.errorMessage!,
                onRetry: controller.loadFacilities,
              ),
            Expanded(child: _FacilitiesGrid(controller: controller)),
          ],
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

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

class _FacilitiesHeader extends StatelessWidget {
  const _FacilitiesHeader({required this.onReserve});

  final VoidCallback onReserve;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
      child: Row(
        children: [
          Text('Facilities', style: Theme.of(context).textTheme.headlineSmall),
          const Spacer(),
          FilledButton.icon(
            onPressed: onReserve,
            icon: const Icon(Icons.add, size: 18),
            label: const Text('Reserve Space'),
          ),
        ],
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
      return const Center(child: CircularProgressIndicator());
    }

    if (controller.facilities.isEmpty) {
      return const Center(
        child: Text('No facilities yet.'),
      );
    }

    return Padding(
      padding: const EdgeInsets.all(24),
      child: GridView.builder(
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 3,
          crossAxisSpacing: 16,
          mainAxisSpacing: 16,
          childAspectRatio: 1.4,
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
    const cardBorder = Color(0xFFE5E7EB);
    const textPrimary = Color(0xFF111827);
    const textMuted = Color(0xFF9CA3AF);
    final upcomingReservations = reservations.where(_isUpcoming).take(1).toList();

    return Card(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: cardBorder),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Name
            Text(
              facility.name,
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w600,
                color: textPrimary,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),

            // Description
            if (facility.description != null &&
                facility.description!.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                facility.description!,
                style: const TextStyle(fontSize: 13, color: textMuted),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],

            if (facility.location != null && facility.location!.isNotEmpty) ...[
              const SizedBox(height: 4),
              Row(
                children: [
                  const Icon(Icons.location_on_outlined,
                      size: 13, color: textMuted),
                  const SizedBox(width: 3),
                  Expanded(
                    child: Text(
                      facility.location!,
                      style: const TextStyle(fontSize: 12, color: textMuted),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ],

            const SizedBox(height: 14),
            if (upcomingReservations.isEmpty)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(
                  color: const Color(0xFFF9FAFB),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Text(
                  'No upcoming reservations',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 12, color: textMuted),
                ),
              )
            else
              _UpcomingReservationRow(
                reservation: upcomingReservations.first,
              ),

            const Spacer(),

            // Reservation count badge + Reserve button
            Row(
              children: [
                _ReservationBadge(
                  count: reservations.length,
                  onTap: reservations.isEmpty
                      ? null
                      : () => _showReservationsDialog(context),
                ),
                const Spacer(),
                OutlinedButton(
                  onPressed: () => _showReserveDialog(context),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: cs.primary,
                    side: BorderSide(color: cs.primary),
                    padding:
                        const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                    textStyle: const TextStyle(fontSize: 13),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  child: const Text('Reserve'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
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

  Future<void> _showReservationsDialog(BuildContext context) async {
    await showDialog<void>(
      context: context,
      builder: (_) => _ReservationListDialog(
        facility: facility,
        controller: controller,
      ),
    );
  }

  bool _isUpcoming(Reservation reservation) {
    final start = _parseReservationDateTime(reservation.startTime);
    if (start == null) return false;
    return !start.isBefore(DateTime.now());
  }
}

// ---------------------------------------------------------------------------
// Reservation count badge
// ---------------------------------------------------------------------------

class _ReservationBadge extends StatelessWidget {
  const _ReservationBadge({required this.count, this.onTap});

  final int count;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    if (count == 0) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: const Color(0xFFDCFCE7),
          borderRadius: BorderRadius.circular(12),
        ),
        child: const Text(
          'Available',
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w500,
            color: Color(0xFF16A34A),
          ),
        ),
      );
    }

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: cs.primary.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(
          '$count ${count == 1 ? 'reservation' : 'reservations'}',
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w500,
            color: cs.primary,
          ),
        ),
      ),
    );
  }
}

class _UpcomingReservationRow extends StatelessWidget {
  const _UpcomingReservationRow({required this.reservation});

  final Reservation reservation;

  @override
  Widget build(BuildContext context) {
    final start = _parseReservationDateTime(reservation.startTime);
    final end = _parseReservationDateTime(reservation.endTime);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFFF9FAFB),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 4,
            height: 30,
            decoration: BoxDecoration(
              color: const Color(0xFF4F6AF5),
              borderRadius: BorderRadius.circular(999),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  reservation.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: Color(0xFF111827),
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  start != null
                      ? '${_formatDateShort(start)} · ${_formatTimeOnly(start)}${end != null ? ' - ${_formatTimeOnly(end)}' : ''}'
                      : reservation.reservedBy,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style:
                      const TextStyle(fontSize: 10, color: Color(0xFF6B7280)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ReservationListDialog extends StatelessWidget {
  const _ReservationListDialog({
    required this.facility,
    required this.controller,
  });

  final Facility facility;
  final FacilitiesController controller;

  @override
  Widget build(BuildContext context) {
    return Consumer<FacilitiesController>(
      builder: (context, liveController, _) {
        final sorted = [
          ...(liveController.reservationsByFacility[facility.id] ?? const [])
        ]..sort((a, b) => (a.startTime ?? '').compareTo(b.startTime ?? ''));
        return AlertDialog(
          title: Text('${facility.name} Reservations'),
          content: SizedBox(
            width: 620,
            child: sorted.isEmpty
                ? const Padding(
                    padding: EdgeInsets.symmetric(vertical: 24),
                    child: Text('No reservations yet.'),
                  )
                : ListView.separated(
                    shrinkWrap: true,
                    itemCount: sorted.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final reservation = sorted[index];
                      final start =
                          _parseReservationDateTime(reservation.startTime);
                      final end =
                          _parseReservationDateTime(reservation.endTime);
                      return ListTile(
                        contentPadding: const EdgeInsets.symmetric(vertical: 6),
                        title: Text(reservation.title),
                        subtitle: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Reserved by ${reservation.reservedBy}'),
                            if (start != null)
                              Text(
                                '${_formatDateShort(start)} · ${_formatTimeOnly(start)}${end != null ? ' - ${_formatTimeOnly(end)}' : ''}',
                              ),
                            if ((reservation.notes ?? '').isNotEmpty)
                              Text(reservation.notes!),
                          ],
                        ),
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            TextButton(
                              onPressed: () async {
                                await showDialog<void>(
                                  context: context,
                                  builder: (_) => _ReservationDialog(
                                    controller: liveController,
                                    facilities: liveController.facilities,
                                    preselectedFacility: facility,
                                    initialReservation: reservation,
                                  ),
                                );
                              },
                              child: const Text('Edit'),
                            ),
                            TextButton(
                              onPressed: () async {
                                final confirmed =
                                    await _confirmDeleteReservation(
                                  context,
                                  reservation.title,
                                );
                                if (confirmed != true) return;
                                await liveController.deleteReservation(
                                  facility.id,
                                  reservation.id,
                                );
                                if (context.mounted) {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(
                                      content: Text('Reservation deleted'),
                                    ),
                                  );
                                }
                              },
                              child: const Text('Delete'),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Close'),
            ),
          ],
        );
      },
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
    this.initialReservation,
  });

  final FacilitiesController controller;
  final List<Facility> facilities;
  final Facility? preselectedFacility;
  final Reservation? initialReservation;

  @override
  State<_ReservationDialog> createState() => _ReservationDialogState();
}

class _ReservationDialogState extends State<_ReservationDialog> {
  static const _addRoomValue = '__add_room__';
  final _formKey = GlobalKey<FormState>();
  final _titleController = TextEditingController();
  final _reservedByController = TextEditingController();
  final _newRoomController = TextEditingController();
  final _notesController = TextEditingController();

  Facility? _selectedFacility;
  DateTime? _startDate;
  TimeOfDay? _startClock;
  DateTime? _endDate;
  TimeOfDay? _endClock;
  bool _saving = false;
  bool _addingRoom = false;

  @override
  void initState() {
    super.initState();
    final currentUser = AuthSessionService.instance.currentUser;
    _reservedByController.text =
        widget.initialReservation?.reservedBy ?? currentUser?.name ?? '';
    _titleController.text = widget.initialReservation?.title ?? '';
    _notesController.text = widget.initialReservation?.notes ?? '';
    _selectedFacility = widget.preselectedFacility ??
        (widget.facilities.isNotEmpty ? widget.facilities.first : null);
    _startDate =
        _parseReservationDateTime(widget.initialReservation?.startTime);
    _endDate = _parseReservationDateTime(widget.initialReservation?.endTime);
    _startClock = _startDate == null
        ? null
        : TimeOfDay(hour: _startDate!.hour, minute: _startDate!.minute);
    _endClock = _endDate == null
        ? null
        : TimeOfDay(hour: _endDate!.hour, minute: _endDate!.minute);
  }

  @override
  void dispose() {
    _titleController.dispose();
    _reservedByController.dispose();
    _newRoomController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(
        widget.initialReservation == null
            ? 'Reserve Space'
            : 'Edit Reservation',
      ),
      content: SizedBox(
        width: 520,
        child: Form(
          key: _formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              DropdownButtonFormField<String>(
                value: _addingRoom
                    ? _addRoomValue
                    : _selectedFacility != null
                        ? '${_selectedFacility!.id}'
                        : null,
                decoration: const InputDecoration(
                  labelText: 'Facility Room *',
                  border: OutlineInputBorder(),
                ),
                items: [
                  ...widget.facilities.map(
                    (f) => DropdownMenuItem<String>(
                      value: '${f.id}',
                      child: Text(f.name),
                    ),
                  ),
                  const DropdownMenuItem<String>(
                    value: _addRoomValue,
                    child: Text('Add a Room'),
                  ),
                ],
                onChanged: (value) {
                  setState(() {
                    _addingRoom = value == _addRoomValue;
                    if (_addingRoom) {
                      _selectedFacility = null;
                    } else {
                      _selectedFacility = widget.facilities.firstWhere(
                        (facility) => '${facility.id}' == value,
                      );
                    }
                  });
                },
                validator: (value) {
                  if (_addingRoom) {
                    return null;
                  }
                  return value == null ? 'Please select a room' : null;
                },
              ),
              if (_addingRoom) ...[
                const SizedBox(height: 16),
                TextFormField(
                  controller: _newRoomController,
                  decoration: const InputDecoration(
                    labelText: 'New Room Name *',
                    border: OutlineInputBorder(),
                  ),
                  validator: (value) =>
                      _addingRoom && (value == null || value.trim().isEmpty)
                          ? 'Room name is required'
                          : null,
                ),
              ],
              const SizedBox(height: 16),
              TextFormField(
                controller: _titleController,
                autofocus: widget.preselectedFacility != null,
                decoration: const InputDecoration(
                  labelText: 'Event *',
                  border: OutlineInputBorder(),
                ),
                validator: (v) => (v == null || v.trim().isEmpty)
                    ? 'Event is required'
                    : null,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _reservedByController,
                decoration: const InputDecoration(
                  labelText: 'Reserved By *',
                  border: OutlineInputBorder(),
                ),
                validator: (v) => (v == null || v.trim().isEmpty)
                    ? 'Reserved By is required'
                    : null,
              ),
              const SizedBox(height: 16),
              _DateTimePickerRow(
                label: 'Start Time *',
                dateLabel:
                    _startDate == null ? 'Pick date' : _formatDate(_startDate!),
                timeLabel: _startClock == null
                    ? 'Pick time'
                    : _formatTime(_startClock!),
                onPickDate: () async {
                  final picked = await showDatePicker(
                    context: context,
                    initialDate: _startDate ?? DateTime.now(),
                    firstDate: DateTime(2024),
                    lastDate: DateTime(2035),
                  );
                  if (picked != null) {
                    setState(() => _startDate = picked);
                  }
                },
                onPickTime: () async {
                  final picked = await showTimePicker(
                    context: context,
                    initialTime: _startClock ?? TimeOfDay.now(),
                  );
                  if (picked != null) {
                    setState(() => _startClock = picked);
                  }
                },
              ),
              const SizedBox(height: 16),
              _DateTimePickerRow(
                label: 'End Time *',
                dateLabel:
                    _endDate == null ? 'Pick date' : _formatDate(_endDate!),
                timeLabel:
                    _endClock == null ? 'Pick time' : _formatTime(_endClock!),
                onPickDate: () async {
                  final picked = await showDatePicker(
                    context: context,
                    initialDate: _endDate ?? _startDate ?? DateTime.now(),
                    firstDate: DateTime(2024),
                    lastDate: DateTime(2035),
                  );
                  if (picked != null) {
                    setState(() => _endDate = picked);
                  }
                },
                onPickTime: () async {
                  final picked = await showTimePicker(
                    context: context,
                    initialTime: _endClock ?? _startClock ?? TimeOfDay.now(),
                  );
                  if (picked != null) {
                    setState(() => _endClock = picked);
                  }
                },
              ),
              if (_dateTimeValidationMessage != null) ...[
                const SizedBox(height: 8),
                Text(
                  _dateTimeValidationMessage!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
              const SizedBox(height: 16),
              TextFormField(
                controller: _notesController,
                decoration: const InputDecoration(
                  labelText: 'Notes',
                  border: OutlineInputBorder(),
                ),
                maxLines: 3,
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        if (widget.initialReservation != null)
          TextButton(
            onPressed: _saving
                ? null
                : () async {
                    final navigator = Navigator.of(context);
                    final messenger = ScaffoldMessenger.of(context);
                    final confirmed = await _confirmDeleteReservation(
                      context,
                      widget.initialReservation!.title,
                    );
                    if (confirmed != true) return;
                    setState(() => _saving = true);
                    try {
                      await widget.controller.deleteReservation(
                        _selectedFacility!.id,
                        widget.initialReservation!.id,
                      );
                      if (mounted) {
                        navigator.pop();
                        messenger.showSnackBar(
                          const SnackBar(
                            content: Text('Reservation deleted'),
                          ),
                        );
                      }
                    } catch (e) {
                      if (mounted) {
                        setState(() => _saving = false);
                        messenger.showSnackBar(
                          SnackBar(content: Text('Error: $e')),
                        );
                      }
                    }
                  },
            style: TextButton.styleFrom(
              foregroundColor: Theme.of(context).colorScheme.error,
            ),
            child: const Text('Delete'),
          ),
        FilledButton(
          onPressed: _saving ? null : _submit,
          child: _saving
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Submit'),
        ),
      ],
    );
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    if (_dateTimeValidationMessage != null) {
      setState(() {});
      return;
    }

    setState(() => _saving = true);
    try {
      var facility = _selectedFacility;
      if (_addingRoom) {
        facility = await widget.controller.createFacility(
          name: _newRoomController.text.trim(),
        );
      }
      if (facility == null) {
        throw Exception('Please choose a room.');
      }

      if (widget.initialReservation == null) {
        await widget.controller.createReservation(
          facility.id,
          title: _titleController.text.trim(),
          reservedBy: _reservedByController.text.trim(),
          startTime: _composeTimestamp(_startDate!, _startClock!),
          endTime: _composeTimestamp(_endDate!, _endClock!),
          notes: _notesController.text.trim(),
        );
      } else {
        await widget.controller.updateReservation(
          facility.id,
          widget.initialReservation!.id,
          title: _titleController.text.trim(),
          reservedBy: _reservedByController.text.trim(),
          startTime: _composeTimestamp(_startDate!, _startClock!),
          endTime: _composeTimestamp(_endDate!, _endClock!),
          notes: _notesController.text.trim(),
        );
      }
      if (mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              widget.initialReservation == null
                  ? 'Reservation created'
                  : 'Reservation updated',
            ),
          ),
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

  String? get _dateTimeValidationMessage {
    if (_startDate == null || _startClock == null) {
      return 'Start date and time are required.';
    }
    if (_endDate == null || _endClock == null) {
      return 'End date and time are required.';
    }

    final start = DateTime(
      _startDate!.year,
      _startDate!.month,
      _startDate!.day,
      _startClock!.hour,
      _startClock!.minute,
    );
    final end = DateTime(
      _endDate!.year,
      _endDate!.month,
      _endDate!.day,
      _endClock!.hour,
      _endClock!.minute,
    );
    if (!end.isAfter(start)) {
      return 'End time must be after start time.';
    }

    final facilityId = _selectedFacility?.id;
    if (!_addingRoom && facilityId != null) {
      final reservations =
          widget.controller.reservationsByFacility[facilityId] ?? const [];
      for (final reservation in reservations) {
        if (widget.initialReservation?.id == reservation.id) continue;
        final reservationStart = _parseReservationDateTime(reservation.startTime);
        final reservationEnd = _parseReservationDateTime(reservation.endTime);
        if (reservationStart == null || reservationEnd == null) continue;
        final overlaps =
            start.isBefore(reservationEnd) && end.isAfter(reservationStart);
        if (overlaps) {
          return 'Conflicts with "${reservation.title}". Choose a different room or time.';
        }
      }
    }

    return null;
  }

  String _composeTimestamp(DateTime date, TimeOfDay time) {
    final month = date.month.toString().padLeft(2, '0');
    final day = date.day.toString().padLeft(2, '0');
    final hour = time.hour.toString().padLeft(2, '0');
    final minute = time.minute.toString().padLeft(2, '0');
    return '${date.year}-$month-$day $hour:$minute';
  }

  static String _formatDate(DateTime date) {
    final month = date.month.toString().padLeft(2, '0');
    final day = date.day.toString().padLeft(2, '0');
    return '${date.year}-$month-$day';
  }

  static String _formatTime(TimeOfDay time) {
    final hour = time.hourOfPeriod == 0 ? 12 : time.hourOfPeriod;
    final minute = time.minute.toString().padLeft(2, '0');
    final period = time.period == DayPeriod.am ? 'AM' : 'PM';
    return '$hour:$minute $period';
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

Future<bool?> _confirmDeleteReservation(
  BuildContext context,
  String title,
) {
  return showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Delete Reservation?'),
      content: Text('Delete "$title"? This cannot be undone.'),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: const Text('Delete'),
        ),
      ],
    ),
  );
}

class _DateTimePickerRow extends StatelessWidget {
  const _DateTimePickerRow({
    required this.label,
    required this.dateLabel,
    required this.timeLabel,
    required this.onPickDate,
    required this.onPickTime,
  });

  final String label;
  final String dateLabel;
  final String timeLabel;
  final VoidCallback onPickDate;
  final VoidCallback onPickTime;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: const Color(0xFF374151),
                fontWeight: FontWeight.w500,
              ),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: onPickDate,
                icon: const Icon(Icons.calendar_month_outlined, size: 18),
                label: Align(
                  alignment: Alignment.centerLeft,
                  child: Text(dateLabel),
                ),
                style: OutlinedButton.styleFrom(
                  alignment: Alignment.centerLeft,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: onPickTime,
                icon: const Icon(Icons.schedule_outlined, size: 18),
                label: Align(
                  alignment: Alignment.centerLeft,
                  child: Text(timeLabel),
                ),
                style: OutlinedButton.styleFrom(
                  alignment: Alignment.centerLeft,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}
