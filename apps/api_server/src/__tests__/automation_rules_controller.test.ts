import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { NextFunction, Request, Response } from "express";
import { runMigrations } from "../database/migrations";
import { setDb } from "../database/db";
import { AutomationRulesController } from "../controllers/automation_rules_controller";
import { UsersRepository } from "../repositories/users_repository";

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  runMigrations(db);
  return db;
}

function makeResponse() {
  const state: { statusCode: number; body: unknown } = {
    statusCode: 200,
    body: null,
  };

  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
  } as unknown as Response;

  return { res, state };
}

describe("AutomationRulesController", () => {
  let usersRepo: UsersRepository;
  let controller: AutomationRulesController;
  let nextCalledWith: unknown;
  let next: NextFunction;

  beforeEach(() => {
    setDb(makeDb());
    usersRepo = new UsersRepository();
    controller = new AutomationRulesController();
    nextCalledWith = undefined;
    next = ((err?: unknown) => {
      nextCalledWith = err;
    }) as NextFunction;
  });

  it("persists conditions on create and update", () => {
    const user = usersRepo.create({
      name: "Alice",
      email: "alice@example.com",
    });
    const createReq = {
      body: {
        name: "Upcoming plan notification",
        source: "planning_center",
        triggerKey: "planning_center.plan_upcoming",
        triggerConfig: { serviceType: "Sunday Worship" },
        actionType: "send_notification",
        actionConfig: { messageTemplate: "Plan soon" },
        enabled: true,
        conditions: [
          {
            field: "serviceTypeName",
            operator: "equals",
            value: "Sunday Worship",
          },
        ],
      },
      auth: { user },
    } as Request;
    const { res: createRes, state: createState } = makeResponse();

    controller.create(createReq, createRes, next);

    expect(nextCalledWith).toBeUndefined();
    expect(createState.statusCode).toBe(201);
    expect(createState.body).toMatchObject({
      conditions: [
        {
          field: "serviceTypeName",
          operator: "equals",
          value: "Sunday Worship",
        },
      ],
    });

    const created = createState.body as { id: string };
    const updateReq = {
      params: { id: created.id },
      body: {
        conditions: [
          {
            field: "serviceTypeName",
            operator: "contains",
            value: "Worship",
          },
        ],
      },
      auth: { user },
    } as unknown as Request;
    const { res: updateRes, state: updateState } = makeResponse();

    controller.update(updateReq, updateRes, next);

    expect(nextCalledWith).toBeUndefined();
    expect(updateState.statusCode).toBe(200);
    expect(updateState.body).toMatchObject({
      conditions: [
        {
          field: "serviceTypeName",
          operator: "contains",
          value: "Worship",
        },
      ],
    });
  });
});
