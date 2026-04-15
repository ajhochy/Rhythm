import '../../tasks/models/task.dart';
import '../data/weekly_plan_data_source.dart';
import '../models/weekly_plan.dart';

class WeeklyPlanRepository {
  WeeklyPlanRepository(this._dataSource);

  final WeeklyPlanDataSource _dataSource;

  Future<WeeklyPlan> fetchPlan(String weekLabel) =>
      _dataSource.fetchPlan(weekLabel);

  Future<Task> scheduleTask(
    String taskId,
    String date, {
    bool locked = false,
    int? scheduledOrder,
  }) => _dataSource.scheduleTask(
    taskId,
    date,
    locked: locked,
    scheduledOrder: scheduledOrder,
  );

  Future<Task> updateTask(
    String taskId, {
    String? notes,
    String? status,
    String? dueDate,
    String? scheduledDate,
    int? scheduledOrder,
    String? sourceType,
  }) => _dataSource.updateTask(
    taskId,
    notes: notes,
    status: status,
    dueDate: dueDate,
    scheduledDate: scheduledDate,
    scheduledOrder: scheduledOrder,
    sourceType: sourceType,
  );

  Future<void> createTask(String title, {String? dueDate}) {
    return _dataSource.createTask(title, dueDate: dueDate);
  }
}
