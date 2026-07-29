import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/auth/auth_data_source.dart';
import 'package:rhythm_desktop/app/core/auth/auth_session_service.dart';
import 'package:rhythm_desktop/app/core/auth/auth_user.dart';
import 'package:rhythm_desktop/features/facilities/controllers/facilities_controller.dart';
import 'package:rhythm_desktop/features/facilities/data/facilities_data_source.dart';
import 'package:rhythm_desktop/features/facilities/models/facility.dart';
import 'package:rhythm_desktop/features/facilities/models/reservation.dart';
import 'package:rhythm_desktop/features/facilities/models/reservation_series.dart';
import 'package:rhythm_desktop/features/facilities/repositories/facilities_repository.dart';
import 'package:rhythm_desktop/features/facilities/views/facilities_view.dart';

void main() {
  testWidgets(
    'Facilities overview surfaces attention-needed signals and manager actions',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 1200));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      _FakeAuthSessionService(
        const AuthUser(
          id: 77,
          name: 'Facilities Manager',
          email: 'facilities@example.com',
          role: 'manager',
          isFacilitiesManager: true,
        ),
      );
      await _setTestSurfaceSize(tester);

      final repository = _FakeFacilitiesRepository()
        ..facilitiesFixture = const [
          Facility(id: 1, name: 'North Room', building: 'North Campus'),
        ]
        ..reservationsByFacilityFixture = {
          1: const [
            Reservation(
              id: 10,
              facilityId: 1,
              title: 'Leadership Meeting',
              requesterName: 'Pastor Sam',
              createdByName: 'Facilities Manager',
              createdByUserId: 77,
              startTime: '2026-04-08T16:00:00.000Z',
              endTime: '2026-04-08T17:00:00.000Z',
              notes: 'Need chairs and podium',
              isConflicted: true,
              conflictReason: 'Time overlap',
            ),
          ],
        }
        ..overviewFixture = const [
          Reservation(
            id: 10,
            facilityId: 1,
            title: 'Leadership Meeting',
            requesterName: 'Pastor Sam',
            createdByName: 'Facilities Manager',
            createdByUserId: 77,
            startTime: '2026-04-08T16:00:00.000Z',
            endTime: '2026-04-08T17:00:00.000Z',
            notes: 'Need chairs and podium',
            isConflicted: true,
            conflictReason: 'Time overlap',
            createdByRhythm: false,
          ),
        ];

      await _pumpFacilitiesView(tester, repository);

      expect(find.text('Facilities overview'), findsOneWidget);
      expect(find.text('Attention needed'), findsOneWidget);
      expect(find.text('Setup notes'), findsWidgets);
      expect(find.text('Conflicts'), findsOneWidget);
      expect(find.text('External changes'), findsOneWidget);

      await tester.tap(find.byIcon(Icons.more_horiz).first);
      await tester.pumpAndSettle();

      expect(find.text('Open details'), findsOneWidget);
      expect(find.text('Edit reservation'), findsOneWidget);
      expect(find.text('Delete reservation'), findsOneWidget);
    },
  );

  testWidgets('Facilities overview keeps non-manager users read-only', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1600, 1200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    _FakeAuthSessionService(
      const AuthUser(
        id: 12,
        name: 'Team Member',
        email: 'member@example.com',
        role: 'member',
      ),
    );
    await _setTestSurfaceSize(tester);

    final repository = _FakeFacilitiesRepository()
      ..facilitiesFixture = const [
        Facility(id: 1, name: 'North Room', building: 'North Campus'),
      ]
      ..reservationsByFacilityFixture = {
        1: const [
          Reservation(
            id: 11,
            facilityId: 1,
            title: 'Choir Rehearsal',
            requesterName: 'Music Team',
            createdByName: 'Another User',
            createdByUserId: 90,
            startTime: '2026-04-09T18:00:00.000Z',
            endTime: '2026-04-09T19:00:00.000Z',
          ),
        ],
      }
      ..overviewFixture = const [
        Reservation(
          id: 11,
          facilityId: 1,
          title: 'Choir Rehearsal',
          requesterName: 'Music Team',
          createdByName: 'Another User',
          createdByUserId: 90,
          startTime: '2026-04-09T18:00:00.000Z',
          endTime: '2026-04-09T19:00:00.000Z',
        ),
      ];

    await _pumpFacilitiesView(tester, repository);

    await tester.tap(find.byIcon(Icons.more_horiz).first);
    await tester.pumpAndSettle();

    expect(find.text('Open details'), findsOneWidget);
    expect(find.text('Edit reservation'), findsNothing);
    expect(find.text('Delete reservation'), findsNothing);
  });

  testWidgets(
    'Facilities availability panel shows overlap feedback before submit',
    (tester) async {
      await _setTestSurfaceSize(tester);

      const facility = Facility(
        id: 2,
        name: 'Sanctuary',
        building: 'Main Campus',
      );
      const reservations = [
        Reservation(
          id: 20,
          facilityId: 2,
          title: 'Morning rehearsal',
          requesterName: 'Jordan',
          createdByUserId: 21,
          startTime: '2026-04-10T09:00:00',
          endTime: '2026-04-10T10:00:00',
        ),
        Reservation(
          id: 21,
          facilityId: 2,
          title: 'Conference setup',
          requesterName: 'Taylor',
          createdByUserId: 22,
          startTime: '2026-04-10T09:30:00',
          endTime: '2026-04-10T10:30:00',
        ),
      ];
      final repository = _FakeFacilitiesRepository()
        ..facilitiesFixture = const [facility]
        ..reservationsByFacilityFixture = {2: reservations};
      final controller = FacilitiesController(repository);
      await controller.loadFacilities();

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: FacilitiesAvailabilityPanel(
              controller: controller,
              selectedFacilities: const [facility],
              selectedDate: DateTime(2026, 4, 10),
              selectedStartTime: const TimeOfDay(hour: 9, minute: 0),
              selectedEndTime: const TimeOfDay(hour: 10, minute: 0),
              showRecurringHint: true,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Availability for Sanctuary'), findsOneWidget);
      expect(find.textContaining('Selected time overlaps'), findsOneWidget);
      expect(find.text('Overlap'), findsWidgets);
      expect(
        find.textContaining(
          'Recurring conflicts are checked across the full series',
        ),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'Facilities overview groups multi-room reservations into one reservation cluster',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 1200));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      _FakeAuthSessionService(
        const AuthUser(
          id: 77,
          name: 'Facilities Manager',
          email: 'facilities@example.com',
          role: 'manager',
          isFacilitiesManager: true,
        ),
      );
      await _setTestSurfaceSize(tester);

      final repository = _FakeFacilitiesRepository()
        ..facilitiesFixture = const [
          Facility(id: 1, name: 'Sanctuary', building: 'Main Campus'),
          Facility(id: 2, name: 'Fellowship Hall', building: 'Main Campus'),
        ]
        ..overviewFixture = const [
          Reservation(
            id: 100,
            facilityId: 1,
            title: 'Sunday School',
            requesterName: 'Children Ministry',
            createdByUserId: 77,
            startTime: '2026-04-12T15:00:00.000Z',
            endTime: '2026-04-12T16:00:00.000Z',
          ),
          Reservation(
            id: 101,
            facilityId: 2,
            title: 'Sunday School',
            requesterName: 'Children Ministry',
            createdByUserId: 77,
            startTime: '2026-04-12T15:00:00.000Z',
            endTime: '2026-04-12T16:00:00.000Z',
          ),
        ];

      await _pumpFacilitiesView(tester, repository);

      expect(find.text('Sunday School'), findsOneWidget);
      expect(
        find.textContaining('Rooms: Sanctuary, Fellowship Hall'),
        findsOneWidget,
      );
      expect(find.text('2 rooms'), findsOneWidget);
    },
  );

  testWidgets(
    'Facilities overview detail flow shows recurring-series manager actions',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 1200));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      _FakeAuthSessionService(
        const AuthUser(
          id: 77,
          name: 'Facilities Manager',
          email: 'facilities@example.com',
          role: 'manager',
          isFacilitiesManager: true,
        ),
      );
      await _setTestSurfaceSize(tester);

      const series = ReservationSeries(
        id: 'series-1',
        facilityId: 3,
        title: 'Weekly worship set',
        requesterName: 'Jordan',
        requesterUserId: 21,
        createdByUserId: 77,
        recurrenceType: 'weekly',
        startDate: '2026-04-01',
        startTime: '2026-04-08T13:00:00.000Z',
        endTime: '2026-04-08T14:30:00.000Z',
      );

      final repository = _FakeFacilitiesRepository()
        ..facilitiesFixture = const [
          Facility(id: 3, name: 'North Room', building: 'North Campus'),
        ]
        ..reservationsByFacilityFixture = {
          3: const [
            Reservation(
              id: 30,
              facilityId: 3,
              seriesId: 'series-1',
              title: 'Weekly worship set',
              requesterName: 'Jordan',
              createdByUserId: 77,
              startTime: '2026-04-08T13:00:00.000Z',
              endTime: '2026-04-08T14:30:00.000Z',
            ),
          ],
        }
        ..seriesByFacilityFixture = {
          3: [series],
        }
        ..overviewFixture = const [
          Reservation(
            id: 30,
            facilityId: 3,
            seriesId: 'series-1',
            title: 'Weekly worship set',
            requesterName: 'Jordan',
            createdByUserId: 77,
            startTime: '2026-04-08T13:00:00.000Z',
            endTime: '2026-04-08T14:30:00.000Z',
          ),
        ];

      await _pumpFacilitiesView(tester, repository);

      await tester.tap(find.text('Weekly worship set'));
      await tester.pumpAndSettle();

      expect(
        find.text('Recurring series: Weekly worship set · weekly'),
        findsOneWidget,
      );
      expect(find.text('Edit entire series'), findsOneWidget);
      expect(find.text('Delete entire series'), findsOneWidget);
    },
  );
}

