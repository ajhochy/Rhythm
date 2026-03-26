import '../../../features/tasks/models/recurring_task_rule.dart';
import '../data/rhythms_data_source.dart';

class RhythmsRepository {
  RhythmsRepository(this._dataSource);

  final RhythmsDataSource _dataSource;

  Future<List<RecurringTaskRule>> getAll() => _dataSource.fetchAll();

  Future<RecurringTaskRule> create({
    required String title,
    required String frequency,
    int? dayOfWeek,
    int? dayOfMonth,
    int? month,
  }) =>
      _dataSource.create(
        title: title,
        frequency: frequency,
        dayOfWeek: dayOfWeek,
        dayOfMonth: dayOfMonth,
        month: month,
      );

  Future<void> delete(String id) => _dataSource.delete(id);
}
