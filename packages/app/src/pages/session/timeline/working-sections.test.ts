import { describe, expect, test } from "bun:test"
import { TimelineRow } from "./timeline-row"
import { RESPONSE_WINDOW, buildDisplayRows } from "./working-sections"

const part = (messageID: string, partID: string) =>
  new TimelineRow.AssistantPart({ userMessageID: messageID, previousAssistantPart: false, group: { key: `part:${messageID}:${partID}`, type: "part", ref: { messageID, partID } } })

const isResponse = (groupRefPartID: string) => (row: TimelineRow.TimelineRow) =>
  row._tag === "AssistantPart" && row.group.type === "part" && row.group.ref.partID === groupRefPartID

const anyResponse = (...predicates: ((row: TimelineRow.TimelineRow) => boolean)[]) => (row: TimelineRow.TimelineRow) =>
  predicates.some((predicate) => predicate(row))

describe("buildDisplayRows", () => {
  test("keeps the last RESPONSE_WINDOW responses visible and folds older ones into a section", () => {
    const rows = [
      new TimelineRow.UserMessage({ userMessageID: "u1", anchor: true }),
      part("a1", "text-0"), // response r0 (older -> collapses)
      new TimelineRow.Thinking({ userMessageID: "u1" }),
      part("a2", "text-1"), // response r1 (visible)
      part("a2", "text-2"), // response r2 (visible)
    ]
    const result = buildDisplayRows({ rows, isResponse: anyResponse(isResponse("text-0"), isResponse("text-1"), isResponse("text-2")) })

    // The user message stays visible as a boundary; the older response and thinking
    // fold into one working section between it and the two visible responses.
    expect(result.map((item) => item.kind)).toEqual(["row", "section", "row", "row"])
    const section = result[1]
    expect(section.kind).toBe("section")
    if (section.kind === "section") {
      expect(section.count).toBe(2) // r0 + Thinking (user message renders inline, not folded)
    }
  })

  test("expanding a section reveals its child rows inline while keeping the toggle", () => {
    const rows = [
      new TimelineRow.UserMessage({ userMessageID: "u1", anchor: true }),
      part("a1", "text-0"),
      new TimelineRow.Thinking({ userMessageID: "u1" }),
      part("a2", "text-1"),
      part("a2", "text-2"),
    ]
    const isResp = anyResponse(isResponse("text-0"), isResponse("text-1"), isResponse("text-2"))
    const collapsed = buildDisplayRows({ rows, isResponse: isResp })
    const header = collapsed[1]
    expect(header.kind).toBe("section")
    if (header.kind === "section") {
      // The summary header stays as the disclosure toggle; expanding only adds its
      // child rows after it rather than replacing the toggle.
      const expanded = buildDisplayRows({ rows, isResponse: isResp, isExpanded: (key) => key === header.key })
      expect(expanded.map((item) => item.kind)).toEqual(["row", "section", "row", "row", "row", "row"])
      expect(expanded[1]!.kind).toBe("section")
    }
  })

  test("TurnGap spacer rows are ignored (no ghost sections)", () => {
    const base = [
      new TimelineRow.UserMessage({ userMessageID: "u1", anchor: true }),
      part("a1", "text-0"), // collapses
      new TimelineRow.Thinking({ userMessageID: "u1" }),
      part("a2", "text-1"), // visible
      part("a2", "text-2"), // visible
    ]
    const withGap = [
      ...base.slice(0, 2),
      new TimelineRow.TurnGap({ userMessageID: "u2" }), // spacer before the next turn
      ...base.slice(2),
    ]
    const isResp = anyResponse(isResponse("text-0"), isResponse("text-1"), isResponse("text-2"))
    const withoutGap = buildDisplayRows({ rows: base, isResponse: isResp })
    const withGapResult = buildDisplayRows({ rows: withGap, isResponse: isResp })
    // Inserting a spacer must not add a row, create a phantom section, or shift keys.
    expect(withGapResult.map((item) => item.kind)).toEqual(withoutGap.map((item) => item.kind))
    expect(withGapResult.map((item) => item.key)).toEqual(withoutGap.map((item) => item.key))
  })

  test("active-turn rows stay visible instead of folding into a section", () => {
    const rows = [
      new TimelineRow.UserMessage({ userMessageID: "u1", anchor: true }),
      part("u1", "text-0"), // would fold if the turn were done
      new TimelineRow.Thinking({ userMessageID: "u1" }),
      part("u1", "text-1"), // visible
      part("u1", "text-2"), // visible
    ]
    const isResp = anyResponse(isResponse("text-0"), isResponse("text-1"), isResponse("text-2"))
    const result = buildDisplayRows({
      rows,
      isResponse: isResp,
      isActive: (row) => "userMessageID" in row && row.userMessageID === "u1",
    })
    // The whole still-running turn renders inline; nothing collapses.
    expect(result.map((item) => item.kind)).toEqual(["row", "row", "row", "row", "row"])
  })

  test("section durations sum per assistant message instead of repeating the turn total", () => {
    const rows = [
      new TimelineRow.UserMessage({ userMessageID: "u1", anchor: true }),
      part("a1", "text-0"), // r0 folds; its own message delta only
      new TimelineRow.Thinking({ userMessageID: "u1" }),
      part("a2", "text-1"), // visible
      part("a2", "text-2"), // visible
    ]
    const isResp = anyResponse(isResponse("text-0"), isResponse("text-1"), isResponse("text-2"))
    const durationForRow = (row: TimelineRow.TimelineRow) => {
      if (row._tag !== "AssistantPart" || row.group.type !== "part") return undefined
      const durations: Record<string, number> = { "text-0": 100, "text-1": 50, "text-2": 50 }
      const duration = durations[row.group.ref.partID]
      return duration === undefined ? undefined : { key: `m:${row.group.ref.partID}`, duration }
    }
    const result = buildDisplayRows({ rows, isResponse: isResp, durationForRow })
    // The folded section counts only text-0's delta (100); the visible responses' deltas
    // are not repeated into it, so consecutive sections can differ.
    const section = result.find((item) => item.kind === "section")
    expect(section?.kind).toBe("section")
    if (section?.kind === "section") expect(section.durationMs).toBe(100)
  })

  test("persisted responses stay visible outside the window", () => {
    const rows = [
      part("a1", "text-0"), // r0 persisted -> visible
      part("a1", "text-1"), // r1
      part("a2", "text-2"), // r2 visible (window)
      part("a2", "text-3"), // r3 visible (window)
    ]
    const isResp = anyResponse(isResponse("text-0"), isResponse("text-1"), isResponse("text-2"), isResponse("text-3"))
    const result = buildDisplayRows({ rows, isResponse: isResp, isPersisted: (row) => row._tag === "AssistantPart" && row.group.type === "part" && row.group.ref.partID === "text-0" })
    // r0 persisted + last two -> three visible rows; the non-windowed r1 (between
    // r0 and r2) still folds into a collapsed section.
    expect(result.map((item) => item.kind)).toEqual(["row", "section", "row", "row"])
  })

  test("short sessions with fewer than two responses stay fully visible", () => {
    const rows = [new TimelineRow.UserMessage({ userMessageID: "u1", anchor: true }), part("a1", "text-0")]
    const result = buildDisplayRows({ rows, isResponse: isResponse("text-0") })
    expect(result.map((item) => item.kind)).toEqual(["row", "row"])
  })

  test("response window equals RESPONSE_WINDOW", () => {
    expect(RESPONSE_WINDOW).toBe(2)
  })
})
