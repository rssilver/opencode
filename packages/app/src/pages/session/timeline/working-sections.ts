import { TimelineRow } from "./timeline-row"

// Maximum number of non-thinking responses kept visible at once. Everything else
// is folded into collapsible "worked on" sections between/around them.
export const RESPONSE_WINDOW = 2

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
  // True when a row belongs to a turn that is still running; such rows stay visible
  // inline and only fold into a collapsed group once the turn finishes.
  isActive?: (row: TimelineRow.TimelineRow) => boolean
}

const hasUserMessageID = (row: TimelineRow.TimelineRow): row is TimelineRow.TimelineRow & { userMessageID: string } =>
  "userMessageID" in row

function sectionKeyFor(slice: readonly TimelineRow.TimelineRow[]): string {
  const first = slice[0]
  const last = slice[slice.length - 1]
  if (!first || !last) return "working-section:empty"
  return `working-section:${TimelineRow.key(first)}:${TimelineRow.key(last)}`
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
  const isActive = input.isActive ?? (() => false)
  const durationForRow = input.durationForRow ?? ((row) => {
    if (!hasUserMessageID(row)) return undefined
    const duration = durationForUserMessage?.(row.userMessageID)
    return typeof duration === "number" ? { key: `turn:${row.userMessageID}`, duration } : undefined
  })

  const responseIndices: number[] = []
  for (let i = 0; i < rows.length; i++) {
    if (isResponse(rows[i])) responseIndices.push(i)
  }

  // Only collapse once there is more than one response to window; short sessions
  // stay fully visible.
  if (responseIndices.length < 2) {
    return rows.map((row) => ({ kind: "row" as const, key: TimelineRow.key(row), row }))
  }

  // Visible responses are the most recent RESPONSE_WINDOW plus every persisted one.
  const visible = new Set<number>()
  const windowStart = Math.max(0, responseIndices.length - RESPONSE_WINDOW)
  for (let k = windowStart; k < responseIndices.length; k++) visible.add(responseIndices[k])
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
    // Boundaries (user messages), visible responses, and rows from a turn that is
    // still running are always shown inline so active thinking/shell/explore work
    // stays on screen; it only folds into a collapsed group once the turn is done.
    if ((isBoundary(row) || (isResponse(row) && visible.has(i)) || (hasUserMessageID(row) && isActive(row)))) {
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
