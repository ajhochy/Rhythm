import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "model-stream-scheduler" })

export const DEFAULT_MODEL_STREAM_CONCURRENCY = 50
const DEFAULT_BACKPRESSURE_MS = 1_000
const MAX_BACKPRESSURE_MS = 60_000

export type ModelStreamSchedulerConfig = {
  maxConcurrency?: number
  providerLimits?: Record<string, number>
}

export type ModelStreamRequest = {
  sessionID: string
  parentSessionID?: string
  providerID: string
  modelID: string
  signal?: AbortSignal
}

export type ModelStreamWaitReason =
  | "global_capacity"
  | "provider_capacity"
  | "provider_backpressure"
  | "fair_share"

export type ModelStreamDiagnostic = {
  leaseID?: string
  sessionID: string
  parentSessionID?: string
  rootSessionID: string
  providerID: string
  modelID: string
  queuedAt?: number
  acquiredAt?: number
  waitMs: number
  reason?: ModelStreamWaitReason
  detail?: string
}

export type ModelStreamSchedulerSnapshot = {
  maxConcurrency: number
  active: number
  queued: number
  activeWork: ModelStreamDiagnostic[]
  queuedWork: ModelStreamDiagnostic[]
  providerLimits: Record<string, number>
  providerBackpressure: Record<string, { blockedUntil: number; reason: string }>
}

export type ModelStreamLease = {
  readonly id: string
  release(reason?: string): void
}

type Pending = ModelStreamRequest & {
  id: string
  rootSessionID: string
  queuedAt: number
  resolve: (lease: ModelStreamLease) => void
  reject: (error: Error) => void
  onAbort?: () => void
}

type Active = {
  pending: Pending
  acquiredAt: number
  release: (reason?: string) => void
}

type Backpressure = {
  blockedUntil: number
  reason: string
}

function positiveInt(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value < 1) return fallback
  return Math.floor(value)
}

function abortError(): Error {
  return new DOMException("Model stream scheduler wait aborted", "AbortError")
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  if (!headers || typeof headers !== "object") return
  const record = headers as Record<string, unknown>
  const value = record[name] ?? record[name.toLowerCase()]
  return typeof value === "string" ? value : undefined
}

function retryAfterMs(value: string | undefined): number | undefined {
  if (!value) return
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
  const at = Date.parse(value)
  if (Number.isFinite(at)) return Math.max(0, at - Date.now())
}

function errorRecord(error: unknown): Record<string, unknown> | undefined {
  return error && typeof error === "object" ? (error as Record<string, unknown>) : undefined
}

/**
 * Returns a provider-local cooldown for rate-limit/throttling errors.
 * Unknown failures are deliberately ignored so normal model errors do not
 * suppress unrelated turns for that provider.
 */
export function providerBackpressureDelay(error: unknown): number | undefined {
  const record = errorRecord(error)
  const data = errorRecord(record?.data)
  const response = errorRecord(record?.response)
  const status = Number(record?.statusCode ?? record?.status ?? data?.statusCode ?? data?.status ?? response?.status)
  const message = String(record?.message ?? data?.message ?? error ?? "")
  const throttled = status === 429 || /(?:rate.?limit|too many requests|throttl)/i.test(message)
  if (!throttled) return

  const headers = record?.responseHeaders ?? record?.headers ?? data?.responseHeaders ?? response?.headers
  const retryAfter =
    retryAfterMs(headerValue(headers, "retry-after")) ??
    retryAfterMs(headerValue(headers, "x-ratelimit-reset-after")) ??
    DEFAULT_BACKPRESSURE_MS
  return Math.min(MAX_BACKPRESSURE_MS, Math.max(0, retryAfter))
}

export class ModelStreamScheduler {
  private maxConcurrency = DEFAULT_MODEL_STREAM_CONCURRENCY
  private providerLimits: Record<string, number> = {}
  private readonly active = new Map<string, Active>()
  private readonly queues = new Map<string, Pending[]>()
  private readonly rootOrder: string[] = []
  private readonly rootBySession = new Map<string, string>()
  private readonly backpressure = new Map<string, Backpressure>()
  private lastGrantedRoot: string | undefined
  private wakeTimer: ReturnType<typeof setTimeout> | undefined
  private nextID = 0
  private pumping = false

  constructor(config?: ModelStreamSchedulerConfig) {
    this.configure(config ?? {})
  }

