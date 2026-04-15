import '../../../features/tasks/models/recurring_task_rule.dart';
import '../data/rhythms_data_source.dart';
import '../../../app/core/auth/auth_user.dart';

class RhythmsRepository {
  RhythmsRepository(this._dataSource);

  final RhythmsDataSource _dataSource;

  Future<List<RecurringTaskRule>> getAll() => _dataSource.fetchAll();

  Future<List<AuthUser>> getUsers() => _dataSource.fetchUsers();

  Future<RecurringTaskRule> create({
    required String title,
    required String frequency,
    int? dayOfWeek,
    int? dayOfMonth,
    int? month,
    bool? sequential,
    List<RecurringTaskRuleStep>? steps,
  }) => _dataSource.create(
    title: title,
    frequency: frequency,
    dayOfWeek: dayOfWeek,
    dayOfMonth: dayOfMonth,
    month: month,
    sequential: sequential,
    steps: steps,
  );

  Future<RecurringTaskRule> update(
    String id, {
    String? title,
    String? frequency,
    int? dayOfWeek,
    int? dayOfMonth,
    int? month,
    bool? enabled,
    bool? sequential,
    List<RecurringTaskRuleStep>? steps,
  }) => _dataSource.update(
    id,
    title: title,
    frequency: frequency,
    dayOfWeek: dayOfWeek,
    dayOfMonth: dayOfMonth,
    month: month,
    enabled: enabled,
    sequential: sequential,
    steps: steps,
  );

  Future<void> delete(String id) => _dataSource.delete(id);
}
