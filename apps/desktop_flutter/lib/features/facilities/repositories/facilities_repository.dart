import '../data/facilities_data_source.dart';
import '../models/facility.dart';
import '../models/reservation.dart';
import '../models/reservation_series.dart';

class FacilitiesRepository {
  FacilitiesRepository(this._dataSource);

  final FacilitiesDataSource _dataSource;

  Future<List<Facility>> getFacilities() => _dataSource.getFacilities();

  Future<Facility> createFacility(Map<String, dynamic> body) =>
      _dataSource.createFacility(body);

  Future<List<Reservation>> getReservations(int facilityId) =>
      _dataSource.getReservations(facilityId);

  Future<List<Reservation>> getReservationOverview({
    String? start,
    String? end,
    int? facilityId,
    String? building,
  }) =>
      _dataSource.getReservationOverview(
        start: start,
        end: end,
        facilityId: facilityId,
        building: building,
      );

  Future<List<ReservationSeries>> getReservationSeries(int facilityId) =>
      _dataSource.getReservationSeries(facilityId);

  Future<Reservation> createReservation(
          int facilityId, Map<String, dynamic> body) =>
      _dataSource.createReservation(facilityId, body);

  Future<ReservationSeriesCreationResult> createReservationSeries(
    int facilityId,
    Map<String, dynamic> body,
  ) =>
      _dataSource.createReservationSeries(facilityId, body);

  Future<Reservation> updateReservation(
    int facilityId,
    int reservationId,
    Map<String, dynamic> body,
  ) =>
      _dataSource.updateReservation(facilityId, reservationId, body);

  Future<void> deleteReservation(int facilityId, int reservationId) =>
      _dataSource.deleteReservation(facilityId, reservationId);
}
