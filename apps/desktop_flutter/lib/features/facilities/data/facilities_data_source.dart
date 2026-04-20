import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/facility.dart';
import '../models/reservation.dart';
import '../models/reservation_series.dart';

class FacilitiesDataSource {
  FacilitiesDataSource({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<List<Facility>> getFacilities() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/facilities'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => Facility.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<Facility> createFacility(Map<String, dynamic> body) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/facilities'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode(body),
    );
    assertOk(response);
    return Facility.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<Facility> updateFacility(
    int facilityId,
    Map<String, dynamic> body,
  ) async {
    final response = await http.patch(
      Uri.parse('$_baseUrl/facilities/$facilityId'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode(body),
    );
    assertOk(response);
    return Facility.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<void> deleteFacility(int facilityId) async {
    final response = await http.delete(
      Uri.parse('$_baseUrl/facilities/$facilityId'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
  }

  Future<List<Reservation>> getReservations(int facilityId) async {
    final response = await http.get(
      Uri.parse('$_baseUrl/facilities/$facilityId/reservations'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => Reservation.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<List<Reservation>> getReservationOverview({
    String? start,
    String? end,
    int? facilityId,
    String? building,
  }) async {
    final queryParameters = <String, String>{
      if (start != null && start.isNotEmpty) 'start': start,
      if (end != null && end.isNotEmpty) 'end': end,
      if (facilityId != null) 'facilityId': '$facilityId',
      if (building != null && building.isNotEmpty) 'building': building,
    };
    final uri = Uri.parse('$_baseUrl/facilities/reservations').replace(
      queryParameters: queryParameters.isEmpty ? null : queryParameters,
    );
    final response = await http.get(uri, headers: AuthSessionStore.headers());
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => Reservation.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<List<ReservationSeries>> getReservationSeries(int facilityId) async {
    final response = await http.get(
      Uri.parse('$_baseUrl/facilities/$facilityId/reservation-series'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => ReservationSeries.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<ReservationSeries> getReservationSeriesDetail(
    int facilityId,
    String seriesId,
  ) async {
    final response = await http.get(
      Uri.parse(
        '$_baseUrl/facilities/$facilityId/reservation-series/$seriesId',
      ),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    final seriesJson = json['series'];
    return ReservationSeries.fromJson(
      seriesJson is Map<String, dynamic> ? seriesJson : json,
    );
  }

  Future<ReservationMutationResult> createReservation(
    int facilityId,
    Map<String, dynamic> body,
  ) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/facilities/$facilityId/reservations'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode(body),
    );
    assertOk(response);
    return ReservationMutationResult.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<ReservationSeriesCreationResult> createReservationSeries(
    int facilityId,
    Map<String, dynamic> body,
  ) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/facilities/$facilityId/reservation-series'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode(body),
    );
    assertOk(response);
    return ReservationSeriesCreationResult.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<ReservationSeriesCreationResult> updateReservationSeries(
    int facilityId,
    String seriesId,
    Map<String, dynamic> body,
  ) async {
    final response = await http.patch(
      Uri.parse(
        '$_baseUrl/facilities/$facilityId/reservation-series/$seriesId',
      ),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode(body),
    );
    assertOk(response);
    return ReservationSeriesCreationResult.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<ReservationMutationResult> updateReservation(
    int facilityId,
    int reservationId,
    Map<String, dynamic> body,
  ) async {
    final response = await http.patch(
      Uri.parse('$_baseUrl/facilities/$facilityId/reservations/$reservationId'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode(body),
    );
    assertOk(response);
    return ReservationMutationResult.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<void> deleteReservation(int facilityId, int reservationId) async {
    final response = await http.delete(
      Uri.parse('$_baseUrl/facilities/$facilityId/reservations/$reservationId'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
  }

  Future<void> deleteReservationSeries(int facilityId, String seriesId) async {
    final response = await http.delete(
      Uri.parse(
        '$_baseUrl/facilities/$facilityId/reservation-series/$seriesId',
      ),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
  }
}
