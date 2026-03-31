import '../data/facilities_data_source.dart';
import '../models/facility.dart';
import '../models/reservation.dart';

class FacilitiesRepository {
  FacilitiesRepository(this._dataSource);

  final FacilitiesDataSource _dataSource;

  Future<List<Facility>> getFacilities() => _dataSource.getFacilities();

  Future<List<Reservation>> getReservations(int facilityId) =>
      _dataSource.getReservations(facilityId);

  Future<Reservation> createReservation(
          int facilityId, Map<String, dynamic> body) =>
      _dataSource.createReservation(facilityId, body);
}
