import 'package:flutter/foundation.dart';

import '../models/agent_design.dart';
import '../repositories/agent_gallery_repository.dart';

enum AgentGalleryStatus { idle, loading, error }

class AgentGalleryController extends ChangeNotifier {
  AgentGalleryController(this._repository);

  final AgentGalleryRepository _repository;

  List<AgentDesign> _designs = [];
  AgentGalleryStatus _status = AgentGalleryStatus.idle;
  String? _error;

  List<AgentDesign> get designs => _designs;
  AgentGalleryStatus get status => _status;
  String? get error => _error;

  Future<void> loadDesigns() async {
    _status = AgentGalleryStatus.loading;
    _error = null;
    notifyListeners();

    try {
      _designs = await _repository.list();
      _status = AgentGalleryStatus.idle;
    } catch (e) {
      _error = e.toString();
      _status = AgentGalleryStatus.error;
    }
    notifyListeners();
  }
}
