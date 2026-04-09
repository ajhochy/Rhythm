import 'package:flutter/foundation.dart';

import '../../../app/core/auth/auth_session_service.dart';
import '../../../app/core/auth/auth_user.dart';
import '../models/facility.dart';
import '../models/reservation.dart';
import '../models/reservation_series.dart';
import '../repositories/facilities_repository.dart';

enum FacilitiesStatus { idle, loading, error }

class FacilitiesOverviewQuery {
  const FacilitiesOverviewQuery({
    this.start,
    this.end,
    this.facilityId,
    this.building,
  });

  final String? start;
  final String? end;
  final int? facilityId;
  final String? building;
}

class FacilitiesController extends ChangeNotifier {
  FacilitiesController(this._repository);

  final FacilitiesRepository _repository;

  List<Facility> _facilities = [];
  Map<int, List<Reservation>> _reservationsByFacility = {};
  Map<int, List<ReservationSeries>> _reservationSeriesByFacility = {};
  List<Reservation> _overviewReservations = [];
  FacilitiesOverviewQuery? _lastOverviewQuery;
  FacilitiesStatus _status = FacilitiesStatus.idle;
  bool _isLoadingOverview = false;
  String? _errorMessage;
  String? _overviewErrorMessage;

  List<Facility> get facilities => _facilities;
  Map<int, List<Reservation>> get reservationsByFacility =>
      _reservationsByFacility;
  Map<int, List<ReservationSeries>> get reservationSeriesByFacility =>
      _reservationSeriesByFacility;
  List<Reservation> get overviewReservations => _overviewReservations;
  FacilitiesStatus get status => _status;
  bool get isLoadingOverview => _isLoadingOverview;
  String? get errorMessage => _errorMessage;
  String? get overviewErrorMessage => _overviewErrorMessage;
  AuthUser? get currentUser {
    try {
      return AuthSessionService.instance.currentUser;
    } catch (_) {
      return null;
    }
  }

  bool get isFacilitiesManager => currentUser?.isFacilitiesManager ?? false;
  List<String> get buildings => _facilities
      .map((facility) => facility.building?.trim())
      .whereType<String>()
      .where((building) => building.isNotEmpty)
      .toSet()
      .toList()
    ..sort();

  Future<Facility> createFacility({
    required String name,
    String? description,
    String? location,
    String? building,
  }) async {
    final facility = await _repository.createFacility({
      'name': name,
      if (description != null && description.isNotEmpty)
        'description': description,
      if (location != null && location.isNotEmpty) 'location': location,
      if (building != null && building.isNotEmpty) 'building': building,
    });
    _facilities = [..._facilities, facility]
      ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    _reservationsByFacility = {
      ..._reservationsByFacility,
      facility.id: _reservationsByFacility[facility.id] ?? const [],
    };
    notifyListeners();
    return facility;
  }

  Future<void> loadFacilities() async {
    _status = FacilitiesStatus.loading;
    _errorMessage = null;
    notifyListeners();

    try {
      _facilities = await _repository.getFacilities();

      // Load reservations and recurring series for all facilities in parallel.
      final reservationResults = await Future.wait(
        _facilities.map((f) => _repository.getReservations(f.id)),
      );
      final seriesResults = await Future.wait(
        _facilities.map((f) => _repository.getReservationSeries(f.id)),
      );
      final map = <int, List<Reservation>>{};
      final seriesMap = <int, List<ReservationSeries>>{};
      for (var i = 0; i < _facilities.length; i++) {
        map[_facilities[i].id] = reservationResults[i];
        seriesMap[_facilities[i].id] = seriesResults[i];
      }
      _reservationsByFacility = map;
      _reservationSeriesByFacility = seriesMap;
      _status = FacilitiesStatus.idle;
    } catch (e) {
      _errorMessage = e.toString();
      _status = FacilitiesStatus.error;
    }
    notifyListeners();
  }

  Future<void> loadReservationOverview({
    String? start,
    String? end,
    int? facilityId,
    String? building,
  }) async {
    _isLoadingOverview = true;
    _overviewErrorMessage = null;
    _lastOverviewQuery = FacilitiesOverviewQuery(
      start: start,
      end: end,
      facilityId: facilityId,
      building: building,
    );
    notifyListeners();

    try {
      _overviewReservations = await _repository.getReservationOverview(
        start: start,
        end: end,
        facilityId: facilityId,
        building: building,
      );
    } catch (e) {
      _overviewErrorMessage = e.toString();
    } finally {
      _isLoadingOverview = false;
      notifyListeners();
    }
  }

