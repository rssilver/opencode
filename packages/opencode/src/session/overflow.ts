import type { Config } from "@/config/config"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import type { MessageV2 } from "./message-v2"

const COMPACTION_BUFFER = 20_000

export function usable(input: { cfg: ConfigV1.Info; model: Provider.Model; outputTokenMax?: number }) {
  const context = input.model.limit.context
  if (context === 0) return 0

  const reserved =
    input.cfg.compaction?.reserved ??
    Math.min(COMPACTION_BUFFER, ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
  return input.model.limit.input
    ? Math.max(0, input.model.limit.input - reserved)
    : Math.max(0, context - ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
}

export function tokenCount(tokens: SessionV1.Assistant["tokens"]) {
  return tokens.total || tokens.input + tokens.output + tokens.cache.read + tokens.cache.write
}

// Number of user messages after the most recent summary, or Infinity when the session was never compacted.
// Soft (threshold or TTFT) compaction waits for new input so a large fixed prompt cannot cause summarize loops.
export function userMessagesSinceCompaction(messages: readonly SessionV1.WithParts[]) {
  const last = messages.findLastIndex((msg) => msg.info.role === "assistant" && msg.info.summary === true)
  if (last === -1) return Infinity
  return messages.slice(last + 1).filter((msg) => msg.info.role === "user").length
}

export const SOFT_COMPACTION_MIN_USER_MESSAGES = 2

export function isOverflow(input: {
  cfg: ConfigV1.Info
  tokens: SessionV1.Assistant["tokens"]
  model: Provider.Model
  outputTokenMax?: number
  // Set false to apply only the hard context limit and ignore compaction.threshold.
  soft?: boolean
}) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false

  const threshold = input.soft === false ? undefined : input.cfg.compaction?.threshold
  const limit = Math.min(threshold === undefined ? Infinity : input.model.limit.context * threshold, usable(input))
  return tokenCount(input.tokens) >= limit
}
