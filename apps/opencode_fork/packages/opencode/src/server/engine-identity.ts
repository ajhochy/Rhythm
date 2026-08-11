import { randomUUID } from "node:crypto"

const bootId = randomUUID()

export function engineIdentity(version: string) {
  return {
    healthy: true as const,
    version,
    pid: process.pid,
    bootId,
  }
}
