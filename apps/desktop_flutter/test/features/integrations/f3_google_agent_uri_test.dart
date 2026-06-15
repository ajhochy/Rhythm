import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/integrations/data/integrations_data_source.dart';

void main() {
  test('googleAgentBeginUri targets /auth/google/begin with intent=agent', () {
    final ds = IntegrationsDataSource(baseUrl: 'https://api.example.com');
    final uri = ds.googleAgentBeginUri();
    expect(uri.path, '/auth/google/begin');
    expect(uri.queryParameters['intent'], 'agent');
  });
}
