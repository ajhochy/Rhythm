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
      'reservedBy': reservedBy,
      if (startTime != null && startTime.isNotEmpty) 'startTime': startTime,
      if (endTime != null && endTime.isNotEmpty) 'endTime': endTime,
      if (notes != null && notes.isNotEmpty) 'notes': notes,
    };

    final reservation = await _repository.createReservation(facilityId, body);

    // Update the reservations map for this facility.
    final updated =
        List<Reservation>.from(_reservationsByFacility[facilityId] ?? [])
          ..add(reservation);
    _reservationsByFacility = {
      ..._reservationsByFacility,
      facilityId: updated,
    };
    notifyListeners();
  }
}