  configure(config: ModelStreamSchedulerConfig): void {
    this.maxConcurrency = positiveInt(config.maxConcurrency, DEFAULT_MODEL_STREAM_CONCURRENCY)
    this.providerLimits = Object.fromEntries(
      Object.entries(config.providerLimits ?? {})
        .filter(([, value]) => Number.isFinite(value) && value >= 1)
        .map(([providerID, value]) => [providerID, Math.floor(value)]),
    )
    this.pump()
  }

  acquire(input: ModelStreamRequest): Promise<ModelStreamLease> {
    if (input.signal?.aborted) return Promise.reject(abortError())

    const parentRoot = input.parentSessionID ? this.rootBySession.get(input.parentSessionID) : undefined
    const rootSessionID = parentRoot ?? input.parentSessionID ?? input.sessionID
    this.rootBySession.set(input.sessionID, rootSessionID)

    return new Promise<ModelStreamLease>((resolve, reject) => {
      const pending: Pending = {
        ...input,
        id: `model-stream-${++this.nextID}`,
        rootSessionID,
        queuedAt: Date.now(),
        resolve,
        reject,
      }
      if (input.signal) {
        pending.onAbort = () => this.abort(pending)
        input.signal.addEventListener("abort", pending.onAbort, { once: true })
      }

      const queue = this.queues.get(rootSessionID)
      if (queue) {
        queue.push(pending)
      } else {
        this.queues.set(rootSessionID, [pending])
        this.rootOrder.push(rootSessionID)
      }
      this.pump()
      if (!this.active.has(pending.id)) {
        const wait = this.waitReason(pending, Date.now())
        log.info("queued model stream", {
          sessionID: pending.sessionID,
          rootSessionID: pending.rootSessionID,
          providerID: pending.providerID,
          modelID: pending.modelID,
          reason: wait.reason ?? "fair_share",
          detail: wait.detail,
        })
      }
    })
  }

  yieldSession(sessionID: string): boolean {
    const matches = [...this.active.values()].filter((item) => item.pending.sessionID === sessionID)
    for (const item of matches) item.release("parent_waiting_on_child")
    if (matches.length > 0) {
      log.info("released parent capacity for nested task", {
        sessionID,
        released: matches.length,
      })
    }
    return matches.length > 0
  }

  reportBackpressure(providerID: string, delayMs: number, reason = "provider_throttled"): void {
    const duration = Math.min(MAX_BACKPRESSURE_MS, Math.max(0, delayMs))
    const blockedUntil = Date.now() + duration
    const current = this.backpressure.get(providerID)
    if (!current || current.blockedUntil < blockedUntil) {
      this.backpressure.set(providerID, { blockedUntil, reason })
    }
    log.warn("provider backpressure", { providerID, delayMs: duration, reason })
    this.pump()
  }

  snapshot(): ModelStreamSchedulerSnapshot {
    const now = Date.now()
    return {
      maxConcurrency: this.maxConcurrency,
      active: this.active.size,
      queued: [...this.queues.values()].reduce((total, queue) => total + queue.length, 0),
      activeWork: [...this.active.values()].map(({ pending, acquiredAt }) => ({
        leaseID: pending.id,
        sessionID: pending.sessionID,
        parentSessionID: pending.parentSessionID,
        rootSessionID: pending.rootSessionID,
        providerID: pending.providerID,
        modelID: pending.modelID,
        acquiredAt,
        waitMs: acquiredAt - pending.queuedAt,
      })),
      queuedWork: this.rootOrder.flatMap((rootSessionID) =>
        (this.queues.get(rootSessionID) ?? []).map((pending) => {
          const wait = this.waitReason(pending, now)
          return {
            sessionID: pending.sessionID,
            parentSessionID: pending.parentSessionID,
            rootSessionID: pending.rootSessionID,
            providerID: pending.providerID,
            modelID: pending.modelID,
            queuedAt: pending.queuedAt,
            waitMs: now - pending.queuedAt,
            reason: wait.reason ?? "fair_share",
            detail: wait.detail,
          }
        }),
      ),
      providerLimits: { ...this.providerLimits },
      providerBackpressure: Object.fromEntries(this.backpressure),
    }
  }

  private abort(pending: Pending): void {
    const active = this.active.get(pending.id)
    if (active) {
      active.release("cancelled")
      return
    }

    const queue = this.queues.get(pending.rootSessionID)
    if (!queue) return
    const index = queue.findIndex((item) => item.id === pending.id)
    if (index === -1) return
    queue.splice(index, 1)
    this.removeRootIfEmpty(pending.rootSessionID)
    this.removeAbortListener(pending)
    pending.reject(abortError())
    this.pump()
  }

