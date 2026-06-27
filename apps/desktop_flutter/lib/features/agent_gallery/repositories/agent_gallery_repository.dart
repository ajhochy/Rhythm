import '../data/agent_gallery_data_source.dart';
import '../models/agent_design.dart';

class AgentGalleryRepository {
  AgentGalleryRepository(this._dataSource);

  final AgentGalleryDataSource _dataSource;

  Future<List<AgentDesign>> list() => _dataSource.list();
}
