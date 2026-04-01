import 'package:flutter/foundation.dart';

import '../models/facility.dart';
import '../models/reservation.dart';
import '../repositories/facilities_repository.dart';

enum FacilitiesStatus { idle, loading, error }

class FacilitiesController extends ChangeNotifier {
  FacilitiesController(this._repository);

  final FacilitiesRepository _repository;

  List<Facility> _facilities = [];
  Map<int, List<Reservation>> _reservationsByFacility = {};
  FacilitiesStatus _status = FacilitiesStatus.idle;
  String? _errorMessage;

  List<Facility> get facilities => _facilities;
  Map<int, List<Reservation>> get reservationsByFacility =>
      _reservationsByFacility;
  FacilitiesStatus get status => _status;
  String? get errorMessage => _errorMessage;

  Future<Facility> createFacility({
    required String name,
    String? description,
    String? location,
  }) async {
    final facility = await _repository.createFacility({
      'name': name,
      if (description != null && description.isNotEmpty)
        'description': description,
      if (location != null && location.isNotEmpty) 'location': location,
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

      // Load reservations for all facilities in parallel.
      final results = await Future.wait(
        _facilities.map((f) => _repository.getReservations(f.id)),
      );
      final map = <int, List<Reservation>>{};
      for (var i = 0; i < _facilities.length; i++) {
        map[_facilities[i].id] = results[i];
      }
      _reservationsByFacility = map;
      _status = FacilitiesStatus.idle;
    } catch (e) {
      _errorMessage = e.toString();
      _status = FacilitiesStatus.error;
    }
    notifyListeners();
  }

  Future<void> createReservation(
    int facilityId, {
    required String title,
    required String reservedBy,
    String? startTime,
    String? endTime,
    String? notes,
  }) async {
    final body = <String, dynamic>{
      'title': title,
      'reserved_by': reservedBy,
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
    notifyListeners();
  }

  Future<void> updateReservation(
    int facilityId,
    int reservationId, {
    required String title,
    required String reservedBy,
    String? startTime,
    String? endTime,
    String? notes,
  }) async {
    final body = <String, dynamic>{
      'title': title,
      'reserved_by': reservedBy,
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
    notifyListeners();
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
    notifyListeners();
  }
}
