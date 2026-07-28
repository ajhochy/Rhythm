import { describe, expect, test } from "bun:test"

type SchedulerConfig = {
  maxConcurrency?: number
  providerLimits?: Record<string, number>
}

type AcquireInput = {
  sessionID: string
  parentSessionID?: string
  providerID: string
  modelID: string
  config?: SchedulerConfig
  signal?: AbortSignal
}

type Lease = {
  release(reason?: string): void
}

type DiagnosticWork = {
  sessionID: string
  providerID: string
  modelID: string
  rootSessionID: string
  reason?: string
  waitMs?: number
}

type SchedulerSnapshot = {
  maxConcurrency: number
  active: number
  queued: number
  activeWork: DiagnosticWork[]
  queuedWork: DiagnosticWork[]
}

type Scheduler = {
  acquire(input: AcquireInput): Promise<Lease>
  configure(config: SchedulerConfig): void
  yieldSession(sessionID: string): boolean
  reportBackpressure(providerID: string, delayMs: number, reason?: string): void
  snapshot(): SchedulerSnapshot
}

type SchedulerModule = {
  createModelStreamScheduler(config?: SchedulerConfig): Scheduler
  providerBackpressureDelay(error: unknown): number | undefined
}

async function schedulerModule(): Promise<SchedulerModule | undefined> {
  return import("./model-stream-scheduler")
    .then((value) => value as unknown as SchedulerModule)
    .catch(() => undefined)
}

async function scheduler(config?: SchedulerConfig): Promise<Scheduler> {
  const module = await schedulerModule()
  expect(
    module?.createModelStreamScheduler,
    "scheduler implementation must exist before the contract can pass",
  ).toBeFunction()
  return module!.createModelStreamScheduler(config)
}

function pendingAfter<T>(promise: Promise<T>, ms = 20): Promise<boolean> {
  return Promise.race([
    promise.then(() => false),
    new Promise<true>((resolve) => setTimeout(() => resolve(true), ms)),
  ])
}

