export * as SessionTTFT from "./ttft"

import type { SessionID } from "./schema"

// Process-local time-to-first-token samples per session, in measurement order.
const samples = new Map<SessionID, number[]>()

export function record(sessionID: SessionID, ms: number) {
  const current = samples.get(sessionID)
  if (current) current.push(ms)
  else samples.set(sessionID, [ms])
}

export function get(sessionID: SessionID) {
  return samples.get(sessionID) ?? []
}

export function clear(sessionID: SessionID) {
  samples.delete(sessionID)
}
