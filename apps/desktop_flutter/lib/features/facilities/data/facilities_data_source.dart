import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/errors/app_error.dart';
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
    _assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => Facility.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<List<Reservation>> getReservations(int facilityId) async {
    final response = await http.get(
      Uri.parse('$_baseUrl/facilities/$facilityId/reservations'),
      headers: AuthSessionStore.headers(),
    );
    _assertOk(response);
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
    _assertOk(response);
    return Reservation.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  void _assertOk(http.Response response) {
    if (response.statusCode >= 400) {
      final body = jsonDecode(response.body) as Map<String, dynamic>?;
      final message =
          (body?['error'] as Map<String, dynamic>?)?['message'] as String? ??
              'Request failed';
      throw AppError(message);
    }
  }
}
