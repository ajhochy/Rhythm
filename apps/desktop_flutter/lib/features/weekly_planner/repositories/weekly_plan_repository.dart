import '../../tasks/models/task.dart';
import '../data/weekly_plan_data_source.dart';
import '../models/weekly_plan.dart';

class WeeklyPlanRepository {
  WeeklyPlanRepository(this._dataSource);

  final WeeklyPlanDataSource _dataSource;

  Future<WeeklyPlan> fetchPlan(String weekLabel) =>
      _dataSource.fetchPlan(weekLabel);

  Future<Task> scheduleTask(String taskId, String date,
          {bool locked = false}) =>
      _dataSource.scheduleTask(taskId, date, locked: locked);

  Future<Task> updateTask(String taskId, {String? notes, String? status}) =>
      _dataSource.updateTask(taskId, notes: notes, status: status);
}
