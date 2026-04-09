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

  Future<Facility> updateFacility(int facilityId, Map<String, dynamic> body) =>
      _dataSource.updateFacility(facilityId, body);

  Future<void> deleteFacility(int facilityId) =>
      _dataSource.deleteFacility(facilityId);

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

  Future<ReservationSeries> getReservationSeriesDetail(
    int facilityId,
    String seriesId,
  ) =>
      _dataSource.getReservationSeriesDetail(facilityId, seriesId);

  Future<ReservationMutationResult> createReservation(
          int facilityId, Map<String, dynamic> body) =>
      _dataSource.createReservation(facilityId, body);

  Future<ReservationSeriesCreationResult> createReservationSeries(
    int facilityId,
    Map<String, dynamic> body,
  ) =>
      _dataSource.createReservationSeries(facilityId, body);

  Future<ReservationSeriesCreationResult> updateReservationSeries(
    int facilityId,
    String seriesId,
    Map<String, dynamic> body,
  ) =>
      _dataSource.updateReservationSeries(facilityId, seriesId, body);

  Future<ReservationMutationResult> updateReservation(
    int facilityId,
    int reservationId,
    Map<String, dynamic> body,
  ) =>
      _dataSource.updateReservation(facilityId, reservationId, body);

  Future<void> deleteReservation(int facilityId, int reservationId) =>
      _dataSource.deleteReservation(facilityId, reservationId);

  Future<void> deleteReservationSeries(int facilityId, String seriesId) =>
      _dataSource.deleteReservationSeries(facilityId, seriesId);
}
