import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/agents/models/usage_budget.dart';

void main() {
  group('UsageBudgetSnapshot.fromJson', () {
    test('parses the real /agents/usage-budget shape', () {
      final json = {
        'fetchedAt': '2026-06-25T19:18:15.909Z',
        'providers': [
          {
            'provider': 'anthropic',
            'label': 'Anthropic',
            'kind': 'window',
            'items': [
              {
                'label': '5h limit',
                'remainingFraction': 0.89,
                'resetAt': '2026-06-25T23:30:00.000Z',
                'detail': 'allowed',
              },
              {
                'label': 'weekly',
                'remainingFraction': 0.95,
                'resetAt': '2026-07-02T02:00:00.000Z',
              },
            ],
          },
          {
            'provider': 'openrouter',
            'label': 'OpenRouter',
            'kind': 'credits',
            'items': [
              {
                'label': 'credits',
                'remainingFraction': 0.9957,
                'detail': r'$0.04 / $10.00',
              },
            ],
          },
          {
            'provider': 'openai',
            'label': 'OpenAI',
            'kind': 'unavailable',
            'items': <dynamic>[],
            'reason': 'No usage API for the ChatGPT-plan token',
          },
        ],
      };

      final snap = UsageBudgetSnapshot.fromJson(json);

      expect(snap.providers, hasLength(3));
      expect(snap.fetchedAt, isNotNull);

      final anthropic = snap.providers[0];
      expect(anthropic.provider, 'anthropic');
      expect(anthropic.kind, 'window');
      expect(anthropic.isUnavailable, isFalse);
      expect(anthropic.items, hasLength(2));
      expect(anthropic.items.first.remainingFraction, closeTo(0.89, 1e-9));
      expect(anthropic.items.first.resetAt, isNotNull);
      // Item without resetAt parses to null, not a throw.
      expect(anthropic.items[1].resetAt, isNotNull);

      final openrouter = snap.providers[1];
      expect(openrouter.kind, 'credits');
      expect(openrouter.items.first.detail, r'$0.04 / $10.00');

      final openai = snap.providers[2];
      expect(openai.isUnavailable, isTrue);
      expect(openai.items, isEmpty);
      expect(openai.reason, contains('ChatGPT-plan'));
    });

    // #907 — multiple Anthropic accounts each surface their OWN provider
    // entry (not merged), distinguished by accountId + a per-account label.
    test('parses multiple anthropic entries as separate providers', () {
      final json = {
        'providers': [
          {
            'provider': 'anthropic',
            'label': 'Anthropic — Personal',
            'kind': 'window',
            'accountId': 'acct-personal',
            'items': [
              {'label': '5h limit', 'remainingFraction': 0.8},
            ],
          },
          {
            'provider': 'anthropic',
            'label': 'Anthropic — Team',
            'kind': 'window',
            'accountId': 'acct-team',
            'items': [
              {'label': '5h limit', 'remainingFraction': 0.2},
            ],
          },
        ],
      };

      final snap = UsageBudgetSnapshot.fromJson(json);
      final anthropicEntries =
          snap.providers.where((p) => p.provider == 'anthropic').toList();

      expect(anthropicEntries, hasLength(2));
      expect(anthropicEntries.map((p) => p.accountId).toSet(),
          {'acct-personal', 'acct-team'});
      expect(anthropicEntries.map((p) => p.label).toSet(),
          {'Anthropic — Personal', 'Anthropic — Team'});
      expect(
        anthropicEntries
            .firstWhere((p) => p.accountId == 'acct-team')
            .items
            .first
            .remainingFraction,
        closeTo(0.2, 1e-9),
      );
    });

    test('tolerates missing/empty fields', () {
      final snap = UsageBudgetSnapshot.fromJson({});
      expect(snap.providers, isEmpty);
      expect(snap.fetchedAt, isNull);

      final p = UsageBudgetProvider.fromJson({'provider': 'x'});
      expect(p.kind, 'unavailable');
      expect(p.items, isEmpty);

      final item = UsageBudgetItem.fromJson({'label': 'm'});
      expect(item.remainingFraction, isNull);
      expect(item.resetAt, isNull);
    });
  });
}