describe("issue #1164 model stream scheduler contract", () => {
  test("issue-1164-c1: admits 50 sibling readers from one parent without deadlock", async () => {
    const subject = await scheduler()
    const parent = await subject.acquire({
      sessionID: "parent",
      providerID: "openai",
      modelID: "orchestrator",
    })
    expect(subject.yieldSession("parent")).toBe(true)
    const leases = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        subject.acquire({
          sessionID: `reader-${index}`,
          parentSessionID: "parent",
          providerID: index % 2 === 0 ? "openai" : "anthropic",
          modelID: `reader-model-${index}`,
        }),
      ),
    )

    expect(leases).toHaveLength(50)
    expect(subject.snapshot()).toMatchObject({ maxConcurrency: 50, active: 50, queued: 0 })
    leases.forEach((lease) => lease.release("test complete"))
    parent.release()
  })

  test("issue-1164-c2: waiting parents yield capacity to nested children", async () => {
    const subject = await scheduler({ maxConcurrency: 2 })
    const parentA = await subject.acquire({
      sessionID: "parent-a",
      providerID: "openai",
      modelID: "parent",
    })
    const parentB = await subject.acquire({
      sessionID: "parent-b",
      providerID: "anthropic",
      modelID: "parent",
    })

    expect(subject.yieldSession("parent-a")).toBe(true)
    expect(subject.yieldSession("parent-b")).toBe(true)

    const [childA, childB] = await Promise.all([
      subject.acquire({
        sessionID: "child-a",
        parentSessionID: "parent-a",
        providerID: "openai",
        modelID: "reader",
      }),
      subject.acquire({
        sessionID: "child-b",
        parentSessionID: "parent-b",
        providerID: "anthropic",
        modelID: "reader",
      }),
    ])
    expect(subject.snapshot()).toMatchObject({ active: 2, queued: 0 })

    childA.release()
    childB.release()
    parentA.release()
    parentB.release()
  })

  test("issue-1164-c3: schedules all provider identifiers through the same global capacity", async () => {
    const subject = await scheduler({ maxConcurrency: 4 })
    const providers = ["openai", "anthropic", "google", "custom-litellm"]
    const leases = await Promise.all(
      providers.map((providerID) =>
        subject.acquire({
          sessionID: `session-${providerID}`,
          providerID,
          modelID: "model",
        }),
      ),
    )

    expect(subject.snapshot().activeWork.map((work) => work.providerID).sort()).toEqual(providers.sort())
    leases.forEach((lease) => lease.release())
  })

  test("issue-1164-c4: defaults to 50 and honors a lower configured limit", async () => {
    const subject = await scheduler()
    expect(subject.snapshot().maxConcurrency).toBe(50)
    subject.configure({ maxConcurrency: 2 })

    const first = await subject.acquire({ sessionID: "one", providerID: "p", modelID: "m" })
    const second = await subject.acquire({ sessionID: "two", providerID: "p", modelID: "m" })
    const thirdPromise = subject.acquire({ sessionID: "three", providerID: "p", modelID: "m" })
    expect(await pendingAfter(thirdPromise)).toBe(true)

    first.release()
    const third = await thirdPromise
    expect(subject.snapshot()).toMatchObject({ maxConcurrency: 2, active: 2, queued: 0 })
    second.release()
    third.release()
  })

  test("issue-1164-c5: provider backpressure blocks only the affected provider", async () => {
    const subject = await scheduler({ maxConcurrency: 2 })
    const module = await schedulerModule()
    const delay = module?.providerBackpressureDelay({
      statusCode: 429,
      responseHeaders: { "retry-after": "0.06" },
    })
    expect(delay).toBe(60)
    subject.reportBackpressure("openai", delay!, "provider_429")

    const throttled = subject.acquire({
      sessionID: "openai-work",
      providerID: "openai",
      modelID: "gpt",
    })
    const unrelated = await subject.acquire({
      sessionID: "anthropic-work",
      providerID: "anthropic",
      modelID: "claude",
    })

    expect(await pendingAfter(throttled)).toBe(true)
    expect(subject.snapshot().queuedWork[0]).toMatchObject({
      sessionID: "openai-work",
      reason: "provider_backpressure",
    })

    const resumed = await throttled
    unrelated.release()
    resumed.release()
  })

  test("issue-1164-c6: round-robin roots admit an interactive turn before queued swarm work", async () => {
    const subject = await scheduler({ maxConcurrency: 1 })
    const running = await subject.acquire({
      sessionID: "swarm-1",
      parentSessionID: "swarm-root",
      providerID: "openai",
      modelID: "reader",
    })
    const nextSwarm = subject.acquire({
      sessionID: "swarm-2",
      parentSessionID: "swarm-root",
      providerID: "openai",
      modelID: "reader",
    })
    const interactive = subject.acquire({
      sessionID: "interactive",
      providerID: "anthropic",
      modelID: "chat",
    })

    running.release()
    const interactiveLease = await Promise.race([
      interactive,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("interactive turn starved")), 100)),
    ])
    expect(subject.snapshot().activeWork[0]?.sessionID).toBe("interactive")

    interactiveLease.release()
    const swarmLease = await nextSwarm
    swarmLease.release()
  })

  test("issue-1164-c7: cancellation removes queued work and releases active capacity", async () => {
    const subject = await scheduler({ maxConcurrency: 1 })
    const parent = await subject.acquire({
      sessionID: "parent",
      providerID: "openai",
      modelID: "parent",
    })
    const abort = new AbortController()
    const child = subject.acquire({
      sessionID: "child",
      parentSessionID: "parent",
      providerID: "openai",
      modelID: "child",
      signal: abort.signal,
    })
    abort.abort()

    await expect(child).rejects.toThrow()
    expect(subject.yieldSession("parent")).toBe(true)
    parent.release()
    expect(subject.snapshot()).toMatchObject({ active: 0, queued: 0 })
  })

  test("issue-1164-c8: diagnostics expose ownership and queue wait reasons", async () => {
    const subject = await scheduler({ maxConcurrency: 1 })
    const active = await subject.acquire({
      sessionID: "owner",
      providerID: "openai",
      modelID: "gpt",
    })
    const queued = subject.acquire({
      sessionID: "waiter",
      parentSessionID: "other-root",
      providerID: "anthropic",
      modelID: "claude",
    })

    const snapshot = subject.snapshot()
    expect(snapshot.activeWork[0]).toMatchObject({
      sessionID: "owner",
      providerID: "openai",
      modelID: "gpt",
      rootSessionID: "owner",
    })
    expect(snapshot.queuedWork[0]).toMatchObject({
      sessionID: "waiter",
      rootSessionID: "other-root",
      reason: "global_capacity",
    })
    expect(snapshot.queuedWork[0]?.waitMs).toBeGreaterThanOrEqual(0)

    active.release()
    const queuedLease = await queued
    queuedLease.release()
  })

  test("issue-1164-c9: combined lifecycle preserves capacity across nested backpressure and cancellation", async () => {
    const subject = await scheduler({ maxConcurrency: 2, providerLimits: { openai: 1 } })
    const parentA = await subject.acquire({
      sessionID: "root-a",
      providerID: "openai",
      modelID: "parent",
    })
    const parentB = await subject.acquire({
      sessionID: "root-b",
      providerID: "anthropic",
      modelID: "parent",
    })
    expect(subject.yieldSession("root-a")).toBe(true)
    subject.reportBackpressure("openai", 100, "provider_429")

    const abort = new AbortController()
    const blockedChild = subject.acquire({
      sessionID: "child-a",
      parentSessionID: "root-a",
      providerID: "openai",
      modelID: "reader",
      signal: abort.signal,
    })
    const interactive = await subject.acquire({
      sessionID: "interactive",
      providerID: "google",
      modelID: "chat",
    })
    abort.abort()
    await expect(blockedChild).rejects.toThrow()

    interactive.release()
    parentA.release()
    parentB.release()
    expect(subject.snapshot()).toMatchObject({ active: 0, queued: 0 })
  })
})