  Future<void> _refreshFacilityCache(int facilityId) async {
    final reservations = await _repository.getReservations(facilityId);
    final series = await _repository.getReservationSeries(facilityId);
    _reservationsByFacility = {
      ..._reservationsByFacility,
      facilityId: reservations,
    };
    _reservationSeriesByFacility = {
      ..._reservationSeriesByFacility,
      facilityId: series,
    };
  }

  Future<void> reloadReservationOverview() async {
    final last = _lastOverviewQuery;
    if (last == null) return;
    await loadReservationOverview(
      start: last.start,
      end: last.end,
      facilityId: last.facilityId,
      building: last.building,
    );
  }

  Future<void> createReservation(
    int facilityId, {
    required String title,
    String? reservedBy,
    String? requesterName,
    int? requesterUserId,
    int? createdByUserId,
    String? startTime,
    String? endTime,
    String? notes,
  }) async {
    final effectiveRequesterName =
        (requesterName ?? reservedBy ?? currentUser?.name)?.trim();
    if (effectiveRequesterName == null || effectiveRequesterName.isEmpty) {
      throw ArgumentError('requesterName or reservedBy is required');
    }
    final body = <String, dynamic>{
      'title': title,
      'requester_name': effectiveRequesterName,
      if (requesterUserId != null) 'requester_user_id': requesterUserId,
      if (createdByUserId != null) 'created_by_user_id': createdByUserId,
      if (startTime != null && startTime.isNotEmpty) 'start_time': startTime,
      if (endTime != null && endTime.isNotEmpty) 'end_time': endTime,
      if (notes != null && notes.isNotEmpty) 'notes': notes,
    };

    final reservation = await _repository.createReservation(facilityId, body);

    // Update the reservations map for this facility.
    final updated =
        List<Reservation>.from(_reservationsByFacility[facilityId] ?? [])
          ..add(reservation);
    _reservationsByFacility = {
      ..._reservationsByFacility,
      facilityId: updated
        ..sort((a, b) => (a.startTime ?? '').compareTo(b.startTime ?? '')),
    };
    await reloadReservationOverview();
    notifyListeners();
  }

  Future<void> updateReservation(
    int facilityId,
    int reservationId, {
    required String title,
    String? reservedBy,
    String? requesterName,
    int? requesterUserId,
    String? startTime,
    String? endTime,
    String? notes,
  }) async {
    final effectiveRequesterName =
        (requesterName ?? reservedBy ?? currentUser?.name)?.trim();
    if (effectiveRequesterName == null || effectiveRequesterName.isEmpty) {
      throw ArgumentError('requesterName or reservedBy is required');
    }
    final body = <String, dynamic>{
      'title': title,
      'requester_name': effectiveRequesterName,
      if (requesterUserId != null) 'requester_user_id': requesterUserId,
      if (startTime != null && startTime.isNotEmpty) 'start_time': startTime,
      if (endTime != null && endTime.isNotEmpty) 'end_time': endTime,
      'notes': (notes != null && notes.isNotEmpty) ? notes : null,
    };

    final reservation = await _repository.updateReservation(
      facilityId,
      reservationId,
      body,
    );

    final updated = List<Reservation>.from(
      _reservationsByFacility[facilityId] ?? [],
    );
    final index = updated.indexWhere((item) => item.id == reservationId);
    if (index >= 0) {
      updated[index] = reservation;
    } else {
      updated.add(reservation);
    }
    updated.sort((a, b) => (a.startTime ?? '').compareTo(b.startTime ?? ''));
    _reservationsByFacility = {
      ..._reservationsByFacility,
      facilityId: updated,
    };
    await reloadReservationOverview();
    notifyListeners();
  }

  Future<List<ReservationSeries>> loadReservationSeries(int facilityId) async {
    final series = await _repository.getReservationSeries(facilityId);
    _reservationSeriesByFacility = {
      ..._reservationSeriesByFacility,
      facilityId: series,
    };
    notifyListeners();
    return series;
  }

  Future<ReservationSeries?> loadReservationSeriesDetail(
    int facilityId,
    String seriesId,
  ) async {
    final series = await _repository.getReservationSeriesDetail(
      facilityId,
      seriesId,
    );
    final updated = List<ReservationSeries>.from(
      _reservationSeriesByFacility[facilityId] ?? const [],
    );
    final index = updated.indexWhere((item) => item.id == seriesId);
    if (index >= 0) {
      updated[index] = series;
    } else {
      updated.add(series);
    }
    _reservationSeriesByFacility = {
      ..._reservationSeriesByFacility,
      facilityId: updated,
    };
    notifyListeners();
    return series;
  }

