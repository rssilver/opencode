import { describe, expect, test } from "bun:test"
import { waitForPort } from "./wait-port"

const fast = { sleep: async () => {} }

describe("waitForPort", () => {
  test("resolves once a probe succeeds", async () => {
    let calls = 0
    const ok = await waitForPort(3000, {
      ...fast,
      timeoutMs: 10_000,
      probe: async (_port, host) => {
        if (host !== "127.0.0.1") return false
        calls++
        return calls >= 3
      },
    })
    expect(ok).toBe(true)
    expect(calls).toBe(3)
  })

  test("accepts an IPv6-only listener", async () => {
    expect(await waitForPort(1, { ...fast, timeoutMs: 100, probe: async (_p, host) => host === "::1" })).toBe(true)
  })

  test("times out", async () => {
    let time = 0
    const ok = await waitForPort(3000, {
      timeoutMs: 1000,
      probe: async () => false,
      now: () => time,
      sleep: async (ms) => {
        time += ms
      },
    })
    expect(ok).toBe(false)
  })

  test("stops when the process died", async () => {
    let probes = 0
    const ok = await waitForPort(3000, {
      ...fast,
      timeoutMs: 10_000,
      alive: () => false,
      probe: async () => {
        probes++
        return false
      },
    })
    expect(ok).toBe(false)
    expect(probes).toBe(0)
  })
})
