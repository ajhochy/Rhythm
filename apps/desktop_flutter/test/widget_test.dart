import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/tasks/models/automation_rule.dart';
import 'package:rhythm_desktop/app/core/errors/app_error.dart';

void main() {
  group('AutomationRule', () {
    test('fromJson round-trips correctly', () {
      final json = {
        'id': 'abc-123',
        'name': 'Auto-schedule project steps',
        'triggerType': 'project_step_due',
        'triggerConfig': null,
        'actionType': 'auto_schedule',
        'actionConfig': null,
        'enabled': true,
        'createdAt': '2026-03-26T00:00:00.000Z',
        'updatedAt': '2026-03-26T00:00:00.000Z',
      };
      final rule = AutomationRule.fromJson(json);
      expect(rule.id, 'abc-123');
      expect(rule.name, 'Auto-schedule project steps');
      expect(rule.triggerType, 'project_step_due');
      expect(rule.actionType, 'auto_schedule');
      expect(rule.enabled, isTrue);
      expect(rule.triggerConfig, isNull);
    });

    test('triggerLabel returns human-readable string', () {
      expect(
        AutomationRule.triggerLabel('project_step_due'),
        'Project step is due',
      );
      expect(AutomationRule.triggerLabel('task_due'), 'Task is due');
      expect(AutomationRule.triggerLabel('plan_assembly'), 'Plan is assembled');
      expect(AutomationRule.triggerLabel('unknown'), 'unknown');
    });

    test('actionLabel returns human-readable string', () {
      expect(
        AutomationRule.actionLabel('auto_schedule'),
        'Auto-schedule to day',
      );
      expect(
        AutomationRule.actionLabel('send_notification'),
        'Send notification',
      );
      expect(AutomationRule.actionLabel('tag_task'), 'Tag task');
    });

    test('defaults enabled to true when missing from json', () {
      final json = {
        'id': 'x',
        'name': 'Rule',
        'triggerType': 'task_due',
        'actionType': 'tag_task',
        'createdAt': '',
        'updatedAt': '',
      };
      final rule = AutomationRule.fromJson(json);
      expect(rule.enabled, isTrue);
    });
  });

  group('AppError', () {
    test('toString returns message', () {
      final e = AppError('Something went wrong');
      expect(e.toString(), 'Something went wrong');
    });

    test('notFound factory sets correct code and statusCode', () {
      final e = AppError.notFound('Task');
      expect(e.message, 'Task not found');
      expect(e.code, 'NOT_FOUND');
      expect(e.statusCode, 404);
    });

    test('badRequest factory sets correct code and statusCode', () {
      final e = AppError.badRequest('title is required');
      expect(e.message, 'title is required');
      expect(e.code, 'BAD_REQUEST');
      expect(e.statusCode, 400);
    });
  });
}
