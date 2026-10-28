import type { Config } from "@opencode-ai/sdk/v2/client"

export type SummarizeMode = "limit" | "75" | "50" | "auto" | "off"

// The generated SDK config type predates these server settings.
export type SummarizeCompaction = NonNullable<Config["compaction"]> & {
  threshold?: number
  ttft?: { enabled?: boolean; factor?: number; min_ms?: number }
}

export const summarizeModes: SummarizeMode[] = ["limit", "75", "50", "auto", "off"]

export function summarizeMode(compaction: SummarizeCompaction | undefined): SummarizeMode {
  if (compaction?.auto === false) return "off"
  const threshold = compaction?.threshold
  if (threshold !== undefined && threshold < 1) return threshold <= 0.625 ? "50" : "75"
  if (compaction?.ttft?.enabled) return "auto"
  return "limit"
}

// The server deep-merges global config updates, so unset values are written as their neutral equivalents
// (threshold 1 is the hard context limit) and untouched compaction keys such as prune and keep are preserved.
export function summarizePatch(compaction: SummarizeCompaction | undefined, mode: SummarizeMode): SummarizeCompaction {
  return {
    ...compaction,
    auto: mode !== "off",
    threshold: mode === "75" ? 0.75 : mode === "50" ? 0.5 : 1,
    ttft: { ...compaction?.ttft, enabled: mode === "auto" },
  }
}

export const summarizeLabelKeys = {
  limit: "settings.general.row.summarizeSessions.option.limit",
  "75": "settings.general.row.summarizeSessions.option.threshold75",
  "50": "settings.general.row.summarizeSessions.option.threshold50",
  auto: "settings.general.row.summarizeSessions.option.auto",
  off: "settings.general.row.summarizeSessions.option.off",
} as const
