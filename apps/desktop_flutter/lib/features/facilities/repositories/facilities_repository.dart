import '../data/facilities_data_source.dart';
import '../models/facility.dart';
import '../models/reservation.dart';

class FacilitiesRepository {
  FacilitiesRepository(this._dataSource);

  final FacilitiesDataSource _dataSource;

  Future<List<Facility>> getFacilities() => _dataSource.getFacilities();

  Future<Facility> createFacility(Map<String, dynamic> body) =>
      _dataSource.createFacility(body);

  Future<List<Reservation>> getReservations(int facilityId) =>
      _dataSource.getReservations(facilityId);

  Future<Reservation> createReservation(
          int facilityId, Map<String, dynamic> body) =>
      _dataSource.createReservation(facilityId, body);

  Future<Reservation> updateReservation(
    int facilityId,
    int reservationId,
    Map<String, dynamic> body,
  ) =>
      _dataSource.updateReservation(facilityId, reservationId, body);

  Future<void> deleteReservation(int facilityId, int reservationId) =>
      _dataSource.deleteReservation(facilityId, reservationId);
}
