---
name: scaffold-flutter-feature
description: Scaffold a new Flutter feature module in apps/desktop_flutter following Rhythm's exact layered pattern (view/controller/repository/data-source/model + Provider wiring). Use when adding a new screen or feature area to the desktop app, or when the user says "add a feature", "new module", "scaffold a screen".
---

# Scaffold a Flutter Feature Module

Rhythm's desktop app uses one rigid layered pattern for every feature. This skill
generates a new feature that matches it exactly, so it passes `REVIEW.md` §1 on the
first try. Do not invent a different structure.

## Before you start

Ask (or infer from the request):
- **Feature name** in `snake_case` (e.g. `announcements`) and its `PascalCase` form (`Announcements`).
- **API resource path** (e.g. `/announcements`) and whether it's a **production**
  resource (uses `serverConfigService.url`) or an **agent-local** resource
  (hard-codes `AppConstants.agentLocalBaseUrl` — see `CLAUDE.md` dual-endpoint rule).
- **Model fields** with types.
- **Nav index** if it gets a sidebar entry (add a `navXxx` constant in
  `app_constants.dart` and keep `NavigationSidebar` order in sync).

Run `impact` via GitNexus on `main.dart` / `AppConstants` before editing them.

## Files to create

Under `apps/desktop_flutter/lib/features/<feature>/`:

```
models/<feature>.dart
data/<feature>_data_source.dart
repositories/<feature>_repository.dart
controllers/<feature>_controller.dart
views/<feature>_view.dart
```

### 1. `models/<feature>.dart`
Plain Dart class. Parse with the shared helpers, never raw casts:

```dart
import '../../../app/core/utils/json_parsing.dart';

class Feature {
  Feature({required this.id, required this.title});

  factory Feature.fromJson(Map<String, dynamic> json) {
    return Feature(
      id: asString(json['id']) ?? '',
      title: asString(json['title']) ?? '',
    );
  }

  final String id;
  final String title;

  Map<String, dynamic> toJson() => {'id': id, 'title': title};
}
```

### 2. `data/<feature>_data_source.dart`
Only layer that touches `http`. Takes `baseUrl`, attaches auth headers, `assertOk`.

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/feature.dart';

class FeatureDataSource {
  FeatureDataSource({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;
  // Agent-local resource instead? default to AppConstants.agentLocalBaseUrl.

  final String _baseUrl;

  Future<List<Feature>> fetchAll() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/features'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list.map((j) => Feature.fromJson(j as Map<String, dynamic>)).toList();
  }
}
```

### 3. `repositories/<feature>_repository.dart`
Thin — delegates to the data source, maps DTOs to models.

```dart
import '../data/feature_data_source.dart';
import '../models/feature.dart';

class FeatureRepository {
  FeatureRepository(this._dataSource);
  final FeatureDataSource _dataSource;

  Future<List<Feature>> getAll() => _dataSource.fetchAll();
}
```

### 4. `controllers/<feature>_controller.dart`
`ChangeNotifier` + status enum. `notifyListeners()` on every transition.

```dart
import 'package:flutter/foundation.dart';
import '../models/feature.dart';
import '../repositories/feature_repository.dart';

enum FeatureStatus { idle, loading, error }

class FeatureController extends ChangeNotifier {
  FeatureController(this._repository);
  final FeatureRepository _repository;

  List<Feature> _items = [];
  FeatureStatus _status = FeatureStatus.idle;
  String? _errorMessage;

  List<Feature> get items => _items;
  FeatureStatus get status => _status;
  String? get errorMessage => _errorMessage;

  Future<void> load() async {
    _status = FeatureStatus.loading;
    _errorMessage = null;
    notifyListeners();
    try {
      _items = await _repository.getAll();
      _status = FeatureStatus.idle;
    } catch (e) {
      _errorMessage = e.toString();
      _status = FeatureStatus.error;
    }
    notifyListeners();
  }
}
```

### 5. `views/<feature>_view.dart`
`StatefulWidget`; loads via `addPostFrameCallback`; consumes the controller;
uses theme tokens; renders errors through the shared `error_banner`.

```dart
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../app/core/widgets/error_banner.dart';
import '../controllers/feature_controller.dart';

class FeatureView extends StatefulWidget {
  const FeatureView({super.key});
  @override
  State<FeatureView> createState() => _FeatureViewState();
}

class _FeatureViewState extends State<FeatureView> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback(
      (_) => context.read<FeatureController>().load(),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<FeatureController>(
      builder: (context, controller, _) {
        // TODO: build UI with Theme.of(context).colorScheme tokens.
        return const SizedBox.shrink();
      },
    );
  }
}
```

## Wiring (required — the module is dead without it)

1. **`main.dart`**: add three imports (controller, data source, repository) and a
   `ChangeNotifierProvider` that builds
   `FeatureController(FeatureRepository(FeatureDataSource(baseUrl: serverConfigService.url)))`.
   For agent-local features omit the `baseUrl` override so it defaults to
   `agentLocalBaseUrl`.
2. **Nav (optional)**: add `navFeature` to `AppConstants`, a `NavigationSidebar`
   item in the same order, and a case in `app_shell.dart`'s body switch.

## Finish

- `dart format .` then `flutter analyze --no-fatal-infos` then `flutter test`.
- Add the endpoint row to the table in `CLAUDE.md` if it's a new API path.
- Walk `REVIEW.md` §1–§3. Leave the PR open (do not merge).