Future<void> _pumpFacilitiesView(
  WidgetTester tester,
  _FakeFacilitiesRepository repository,
) async {
  await tester.pumpWidget(
    ChangeNotifierProvider(
      create: (_) => FacilitiesController(repository),
      child: const MaterialApp(home: Scaffold(body: FacilitiesView())),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _setTestSurfaceSize(WidgetTester tester) async {
  await tester.binding.setSurfaceSize(const Size(1600, 1200));
  addTearDown(() async {
    await tester.binding.setSurfaceSize(null);
  });
}

class _FakeAuthSessionService extends AuthSessionService {
  _FakeAuthSessionService(this._user)
    : super(AuthDataSource(baseUrl: 'http://example.invalid'));

  final AuthUser _user;

  @override
  AuthUser? get currentUser => _user;
}

class _FakeFacilitiesRepository extends FacilitiesRepository {
  _FakeFacilitiesRepository()
    : super(FacilitiesDataSource(baseUrl: 'http://example.invalid'));

  List<Facility> facilitiesFixture = const [];
  Map<int, List<Reservation>> reservationsByFacilityFixture = const {};
  Map<int, List<ReservationSeries>> seriesByFacilityFixture = const {};
  List<Reservation> overviewFixture = const [];

  @override
  Future<List<Facility>> getFacilities() async => facilitiesFixture;

  @override
  Future<List<Reservation>> getReservations(int facilityId) async =>
      reservationsByFacilityFixture[facilityId] ?? const [];

  @override
  Future<List<ReservationSeries>> getReservationSeries(int facilityId) async =>
      seriesByFacilityFixture[facilityId] ?? const [];

  @override
  Future<List<Reservation>> getReservationOverview({
    String? start,
    String? end,
    int? facilityId,
    String? building,
  }) async => overviewFixture;
}
