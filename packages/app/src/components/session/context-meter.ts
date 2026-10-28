import type { AssistantMessage, Message, Part } from "@opencode-ai/sdk/v2/client"

// Mirrors packages/opencode/src/session/overflow.ts and packages/core/src/session/compaction.ts.
const COMPACTION_BUFFER = 20_000
const OUTPUT_TOKEN_MAX = 32_000
const TTFT_BASELINE_TURNS = 3
const TTFT_FACTOR = 3
const TTFT_MIN_MS = 1500
const SAMPLE_LIMIT = 20

export type MeterLimits = { context: number; input?: number; output?: number }

export type MeterCompaction = {
  auto?: boolean
  reserved?: number
  threshold?: number
  ttft?: { enabled?: boolean; factor?: number; min_ms?: number }
}

export function tokenCount(tokens: AssistantMessage["tokens"]) {
  return tokens.total || tokens.input + tokens.output + tokens.cache.read + tokens.cache.write
}

export function usableTokens(limit: MeterLimits, compaction?: MeterCompaction) {
  if (!limit.context) return 0
  const maxOutput = Math.min(limit.output ?? 0, OUTPUT_TOKEN_MAX) || OUTPUT_TOKEN_MAX
  const reserved = compaction?.reserved ?? Math.min(COMPACTION_BUFFER, maxOutput)
  return limit.input ? Math.max(0, limit.input - reserved) : Math.max(0, limit.context - maxOutput)
}

/** Token count at which the session is summarized, or undefined when automatic summaries are off. */
export function summaryTrigger(limit: MeterLimits, compaction?: MeterCompaction) {
  if (compaction?.auto === false || !limit.context) return undefined
  const soft = compaction?.threshold === undefined ? Infinity : limit.context * compaction.threshold
  return Math.min(soft, usableTokens(limit, compaction))
}

/** Token count of the latest completed assistant message that reports tokens. */
export function latestTokens(messages: readonly Message[]) {
  const message = messages.findLast(
    (item): item is AssistantMessage =>
      item.role === "assistant" && !!item.time.completed && tokenCount(item.tokens) > 0,
  )
  return message ? tokenCount(message.tokens) : undefined
}

/** Time to first token per completed assistant message, in message order. */
export function ttftSamples(messages: readonly Message[], parts: (messageID: string) => readonly Part[] | undefined) {
  return messages.flatMap((message) => {
    if (message.role !== "assistant" || !message.time.completed) return []
    const start = parts(message.id)
      ?.flatMap((part) => {
        if (part.type === "reasoning" || part.type === "text") return part.time ? [part.time.start] : []
        if (part.type === "tool" && "time" in part.state) return [part.state.time.start]
        return []
      })
      .reduce<number | undefined>((min, value) => (min === undefined ? value : Math.min(min, value)), undefined)
    if (start === undefined) return []
    return [Math.max(0, start - message.time.created)]
  })
}

export function ttftTrend(samples: readonly number[], compaction?: MeterCompaction) {
  if (samples.length === 0) return undefined
  const baseline = Math.min(...samples.slice(0, TTFT_BASELINE_TURNS))
  const latest = samples[samples.length - 1]
  const factor = compaction?.ttft?.factor ?? TTFT_FACTOR
  const minMs = compaction?.ttft?.min_ms ?? TTFT_MIN_MS
  return {
    baseline,
    latest,
    ratio: baseline > 0 ? latest / baseline : undefined,
    recent: samples.slice(-SAMPLE_LIMIT),
    slowing: !!compaction?.ttft?.enabled && latest > baseline * factor && latest - baseline > minMs,
  }
}

export function sparklinePoints(values: readonly number[], width: number, height: number) {
  if (values.length === 0) return ""
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  return values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width
      const y = height - ((value - min) / span) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")
}
