import '../data/notifications_data_source.dart';
import '../models/app_notification.dart';

class NotificationsRepository {
  NotificationsRepository(this._dataSource);

  final NotificationsDataSource _dataSource;

  Future<List<AppNotification>> getUnread() => _dataSource.fetchUnread();

  Future<void> markRead(int id) => _dataSource.markRead(id);

  Future<void> markAllRead() => _dataSource.markAllRead();
}