  Future<ReservationSeriesCreationResult> createReservationSeries(
    int facilityId, {
    required String title,
    String? requesterName,
    int? requesterUserId,
    int? createdByUserId,
    String? notes,
    required String recurrenceType,
    int? recurrenceInterval,
    Map<String, dynamic>? weekdayPattern,
    List<String>? customDates,
    required String startTime,
    required String endTime,
    required String startDate,
    String? endDate,
  }) async {
    final effectiveRequesterName = (requesterName ?? currentUser?.name)?.trim();
    if (effectiveRequesterName == null || effectiveRequesterName.isEmpty) {
      throw ArgumentError('requesterName is required');
    }
    final result = await _repository.createReservationSeries(facilityId, {
      'title': title,
      'requester_name': effectiveRequesterName,
      if (requesterUserId != null) 'requester_user_id': requesterUserId,
      if (createdByUserId != null) 'created_by_user_id': createdByUserId,
      if (notes != null && notes.isNotEmpty) 'notes': notes,
      'recurrence_type': recurrenceType,
      if (recurrenceInterval != null) 'recurrence_interval': recurrenceInterval,
      if (weekdayPattern != null) 'weekday_pattern': weekdayPattern,
      if (customDates != null) 'custom_dates': customDates,
      'start_time': startTime,
      'end_time': endTime,
      'start_date': startDate,
      if (endDate != null && endDate.isNotEmpty) 'end_date': endDate,
    });

    final existing = List<ReservationSeries>.from(
      _reservationSeriesByFacility[facilityId] ?? [],
    )..add(result.series);
    _reservationSeriesByFacility = {
      ..._reservationSeriesByFacility,
      facilityId: existing,
    };
    if (result.createdReservations.isNotEmpty) {
      final updatedReservations =
          List<Reservation>.from(_reservationsByFacility[facilityId] ?? [])
            ..addAll(result.createdReservations);
      updatedReservations.sort(
        (a, b) => (a.startTime ?? '').compareTo(b.startTime ?? ''),
      );
      _reservationsByFacility = {
        ..._reservationsByFacility,
        facilityId: updatedReservations,
      };
    }
    await reloadReservationOverview();
    notifyListeners();
    return result;
  }

  Future<void> deleteReservation(int facilityId, int reservationId) async {
    await _repository.deleteReservation(facilityId, reservationId);

    final updated = List<Reservation>.from(
      _reservationsByFacility[facilityId] ?? [],
    )..removeWhere((item) => item.id == reservationId);
    _reservationsByFacility = {
      ..._reservationsByFacility,
      facilityId: updated,
    };
    await reloadReservationOverview();
    notifyListeners();
  }

  Future<ReservationSeries> updateReservationSeries(
    int facilityId,
    String seriesId, {
    required String title,
    String? requesterName,
    int? requesterUserId,
    int? createdByUserId,
    String? notes,
    required String recurrenceType,
    int? recurrenceInterval,
    Map<String, dynamic>? weekdayPattern,
    List<String>? customDates,
    required String startTime,
    required String endTime,
    required String startDate,
    String? endDate,
  }) async {
    final effectiveRequesterName = (requesterName ?? currentUser?.name)?.trim();
    if (effectiveRequesterName == null || effectiveRequesterName.isEmpty) {
      throw ArgumentError('requesterName is required');
    }
    final updatedSeries = await _repository.updateReservationSeries(
      facilityId,
      seriesId,
      {
        'title': title,
        'requester_name': effectiveRequesterName,
        if (requesterUserId != null) 'requester_user_id': requesterUserId,
        if (createdByUserId != null) 'created_by_user_id': createdByUserId,
        if (notes != null && notes.isNotEmpty) 'notes': notes,
        'recurrence_type': recurrenceType,
        if (recurrenceInterval != null)
          'recurrence_interval': recurrenceInterval,
        if (weekdayPattern != null) 'weekday_pattern': weekdayPattern,
        if (customDates != null) 'custom_dates': customDates,
        'start_time': startTime,
        'end_time': endTime,
        'start_date': startDate,
        if (endDate != null && endDate.isNotEmpty) 'end_date': endDate,
      },
    );
    await _refreshFacilityCache(facilityId);
    await reloadReservationOverview();
    notifyListeners();
    return updatedSeries;
  }

  Future<void> deleteReservationSeries(
    int facilityId,
    String seriesId,
  ) async {
    await _repository.deleteReservationSeries(facilityId, seriesId);
    await _refreshFacilityCache(facilityId);
    await reloadReservationOverview();
    notifyListeners();
  }
}
