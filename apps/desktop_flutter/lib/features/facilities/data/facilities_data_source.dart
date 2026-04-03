import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/facility.dart';
import '../models/reservation.dart';

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

  Future<Reservation> createReservation(
      int facilityId, Map<String, dynamic> body) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/facilities/$facilityId/reservations'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode(body),
    );
    assertOk(response);
    return Reservation.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<Reservation> updateReservation(
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
    return Reservation.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<void> deleteReservation(int facilityId, int reservationId) async {
    final response = await http.delete(
      Uri.parse('$_baseUrl/facilities/$facilityId/reservations/$reservationId'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
  }
}
