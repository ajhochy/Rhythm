import '../data/run_quality_data_source.dart';
import '../models/agent_run_quality.dart';

class RunQualityRepository {
  RunQualityRepository(this._dataSource);

  final RunQualityDataSource _dataSource;

  Future<RunQualityRollup> getRollup({int? windowDays}) =>
      _dataSource.getRollup(windowDays: windowDays);
}