  private providerActive(providerID: string): number {
    let count = 0
    for (const item of this.active.values()) {
      if (item.pending.providerID === providerID) count++
    }
    return count
  }

  private waitReason(
    pending: Pending,
    now: number,
  ): { reason?: ModelStreamWaitReason; detail?: string; wakeAt?: number } {
    if (this.active.size >= this.maxConcurrency) {
      return { reason: "global_capacity", detail: `${this.active.size}/${this.maxConcurrency} active` }
    }

    const backpressure = this.backpressure.get(pending.providerID)
    if (backpressure && backpressure.blockedUntil > now) {
      return {
        reason: "provider_backpressure",
        detail: backpressure.reason,
        wakeAt: backpressure.blockedUntil,
      }
    }
    if (backpressure) this.backpressure.delete(pending.providerID)

    const limit = this.providerLimits[pending.providerID]
    const active = this.providerActive(pending.providerID)
    if (limit !== undefined && active >= limit) {
      return { reason: "provider_capacity", detail: `${active}/${limit} active for ${pending.providerID}` }
    }
    return {}
  }

  private nextEligible(now: number): Pending | undefined {
    if (this.rootOrder.length === 0) return
    const lastIndex = this.lastGrantedRoot ? this.rootOrder.indexOf(this.lastGrantedRoot) : -1
    const start = lastIndex >= 0 ? (lastIndex + 1) % this.rootOrder.length : 0

    for (let offset = 0; offset < this.rootOrder.length; offset++) {
      const rootIndex = (start + offset) % this.rootOrder.length
      const rootSessionID = this.rootOrder[rootIndex]
      if (!rootSessionID) continue
      const pending = this.queues.get(rootSessionID)?.[0]
      if (!pending) continue
      if (!this.waitReason(pending, now).reason) return pending
    }
  }

  private grant(pending: Pending): void {
    const queue = this.queues.get(pending.rootSessionID)
    if (!queue || queue[0]?.id !== pending.id) return
    queue.shift()
    this.removeRootIfEmpty(pending.rootSessionID)
    this.lastGrantedRoot = pending.rootSessionID

    let released = false
    const release = (reason = "completed") => {
      if (released) return
      released = true
      this.active.delete(pending.id)
      this.removeAbortListener(pending)
      log.info("released model stream", {
        leaseID: pending.id,
        sessionID: pending.sessionID,
        providerID: pending.providerID,
        reason,
      })
      this.pump()
    }
    const active: Active = { pending, acquiredAt: Date.now(), release }
    this.active.set(pending.id, active)
    log.info("acquired model stream", {
      leaseID: pending.id,
      sessionID: pending.sessionID,
      rootSessionID: pending.rootSessionID,
      providerID: pending.providerID,
      modelID: pending.modelID,
      waitMs: active.acquiredAt - pending.queuedAt,
      active: this.active.size,
      maxConcurrency: this.maxConcurrency,
    })
    pending.resolve({ id: pending.id, release })
  }

  private removeAbortListener(pending: Pending): void {
    if (pending.signal && pending.onAbort) {
      pending.signal.removeEventListener("abort", pending.onAbort)
    }
  }

  private removeRootIfEmpty(rootSessionID: string): void {
    const queue = this.queues.get(rootSessionID)
    if (queue && queue.length > 0) return
    this.queues.delete(rootSessionID)
    const index = this.rootOrder.indexOf(rootSessionID)
    if (index >= 0) this.rootOrder.splice(index, 1)
  }

  private scheduleWake(now: number): void {
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer)
      this.wakeTimer = undefined
    }
    let wakeAt: number | undefined
    for (const queue of this.queues.values()) {
      const pending = queue[0]
      if (!pending) continue
      const candidate = this.waitReason(pending, now).wakeAt
      if (candidate !== undefined && (wakeAt === undefined || candidate < wakeAt)) wakeAt = candidate
    }
    if (wakeAt === undefined) return
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = undefined
      this.pump()
    }, Math.max(0, wakeAt - Date.now()))
  }

  private pump(): void {
    if (this.pumping) return
    this.pumping = true
    try {
      const now = Date.now()
      while (this.active.size < this.maxConcurrency) {
        const pending = this.nextEligible(now)
        if (!pending) break
        this.grant(pending)
      }
      this.scheduleWake(now)
    } finally {
      this.pumping = false
    }
  }
}

export function createModelStreamScheduler(config?: ModelStreamSchedulerConfig): ModelStreamScheduler {
  return new ModelStreamScheduler(config)
}

export const modelStreamScheduler = createModelStreamScheduler()
