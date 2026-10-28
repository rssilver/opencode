import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message, Part } from "@opencode-ai/sdk/v2/client"
import {
  latestTokens,
  sparklinePoints,
  summaryTrigger,
  tokenCount,
  ttftSamples,
  ttftTrend,
  usableTokens,
} from "./context-meter"

const tokens = (input: number, output = 0, read = 0, write = 0, total?: number) =>
  ({ input, output, reasoning: 0, total, cache: { read, write } }) as AssistantMessage["tokens"]

const assistant = (id: string, created: number, completed: number | undefined, t = tokens(10)) =>
  ({ id, role: "assistant", time: { created, completed }, tokens: t }) as unknown as Message

const text = (start: number) => ({ type: "text", time: { start } }) as unknown as Part

describe("tokenCount", () => {
  test("prefers total, otherwise sums without reasoning", () => {
    expect(tokenCount(tokens(1, 2, 3, 4))).toBe(10)
    expect(tokenCount(tokens(1, 2, 3, 4, 99))).toBe(99)
  })
})

describe("summaryTrigger", () => {
  test("hard limit without input limit is context - maxOutput", () => {
    expect(summaryTrigger({ context: 200_000, output: 8_000 })).toBe(192_000)
    expect(summaryTrigger({ context: 200_000, output: 100_000 })).toBe(168_000)
    expect(summaryTrigger({ context: 200_000 })).toBe(168_000)
  })
  test("hard limit with input limit subtracts reserved", () => {
    expect(usableTokens({ context: 400_000, input: 272_000, output: 128_000 })).toBe(252_000)
    expect(usableTokens({ context: 400_000, input: 272_000, output: 4_000 })).toBe(268_000)
    expect(usableTokens({ context: 400_000, input: 272_000 }, { reserved: 10_000 })).toBe(262_000)
  })
  test("soft threshold takes the minimum", () => {
    expect(summaryTrigger({ context: 200_000, output: 8_000 }, { threshold: 0.5 })).toBe(100_000)
    expect(summaryTrigger({ context: 200_000, output: 8_000 }, { threshold: 1 })).toBe(192_000)
  })
  test("off and unknown context", () => {
    expect(summaryTrigger({ context: 200_000 }, { auto: false })).toBeUndefined()
    expect(summaryTrigger({ context: 0 })).toBeUndefined()
  })
})

describe("latestTokens", () => {
  test("uses latest completed assistant message", () => {
    const messages = [
      assistant("a", 0, 1, tokens(5)),
      assistant("b", 2, 3, tokens(7)),
      assistant("c", 4, undefined, tokens(9)),
    ]
    expect(latestTokens(messages)).toBe(7)
    expect(latestTokens([])).toBeUndefined()
  })
})

describe("ttftSamples", () => {
  test("measures first text, reasoning or tool part of completed messages", () => {
    const messages = [
      assistant("a", 100, 900),
      assistant("b", 1000, 2000),
      assistant("c", 3000, undefined),
      assistant("d", 4000, 5000),
    ]
    const parts: Record<string, Part[]> = {
      a: [text(1300), { type: "tool", state: { status: "running", time: { start: 1200 } } } as unknown as Part],
      b: [text(1500)],
      c: [text(3100)],
      d: [{ type: "step-start" } as unknown as Part],
    }
    expect(ttftSamples(messages, (id) => parts[id])).toEqual([1100, 500])
  })
})

describe("ttftTrend", () => {
  test("baseline is min of first 3, latest is last", () => {
    const trend = ttftTrend([900, 500, 800, 2100], { ttft: { enabled: true } })
    expect(trend?.baseline).toBe(500)
    expect(trend?.latest).toBe(2100)
    expect(trend?.ratio).toBe(4.2)
    expect(trend?.slowing).toBe(true)
  })
  test("requires both factor and absolute delta, and auto mode", () => {
    expect(ttftTrend([100, 100, 100, 900], { ttft: { enabled: true } })?.slowing).toBe(false)
    expect(ttftTrend([1000, 1000, 1000, 2900], { ttft: { enabled: true } })?.slowing).toBe(false)
    expect(ttftTrend([1000, 1000, 1000, 4600], { ttft: { enabled: false } })?.slowing).toBe(false)
    expect(ttftTrend([1000, 1000, 1000, 4600], { ttft: { enabled: true, factor: 2, min_ms: 500 } })?.slowing).toBe(true)
    expect(ttftTrend([])).toBeUndefined()
  })
  test("keeps the last 20 samples", () => {
    expect(ttftTrend(Array.from({ length: 30 }, (_, i) => i))?.recent).toHaveLength(20)
  })
})

describe("sparklinePoints", () => {
  test("scales into the box", () => {
    expect(sparklinePoints([0, 10], 10, 4)).toBe("0.0,4.0 10.0,0.0")
    expect(sparklinePoints([], 10, 4)).toBe("")
  })
})
