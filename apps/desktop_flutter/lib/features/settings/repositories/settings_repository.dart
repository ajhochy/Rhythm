import '../../../app/core/auth/auth_user.dart';
import '../data/settings_data_source.dart';

class SettingsRepository {
  SettingsRepository(this._dataSource);

  final SettingsDataSource _dataSource;

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
}
