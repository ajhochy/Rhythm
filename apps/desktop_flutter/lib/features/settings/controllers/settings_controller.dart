import 'package:flutter/foundation.dart';

import '../../../app/core/auth/auth_user.dart';
import '../repositories/settings_repository.dart';
import '../models/auto_promotion_settings_state.dart';

enum SettingsUsersStatus { idle, loading, ready, error }

enum AutoPromotionSettingsStatus { idle, loading, ready, error }

class SettingsController extends ChangeNotifier {
  SettingsController(this._repository);

  final SettingsRepository _repository;

  SettingsUsersStatus _usersStatus = SettingsUsersStatus.idle;
  List<AuthUser> _users = const [];
  String? _usersErrorMessage;
  final Set<int> _savingUserIds = <int>{};

  AutoPromotionSettingsStatus _autoPromotionStatus =
      AutoPromotionSettingsStatus.idle;
  AutoPromotionSettingsState? _autoPromotionState;
  String? _autoPromotionErrorMessage;
  bool _savingAutoPromotion = false;

  bool _emailNotificationsEnabled = true;
  bool get emailNotificationsEnabled => _emailNotificationsEnabled;

  SettingsUsersStatus get usersStatus => _usersStatus;
  List<AuthUser> get users => _users;
  String? get usersErrorMessage => _usersErrorMessage;

  bool isSavingUser(int userId) => _savingUserIds.contains(userId);

  AutoPromotionSettingsStatus get autoPromotionStatus => _autoPromotionStatus;
  AutoPromotionSettingsState? get autoPromotionState => _autoPromotionState;
  String? get autoPromotionErrorMessage => _autoPromotionErrorMessage;
  bool get isSavingAutoPromotion => _savingAutoPromotion;

  Future<void> refreshAutoPromotionState() async {
    if (_autoPromotionStatus == AutoPromotionSettingsStatus.loading) return;
    _autoPromotionStatus = AutoPromotionSettingsStatus.loading;
    _autoPromotionErrorMessage = null;
    notifyListeners();
    try {
      _autoPromotionState = await _repository.fetchAutoPromotionState();
      _autoPromotionStatus = AutoPromotionSettingsStatus.ready;
    } catch (error) {
      _autoPromotionStatus = AutoPromotionSettingsStatus.error;
      _autoPromotionErrorMessage = error.toString();
    }
    notifyListeners();
  }

  /// Never changes the displayed toggle optimistically. The durable GET after
  /// the mutation is authoritative, including after a server refusal/race.
  Future<void> setAutoPromotionEnabled(bool enabled) async {
    if (_savingAutoPromotion) return;
    _savingAutoPromotion = true;
    _autoPromotionErrorMessage = null;
    notifyListeners();
    Object? failure;
    StackTrace? failureStack;
    try {
      await _repository.setAutoPromotionEnabled(enabled);
    } catch (error, stackTrace) {
      failure = error;
      failureStack = stackTrace;
    }
    await refreshAutoPromotionState();
    _savingAutoPromotion = false;
    if (failure != null) {
      _autoPromotionErrorMessage = failure.toString();
    }
    notifyListeners();
    if (failure != null) Error.throwWithStackTrace(failure, failureStack!);
  }

  Future<void> loadUsers({bool force = false}) async {
    if (_usersStatus == SettingsUsersStatus.loading) return;
    if (!force &&
        _usersStatus == SettingsUsersStatus.ready &&
        _users.isNotEmpty) {
      return;
    }
    _usersStatus = SettingsUsersStatus.loading;
    _usersErrorMessage = null;
    notifyListeners();
    try {
      final users = await _repository.fetchUsers();
      users.sort(_compareUsers);
      _users = users;
      _usersStatus = SettingsUsersStatus.ready;
    } catch (error) {
      _usersStatus = SettingsUsersStatus.error;
      _usersErrorMessage = error.toString();
    }
    notifyListeners();
  }

  Future<AuthUser> updateUser(
    int userId, {
    String? role,
    bool? isFacilitiesManager,
  }) async {
    _savingUserIds.add(userId);
    notifyListeners();
    try {
      final updated = await _repository.updateUser(
        userId,
        role: role,
        isFacilitiesManager: isFacilitiesManager,
      );
      final users = List<AuthUser>.from(_users);
      final index = users.indexWhere((user) => user.id == userId);
      if (index >= 0) {
        users[index] = updated;
      } else {
        users.add(updated);
      }
      users.sort(_compareUsers);
      _users = users;
      _usersErrorMessage = null;
      _usersStatus = SettingsUsersStatus.ready;
      return updated;
    } catch (error) {
      _usersErrorMessage = error.toString();
      rethrow;
    } finally {
      _savingUserIds.remove(userId);
      notifyListeners();
    }
  }

  void initFromUser(AuthUser user) {
    _emailNotificationsEnabled = user.emailNotificationsEnabled;
    notifyListeners();
  }

  Future<void> setEmailNotifications(bool enabled) async {
    final previous = _emailNotificationsEnabled;
    _emailNotificationsEnabled = enabled;
    notifyListeners();
    try {
      await _repository.updateEmailNotifications(enabled);
    } catch (e) {
      _emailNotificationsEnabled = previous;
      notifyListeners();
      rethrow;
    }
  }
}

int _compareUsers(AuthUser a, AuthUser b) {
  final aSystem = a.role == 'system' ? 1 : 0;
  final bSystem = b.role == 'system' ? 1 : 0;
  if (aSystem != bSystem) return aSystem.compareTo(bSystem);
  final byName = a.name.toLowerCase().compareTo(b.name.toLowerCase());
  if (byName != 0) return byName;
  return a.email.toLowerCase().compareTo(b.email.toLowerCase());
}
