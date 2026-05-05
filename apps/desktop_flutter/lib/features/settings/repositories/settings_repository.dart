import '../../../app/core/auth/auth_user.dart';
import '../data/settings_data_source.dart';
import '../data/user_preferences_data_source.dart';

class SettingsRepository {
  SettingsRepository(
    this._dataSource, {
    UserPreferencesDataSource? userPreferencesDataSource,
  }) : _userPreferencesDataSource =
            userPreferencesDataSource ?? UserPreferencesDataSource();

  final SettingsDataSource _dataSource;
  final UserPreferencesDataSource _userPreferencesDataSource;

  Future<List<AuthUser>> fetchUsers() => _dataSource.fetchUsers();

  Future<AuthUser> updateUser(
    int userId, {
    String? role,
    bool? isFacilitiesManager,
  }) {
    return _dataSource.updateUser(
      userId,
      role: role,
      isFacilitiesManager: isFacilitiesManager,
    );
  }

  Future<void> updateEmailNotifications(bool enabled) async {
    await _userPreferencesDataSource.updateEmailNotifications(enabled);
  }
}
