import { TimelineRow } from "./timeline-row"

// Global collapse: between user messages, each turn's first and latest answer stay visible;
// middle answers and finished work (thinking, tool calls) fold into "Worked for" sections.

export type DisplayRow =
  | { kind: "row"; key: string; row: TimelineRow.TimelineRow }
  | { kind: "section"; key: string; durationMs?: number; count: number }

export type BuildDisplayRowsInput = {
  rows: readonly TimelineRow.TimelineRow[]
  // True when an AssistantPart row is a visible text response (a real, non-synthetic answer).
  isResponse: (row: TimelineRow.TimelineRow) => boolean
  // True when a response should always stay visible even outside the response window.
  isPersisted?: (row: TimelineRow.TimelineRow) => boolean
  // Accumulated work duration for a turn's user message, in ms.
  durationForUserMessage?: (userMessageID: string) => number | undefined
  // Per-row contribution to a section's "worked on" duration, keyed by the assistant
  // message it belongs to so repeated parts of one response don't double count and
  // distinct responses yield distinct totals. Falls back to whole-turn duration.
  durationForRow?: (row: TimelineRow.TimelineRow) => { key: string; duration?: number } | undefined
  // Whether a section with this key is expanded, revealing its child rows inline.
  isExpanded?: (sectionKey: string) => boolean
  // Always-visible boundary rows (e.g. the user's own message) that are never
  // folded into a collapsed section; they split the timeline into turn groups.
  isBoundary?: (row: TimelineRow.TimelineRow) => boolean
  // True for a row whose work is still in progress (running tool, streaming text or
  // thinking). It stays inline; finished rows of a running turn fold as they complete.
  isUnfinished?: (row: TimelineRow.TimelineRow) => boolean
}

const hasUserMessageID = (row: TimelineRow.TimelineRow): row is TimelineRow.TimelineRow & { userMessageID: string } =>
  "userMessageID" in row

// Keyed by the first row only, so a section that grows while its turn runs keeps its key
// (and its expanded state) instead of being replaced.
function sectionKeyFor(slice: readonly TimelineRow.TimelineRow[]): string {
  const first = slice[0]
  if (!first) return "working-section:empty"
  return `working-section:${TimelineRow.key(first)}`
}

export function buildDisplayRows(input: BuildDisplayRowsInput): DisplayRow[] {
  // TurnGap spacer rows are pure layout separators between turns; they carry no
  // work and must never become phantom "worked on" sections above the next message.
  const rows = input.rows.filter((row) => row._tag !== "TurnGap")
  const isResponse = input.isResponse
  const isPersisted = input.isPersisted ?? (() => false)
  const durationForUserMessage = input.durationForUserMessage ?? (() => undefined)
  const isExpanded = input.isExpanded ?? (() => false)
  const isBoundary = input.isBoundary ?? ((row) => row._tag === "UserMessage")
  const isUnfinished = input.isUnfinished ?? (() => false)
  const durationForRow =
    input.durationForRow ??
    ((row) => {
      if (!hasUserMessageID(row)) return undefined
      const duration = durationForUserMessage?.(row.userMessageID)
      return typeof duration === "number" ? { key: `turn:${row.userMessageID}`, duration } : undefined
    })

  const responseIndices: number[] = []
  for (let i = 0; i < rows.length; i++) {
    if (isResponse(rows[i])) responseIndices.push(i)
  }

  // A turn can emit several responses. Its first and latest stay visible; responseIndices
  // is in row order, so the first index seen per turn is its first answer and the last
  // one seen is its latest.
  const firstAnswerByTurn = new Map<string, number>()
  const latestAnswerByTurn = new Map<string, number>()
  for (const index of responseIndices) {
    const turn = rows[index].userMessageID
    if (!firstAnswerByTurn.has(turn)) firstAnswerByTurn.set(turn, index)
    latestAnswerByTurn.set(turn, index)
  }
  const visible = new Set([...firstAnswerByTurn.values(), ...latestAnswerByTurn.values()])
  for (const index of responseIndices) {
    if (isPersisted(rows[index])) visible.add(index)
  }

  const result: DisplayRow[] = []
  let runStart = -1

  const flushRun = (endExclusive: number) => {
    if (runStart < 0) return
    const slice = rows.slice(runStart, endExclusive)
    if (slice.length === 0) return
    const key = sectionKeyFor(slice)
    // The summary header is always emitted so the disclosure toggle stays in the
    // timeline; expanded sections additionally reveal their child rows inline.
    result.push(buildSummary(slice, durationForRow))
    if (isExpanded(key)) {
      for (const row of slice) result.push({ kind: "row", key: TimelineRow.key(row), row })
    }
    runStart = -1
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    // Boundaries (user messages), visible responses and unfinished work always render
    // inline; everything else folds, including finished work of a turn that is still running.
    if (isBoundary(row) || (isResponse(row) && visible.has(i)) || isUnfinished(row)) {
      flushRun(i)
      result.push({ kind: "row", key: TimelineRow.key(row), row })
      continue
    }
    if (runStart < 0) runStart = i
  }
  flushRun(rows.length)

  return result
}

function buildSummary(
  slice: readonly TimelineRow.TimelineRow[],
  durationForRow: (row: TimelineRow.TimelineRow) => { key: string; duration?: number } | undefined,
) {
  // Sum each assistant message's own work span once per section so distinct responses
  // yield distinct totals instead of repeating the whole turn's duration.
  const seen = new Set<string>()
  let durationMs: number | undefined
  for (const row of slice) {
    const contribution = durationForRow(row)
    if (!contribution || seen.has(contribution.key)) continue
    seen.add(contribution.key)
    if (typeof contribution.duration === "number") durationMs = (durationMs ?? 0) + contribution.duration
  }
  return { kind: "section" as const, key: sectionKeyFor(slice), durationMs, count: slice.length }
}
