import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AutomationCatalogController } from "../controllers/automation_catalog_controller";
import { AutomationRulesController } from "../controllers/automation_rules_controller";
import { setDb } from "../database/db";
import { runMigrations } from "../database/migrations";
import type { AutomationSignal } from "../models/automation_signal";
import { AutomationRulesRepository } from "../repositories/automation_rules_repository";
import { AutomationSignalsRepository } from "../repositories/automation_signals_repository";
import { IntegrationAccountsRepository } from "../repositories/integration_accounts_repository";
import { ProjectInstancesRepository } from "../repositories/project_instances_repository";
import { ProjectTemplatesRepository } from "../repositories/project_templates_repository";
import { TasksRepository } from "../repositories/tasks_repository";
import { UsersRepository } from "../repositories/users_repository";

import { AutomationEngineService } from "./automation_engine_service";

describe("Automation overhaul backend", () => {
  beforeEach(() => {
    const db = new Database(":memory:");
    runMigrations(db);
    setDb(db);
    // Freeze time so time-sensitive filters (e.g. hoursSinceReceived) behave
    // consistently regardless of when tests run.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T18:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("creates a follow-up task from a matching unread Gmail signal", async () => {
    const usersRepo = new UsersRepository();
    const rulesRepo = new AutomationRulesRepository();
    const tasksRepo = new TasksRepository();
    const accountsRepo = new IntegrationAccountsRepository();
    const engine = new AutomationEngineService();
    const owner = usersRepo.create({
      name: "Alice",
      email: "alice@example.com",
    });
    const [gmailAccount] = accountsRepo.upsertGoogleAccount({
      ownerId: owner.id,
      externalAccountId: "google-user-1",
      email: "alice@example.com",
      displayName: "Alice",
      accessToken: "token",
      refreshToken: null,
      scope: "gmail.metadata",
      tokenType: "Bearer",
      expiresAt: null,
    });

    const rule = rulesRepo.create({
      name: "Unread finance follow-up",
      source: "gmail",
      triggerKey: "gmail.unread_message_matching_filter",
      triggerConfig: {
        sender: "finance@",
        subjectContains: "invoice",
        hoursSinceReceived: 48,
      },
      actionType: "create_task",
      actionConfig: {
        titleTemplate: "Follow up: {{subject}}",
        notesTemplate: "From {{sender}}",
        dueDaysOffset: 1,
      },
      ownerId: owner.id,
      sourceAccountId: gmailAccount.id,
    });

    const occurredAt = "2026-04-01T16:00:00.000Z";
    const signal: AutomationSignal = {
      id: "sig-1",
      provider: "gmail",
      signalType: "gmail_unread_message_seen",
      externalId: "msg-1",
      dedupeKey: "gmail:unread:msg-1",
      occurredAt,
      syncedAt: "2026-04-01T17:00:00.000Z",
      sourceAccountId: gmailAccount.id,
      sourceLabel: "alice@example.com",
      payload: {
        fromEmail: "finance@example.com",
        fromName: "Finance",
        subject: "Invoice approval needed",
        snippet: "Please approve the April invoice.",
        isUnread: true,
        receivedAt: occurredAt,
        threadId: "thread-1",
        labelIds: ["INBOX", "UNREAD"],
      },
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };

    const result = await engine.evaluateSignals("gmail", [signal]);

    expect(result.matchedRules).toBe(1);
    expect(result.executedActions).toBe(1);
    expect(result.matchesByRuleId[rule.id]).toBe(1);

    const tasks = tasksRepo.findAll(owner.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("Follow up: Invoice approval needed");
    expect(tasks[0]?.notes).toBe("From finance@example.com");
    expect(tasks[0]?.sourceType).toBe("automation_rule");
    expect(tasks[0]?.sourceId).toBe(`${rule.id}:gmail-thread:thread-1`);
    expect(tasks[0]?.dueDate).toBe("2026-04-02");

    const updatedRule = rulesRepo.findById(rule.id, owner.id);
    expect(updatedRule.matchCountLastRun).toBe(1);
    expect(updatedRule.previewSample).toMatchObject({
      fromEmail: "finance@example.com",
      subject: "Invoice approval needed",
    });
    expect(updatedRule.lastEvaluatedAt).not.toBeNull();
    expect(updatedRule.lastMatchedAt).not.toBeNull();
  });

  test("collapses matching Gmail messages in the same thread into one task", async () => {
    const usersRepo = new UsersRepository();
    const rulesRepo = new AutomationRulesRepository();
    const tasksRepo = new TasksRepository();
    const accountsRepo = new IntegrationAccountsRepository();
    const engine = new AutomationEngineService();
    const owner = usersRepo.create({
      name: "Alice",
      email: "alice@example.com",
    });
    const [gmailAccount] = accountsRepo.upsertGoogleAccount({
      ownerId: owner.id,
      externalAccountId: "google-user-1",
      email: "alice@example.com",
      displayName: "Alice",
      accessToken: "token",
      refreshToken: null,
      scope: "gmail.metadata",
      tokenType: "Bearer",
      expiresAt: null,
    });

    const rule = rulesRepo.create({
      name: "Worship follow-up",
      source: "gmail",
      triggerKey: "gmail.unread_message_matching_filter",
      triggerConfig: { sender: "worship@visaliacrc.com" },
      actionType: "create_task",
      actionConfig: {
        titleTemplate: "Respond to {{sender}}",
      },
      ownerId: owner.id,
      sourceAccountId: gmailAccount.id,
    });

    const signals: AutomationSignal[] = [
      {
        id: "sig-a",
        provider: "gmail",
        signalType: "gmail_unread_message_seen",
        externalId: "msg-a",
        dedupeKey: "gmail:unread:msg-a",
        occurredAt: "2026-04-01T16:00:00.000Z",
        syncedAt: "2026-04-01T17:00:00.000Z",
        sourceAccountId: gmailAccount.id,
        sourceLabel: "alice@example.com",
        payload: {
          fromEmail: "worship@visaliacrc.com",
          subject: "First message",
          isUnread: true,
          receivedAt: "2026-04-01T16:00:00.000Z",
          threadId: "thread-shared",
          labelIds: ["INBOX", "UNREAD"],
        },
        createdAt: "2026-04-01T17:00:00.000Z",
        updatedAt: "2026-04-01T17:00:00.000Z",
      },
      {
        id: "sig-b",
        provider: "gmail",
        signalType: "gmail_unread_message_seen",
        externalId: "msg-b",
        dedupeKey: "gmail:unread:msg-b",
        occurredAt: "2026-04-01T16:30:00.000Z",
        syncedAt: "2026-04-01T17:00:00.000Z",
        sourceAccountId: gmailAccount.id,
        sourceLabel: "alice@example.com",
        payload: {
          fromEmail: "worship@visaliacrc.com",
          subject: "Second message",
          isUnread: true,
          receivedAt: "2026-04-01T16:30:00.000Z",
          threadId: "thread-shared",
          labelIds: ["INBOX", "UNREAD"],
        },
        createdAt: "2026-04-01T17:00:00.000Z",
        updatedAt: "2026-04-01T17:00:00.000Z",
      },
    ];

    const result = await engine.evaluateSignals("gmail", signals);

    expect(result.matchedRules).toBe(1);
    expect(result.executedActions).toBe(2);

    const tasks = tasksRepo.findAll(owner.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.sourceId).toBe(`${rule.id}:gmail-thread:thread-shared`);
  });

  test("creates a project from a Planning Center special service signal", async () => {
    const templatesRepo = new ProjectTemplatesRepository();
    const instancesRepo = new ProjectInstancesRepository();
    const rulesRepo = new AutomationRulesRepository();
    const accountsRepo = new IntegrationAccountsRepository();
    const engine = new AutomationEngineService();
    const usersRepo = new UsersRepository();
    const owner = usersRepo.create({
      name: "Team",
      email: "team@church.test",
    });
    const pcoAccount = accountsRepo.upsertPlanningCenterAccount({
      ownerId: owner.id,
      externalAccountId: "pco-user-1",
      email: "team@church.test",
      displayName: "Team",
      accessToken: "token",
      refreshToken: null,
      scope: "services",
      tokenType: "Bearer",
      expiresAt: null,
    });

    const template = templatesRepo.create({
      name: "Special Service",
      anchorType: "date",
    });
    templatesRepo.addStep(template.id, {
      title: "Confirm volunteers",
      offsetDays: -7,
      sortOrder: 0,
    });

    rulesRepo.create({
      name: "Special service project",
      source: "planning_center",
      triggerKey: "planning_center.special_service_candidate",
      triggerConfig: { leadDays: 30 },
      actionType: "create_project_from_template",
      actionConfig: {
        templateName: "Special Service",
        projectNameTemplate: "{{title}} Project",
      },
      sourceAccountId: pcoAccount.id,
    });

    const signal: AutomationSignal = {
      id: "sig-2",
      provider: "planning_center",
      signalType: "special_service_candidate",
      externalId: "plan-42",
      dedupeKey: "planning_center:special:plan-42",
      occurredAt: "2026-04-03T00:00:00.000Z",
      syncedAt: "2026-04-01T17:00:00.000Z",
      sourceAccountId: pcoAccount.id,
      sourceLabel: "Planning Center",
      payload: {
        title: "Good Friday Service",
        serviceTypeName: "Worship",
        planDate: "2026-04-03",
        daysUntil: 2,
      },
      createdAt: "2026-04-01T17:00:00.000Z",
      updatedAt: "2026-04-01T17:00:00.000Z",
    };

    const result = await engine.evaluateSignals("planning_center", [signal]);

    expect(result.matchedRules).toBe(1);
    expect(result.executedActions).toBe(1);

    const instances = instancesRepo.findByTemplateId(template.id);
    expect(instances).toHaveLength(1);
    expect(instances[0]?.name).toBe("Good Friday Service Project");
    expect(instances[0]?.anchorDate).toBe("2026-04-03");
    expect(instances[0]?.steps).toHaveLength(1);
    expect(instances[0]?.steps[0]?.dueDate).toBe("2026-03-27");
  });

  test("matches Planning Center multi-trigger and multi-team filters", async () => {
    const rulesRepo = new AutomationRulesRepository();
    const tasksRepo = new TasksRepository();
    const engine = new AutomationEngineService();
    const usersRepo = new UsersRepository();
    const owner = usersRepo.create({
      name: "Planner",
      email: "planner@church.test",
    });

    const rule = rulesRepo.create({
      name: "Worship staffing prep",
      source: "planning_center",
      triggerKey: "planning_center.plan_published",
      triggerConfig: {
        triggerKeys: [
          "planning_center.plan_published",
          "planning_center.needed_position_open",
        ],
        teamIds: ["team-a", "team-b"],
        positionNames: ["Vocals"],
      },
      actionType: "create_task",
      actionConfig: {
        titleTemplate: "Prep {{position}} for {{title}}",
        targetDayOfWeek: 1,
      },
      ownerId: owner.id,
    });

    const signals: AutomationSignal[] = [
      {
        id: "sig-pco-match",
        provider: "planning_center",
        signalType: "needed_position_open",
        externalId: "needed-1",
        dedupeKey: "planning_center:needed:1",
        occurredAt: "2026-04-01T17:00:00.000Z",
        syncedAt: "2026-04-01T17:00:00.000Z",
        sourceAccountId: null,
        sourceLabel: "Planning Center",
        payload: {
          title: "Sunday Worship",
          planDate: "2026-04-12",
          teamId: "team-b",
          teamName: "Worship",
          positionName: "vocals",
        },
        createdAt: "2026-04-01T17:00:00.000Z",
        updatedAt: "2026-04-01T17:00:00.000Z",
      },
      {
        id: "sig-pco-wrong-team",
        provider: "planning_center",
        signalType: "needed_position_open",
        externalId: "needed-2",
        dedupeKey: "planning_center:needed:2",
        occurredAt: "2026-04-01T17:00:00.000Z",
        syncedAt: "2026-04-01T17:00:00.000Z",
        sourceAccountId: null,
        sourceLabel: "Planning Center",
        payload: {
          title: "Sunday Worship",
          planDate: "2026-04-12",
          teamId: "team-c",
          positionName: "Vocals",
        },
        createdAt: "2026-04-01T17:00:00.000Z",
        updatedAt: "2026-04-01T17:00:00.000Z",
      },
      {
        id: "sig-pco-wrong-trigger",
        provider: "planning_center",
        signalType: "service_item_updated",
        externalId: "item-1",
        dedupeKey: "planning_center:item:1",
        occurredAt: "2026-04-01T17:00:00.000Z",
        syncedAt: "2026-04-01T17:00:00.000Z",
        sourceAccountId: null,
        sourceLabel: "Planning Center",
        payload: {
          title: "Sunday Worship",
          planDate: "2026-04-12",
          teamId: "team-b",
          positionName: "Vocals",
        },
        createdAt: "2026-04-01T17:00:00.000Z",
        updatedAt: "2026-04-01T17:00:00.000Z",
      },
    ];

    const result = await engine.evaluateSignals("planning_center", signals);

    expect(result.matchedRules).toBe(1);
    expect(result.executedActions).toBe(1);
    expect(result.matchesByRuleId[rule.id]).toBe(1);

    const tasks = tasksRepo.findAll(owner.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("Prep vocals for Sunday Worship");
    expect(tasks[0]?.dueDate).toBe("2026-04-12");
    expect(tasks[0]?.scheduledDate).toBe("2026-04-06");
  });

  test("dedupes automation signals by dedupe key and refreshes payload on re-sync", () => {
    const repo = new AutomationSignalsRepository();

    const first = repo.upsertMany([
      {
        provider: "google_calendar",
        signalType: "calendar_event_seen",
        externalId: "event-1",
        dedupeKey: "google_calendar:seen:event-1",
        occurredAt: "2026-04-05T16:00:00.000Z",
        syncedAt: "2026-04-01T17:00:00.000Z",
        sourceAccountId: "calendar-account-1",
        sourceLabel: "team@example.com",
        payload: {
          title: "Rehearsal",
          location: "Sanctuary",
        },
      },
    ]);
    const second = repo.upsertMany([
      {
        provider: "google_calendar",
        signalType: "calendar_event_seen",
        externalId: "event-1",
        dedupeKey: "google_calendar:seen:event-1",
        occurredAt: "2026-04-05T16:00:00.000Z",
        syncedAt: "2026-04-01T18:00:00.000Z",
        sourceAccountId: "calendar-account-1",
        sourceLabel: "team@example.com",
        payload: {
          title: "Band Rehearsal",
          location: "Main Room",
        },
      },
    ]);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0]?.id).toBe(first[0]?.id);
    expect(repo.listRecent()).toHaveLength(1);
    expect(repo.findByDedupeKey("google_calendar:seen:event-1")).toMatchObject({
      syncedAt: "2026-04-01T18:00:00.000Z",
      payload: {
        title: "Band Rehearsal",
        location: "Main Room",
      },
    });
  });

  test("upsertManyDetailed ignores syncedAt-only refreshes when reporting changed signals", () => {
    const repo = new AutomationSignalsRepository();

    const first = repo.upsertManyDetailed([
      {
        provider: "google_calendar",
        signalType: "calendar_event_seen",
        externalId: "event-2",
        dedupeKey: "google_calendar:seen:event-2",
        occurredAt: "2026-04-05T16:00:00.000Z",
        syncedAt: "2026-04-01T17:00:00.000Z",
        sourceAccountId: "calendar-account-1",
        sourceLabel: "team@example.com",
        payload: {
          title: "Rehearsal",
          location: "Sanctuary",
        },
      },
    ]);

    const second = repo.upsertManyDetailed([
      {
        provider: "google_calendar",
        signalType: "calendar_event_seen",
        externalId: "event-2",
        dedupeKey: "google_calendar:seen:event-2",
        occurredAt: "2026-04-05T16:00:00.000Z",
        syncedAt: "2026-04-01T18:00:00.000Z",
        sourceAccountId: "calendar-account-1",
        sourceLabel: "team@example.com",
        payload: {
          title: "Rehearsal",
          location: "Sanctuary",
        },
      },
    ]);

    expect(first.changedSignals).toHaveLength(1);
    expect(second.changedSignals).toHaveLength(0);
    expect(second.signals).toHaveLength(1);
    expect(repo.findByDedupeKey("google_calendar:seen:event-2")).toMatchObject({
      syncedAt: "2026-04-01T18:00:00.000Z",
      payload: {
        title: "Rehearsal",
        location: "Sanctuary",
      },
    });
  });

  test("preview endpoint returns match metadata and catalog endpoints expose external providers", async () => {
    const usersRepo = new UsersRepository();
    const rulesRepo = new AutomationRulesRepository();
    const accountsRepo = new IntegrationAccountsRepository();
    const previewController = new AutomationRulesController();
    const catalogController = new AutomationCatalogController();
    const owner = usersRepo.create({
      name: "Alice",
      email: "alice@example.com",
    });
    const [calendarAccount] = accountsRepo.upsertGoogleAccount({
      ownerId: owner.id,
      externalAccountId: "google-user-1",
      email: "alice@example.com",
      displayName: "Alice",
      accessToken: "token",
      refreshToken: null,
      scope: "calendar.events.readonly",
      tokenType: "Bearer",
      expiresAt: null,
    });
    const rule = rulesRepo.create({
      name: "Calendar rehearsal",
      source: "google_calendar",
      triggerKey: "google_calendar.event_matching_filter",
      triggerConfig: { textQuery: "rehearsal", dateWindowDays: 7 },
      actionType: "create_task",
      actionConfig: { titleTemplate: "Prep for {{title}}" },
      ownerId: owner.id,
      sourceAccountId: calendarAccount.id,
    });
    rulesRepo.updateEvaluation(rule.id, {
      lastEvaluatedAt: "2026-04-01T18:00:00.000Z",
      lastMatchedAt: "2026-04-01T18:00:00.000Z",
      matchCountLastRun: 2,
      previewSample: {
        title: "Band rehearsal",
        startDate: "2026-04-02",
      },
    });

    const previewRes = createMockResponse();
    await previewController.getPreview(
      {
        params: { id: rule.id },
        auth: { user: owner },
      } as never,
      previewRes as never,
      (err?: unknown) => {
        if (err) throw err;
      },
    );

    expect(previewRes.statusCode).toBe(200);
    expect(previewRes.body).toMatchObject({
      ruleId: rule.id,
      matchCountLastRun: 2,
      summary:
        "When Calendar event matches filter from Google Calendar with match rehearsal, window 7 days then create task.",
      previewSample: {
        title: "Band rehearsal",
      },
    });

    const providersRes = createMockResponse();
    await catalogController.getProviders(
      {} as never,
      providersRes as never,
      (err?: unknown) => {
        if (err) throw err;
      },
    );

    expect(providersRes.statusCode).toBe(200);
    expect(providersRes.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "rhythm" }),
        expect.objectContaining({ source: "google_calendar" }),
        expect.objectContaining({ source: "gmail" }),
      ]),
    );
  });
});

function createMockResponse(): {
  statusCode: number;
  body: unknown;
  status(code: number): unknown;
  json(payload: unknown): unknown;
  send(payload?: unknown): unknown;
} {
  return {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    send(payload?: unknown) {
      this.body = payload;
      return this;
    },
  };
}
