import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/tasks/data/tasks_local_data_source.dart';

void main() {
  test(
      'issue-1475: fetchAll explicitly requests completed and deferred history',
      () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(server.close);
    final requestFuture = server.first;
    final resultFuture = TasksLocalDataSource(
      baseUrl: 'http://${server.address.address}:${server.port}',
    ).fetchAll();
    final request = await requestFuture;
    expect(request.uri.path, '/tasks');
    expect(request.uri.queryParameters['status'], 'all');
    request.response
      ..headers.contentType = ContentType.json
      ..write('[]');
    await request.response.close();

    expect(await resultFuture, isEmpty);
  });
}
